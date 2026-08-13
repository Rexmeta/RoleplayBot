import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { exec } from 'child_process';
import { promisify } from 'util';
import { trackVideoUsage } from './aiUsageTracker';
import { mediaStorage } from './mediaStorage';
import { getModelForFeature } from './aiServiceFactory';

const execAsync = promisify(exec);

const VIDEO_CONFIG = {
  maxDurationSeconds: 8,
  outputFormat: 'webm',
  resolution: '720p',
  pollingIntervalMs: 5000,
  maxPollingAttempts: 60,
  webmCrf: 30,
  webmVideoBitrate: '1M',
  webmAudioBitrate: '128k',
};

/** Retry a function up to maxRetries times on transient errors with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, label = ''): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.httpStatus ?? 0;
      const msg = (err?.message ?? '').toLowerCase();
      const isTransient =
        status === 500 || status === 503 || status === 504 ||
        msg.includes('500') || msg.includes('503') || msg.includes('504') ||
        msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset');
      if (!isTransient || attempt === maxRetries) throw err;
      const delayMs = 1000 * Math.pow(2, attempt);
      console.warn(`[retry:${label}] attempt ${attempt + 1}/${maxRetries}, retrying in ${delayMs}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Unreachable');
}
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

export interface VideoGenerationResult {
  success: boolean;
  videoUrl?: string;
  prompt?: string;
  error?: string;
  metadata?: {
    model: string;
    provider: string;
    durationSeconds: number;
    savedLocally: boolean;
  };
}

export interface VideoGenerationRequest {
  scenarioId: string;
  scenarioTitle: string;
  description?: string;
  customPrompt?: string;
  /** Per-scenario video model override; falls back to global `model_video` setting when omitted. */
  modelOverride?: string;
  context?: {
    situation: string;
    stakes: string;
    timeline: string;
  };
}

export async function generateIntroVideo(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
  if (!apiKey) {
    return {
      success: false,
      error: 'GEMINI_API_KEY 또는 GOOGLE_API_KEY가 설정되지 않았습니다.'
    };
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    
    const videoPrompt = request.customPrompt || generateVideoPrompt(request);
    
    console.log(`🎬 Gemini Veo 비디오 생성 요청: ${request.scenarioTitle}`);
    console.log(`프롬프트: ${videoPrompt}`);

    const videoModel = request.modelOverride || await getModelForFeature('video');
    console.log(`🎥 비디오 모델: ${videoModel}${request.modelOverride ? ' (시나리오 오버라이드)' : ''}`);

    const operation = await withRetry(
      () => genAI.models.generateVideos({ model: videoModel, prompt: videoPrompt }),
      3, 'generateVideos-intro',
    );

    console.log('📋 Veo API 응답 - 작업 시작됨:', operation.name);

    let result = operation;
    let attempts = 0;
    
    while (!result.done && attempts < VIDEO_CONFIG.maxPollingAttempts) {
      await new Promise(resolve => setTimeout(resolve, VIDEO_CONFIG.pollingIntervalMs));
      
      try {
        result = await withRetry(
          () => genAI.operations.getVideosOperation({ operation: result }),
          3, `poll-intro-${attempts}`,
        );
      } catch (pollError: any) {
        console.log(`⏳ 폴링 시도 ${attempts + 1}: ${pollError.message || '대기 중...'}`);
      }
      
      attempts++;
      console.log(`⏳ 비디오 생성 진행 중... (${attempts}/${VIDEO_CONFIG.maxPollingAttempts})`);
    }

    if (!result.done) {
      return {
        success: false,
        error: '비디오 생성 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.',
        prompt: videoPrompt
      };
    }

    if (result.error) {
      console.error('❌ Veo API 오류:', result.error);
      const errorMessage = typeof result.error === 'object' && result.error !== null 
        ? (result.error as any).message || JSON.stringify(result.error)
        : String(result.error);
      return {
        success: false,
        error: errorMessage || '비디오 생성 중 오류가 발생했습니다.',
        prompt: videoPrompt
      };
    }

    const generatedVideos = result.response?.generatedVideos;
    if (!generatedVideos || generatedVideos.length === 0) {
      return {
        success: false,
        error: '생성된 비디오가 없습니다. 프롬프트가 콘텐츠 정책에 의해 필터링되었을 수 있습니다.',
        prompt: videoPrompt
      };
    }

    const videoData = generatedVideos[0].video;
    if (!videoData) {
      return {
        success: false,
        error: '비디오 데이터를 찾을 수 없습니다.',
        prompt: videoPrompt
      };
    }

    let videoBytes: Uint8Array | undefined;
    
    if (videoData.uri) {
      console.log('📥 비디오 URI에서 다운로드:', videoData.uri);
      videoBytes = await fetchVideoWithTimeout(videoData.uri, apiKey!);
    } else if (videoData.videoBytes) {
      if (typeof videoData.videoBytes === 'string') {
        const binaryString = atob(videoData.videoBytes);
        videoBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          videoBytes[i] = binaryString.charCodeAt(i);
        }
      } else {
        videoBytes = videoData.videoBytes as Uint8Array;
      }
    }

    if (!videoBytes) {
      return {
        success: false,
        error: '비디오 바이트를 추출할 수 없습니다.',
        prompt: videoPrompt
      };
    }

    // Veo returns H.264/AAC in an MP4 container regardless of the requested
    // format. The intro video is stored under a `.webm` key, so the bytes MUST
    // be transcoded to real WebM (VP9/Opus) first — storing MP4 bytes under a
    // `.webm` key makes Chrome start playback and then abort mid-stream.
    const webmBytes = await transcodeIntroToWebM(videoBytes);
    const localVideoPath = await mediaStorage.saveVideo(webmBytes, request.scenarioId, request.scenarioTitle);

    console.log(`✅ Gemini Veo 비디오 생성 성공, Object Storage 저장 완료: ${localVideoPath}`);

    // AI 사용량 추적 (비디오 생성은 토큰이 아닌 건당 비용)
    trackVideoUsage({
      model: videoModel,
      provider: 'gemini',
      metadata: { 
        scenarioId: request.scenarioId, 
        scenarioTitle: request.scenarioTitle,
        durationSeconds: VIDEO_CONFIG.maxDurationSeconds
      }
    });

    return {
      success: true,
      videoUrl: localVideoPath,
      prompt: videoPrompt,
      metadata: {
        model: videoModel,
        provider: "gemini",
        durationSeconds: VIDEO_CONFIG.maxDurationSeconds,
        savedLocally: true
      }
    };

  } catch (error: any) {
    console.error('Gemini Veo 비디오 생성 오류:', error);
    
    if (error.message?.includes('quota') || error.status === 429) {
      return {
        success: false,
        error: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.'
      };
    }

    if (error.message?.includes('safety') || error.message?.includes('policy')) {
      return {
        success: false,
        error: '생성하려는 비디오가 콘텐츠 정책에 위반됩니다. 다른 내용으로 시도해주세요.'
      };
    }

    if (error.message?.includes('not found') || error.message?.includes('404')) {
      return {
        success: false,
        error: 'Veo 모델을 사용할 수 없습니다. API 키에 Veo 접근 권한이 있는지 확인해주세요.'
      };
    }

    return {
      success: false,
      error: error.message || '알 수 없는 오류가 발생했습니다.'
    };
  }
}

function generateVideoPrompt(request: VideoGenerationRequest): string {
  const { scenarioTitle, description, context } = request;
  
  let prompt = `Create a professional corporate video introduction for a workplace training scenario. `;
  
  if (context?.situation) {
    prompt += `Situation: ${context.situation}. `;
  }
  
  const keywords = extractKeywords(scenarioTitle);
  
  if (keywords.includes('해킹') || keywords.includes('보안')) {
    prompt += `Scene: Modern tech office, computer screens showing security alerts, professional employees discussing urgently. `;
    prompt += `Mood: Tense but professional, blue and red warning lights on screens. `;
  } else if (keywords.includes('갈등') || keywords.includes('협상')) {
    prompt += `Scene: Corporate meeting room, professionals in discussion, serious atmosphere. `;
    prompt += `Mood: Professional tension, people facing each other across a table. `;
  } else if (keywords.includes('프로젝트') || keywords.includes('일정')) {
    prompt += `Scene: Open office space, project timeline on whiteboard, team members reviewing documents. `;
    prompt += `Mood: Focused, deadline pressure, collaborative energy. `;
  } else if (keywords.includes('제조') || keywords.includes('공장')) {
    prompt += `Scene: Factory floor or industrial setting, workers and managers meeting. `;
    prompt += `Mood: Industrial, practical, problem-solving atmosphere. `;
  } else if (keywords.includes('론칭') || keywords.includes('신제품')) {
    prompt += `Scene: Marketing office or product showroom, team preparing for launch. `;
    prompt += `Mood: Exciting but pressured, creative energy. `;
  } else {
    prompt += `Scene: Modern corporate office, professional employees in a meeting or discussion. `;
    prompt += `Mood: Professional, business-focused atmosphere. `;
  }
  
  prompt += `Style: Photorealistic, cinematic quality, smooth camera movement. `;
  prompt += `Lighting: Natural office lighting, professional corporate environment. `;
  prompt += `No text overlays, no logos, no watermarks. 8 seconds duration.`;
  
  return prompt;
}

function extractKeywords(title: string): string[] {
  const keywords: string[] = [];
  const keywordPatterns = [
    '해킹', '보안', '갈등', '협상', '프로젝트', '일정', '제조', '공장',
    '론칭', '신제품', '품질', '위기', '파업', '노사', '협력'
  ];
  
  for (const pattern of keywordPatterns) {
    if (title.includes(pattern)) {
      keywords.push(pattern);
    }
  }
  
  return keywords;
}

async function saveVideoToLocal(videoBytes: Uint8Array, scenarioId: string, scenarioTitle: string): Promise<string> {
  const videoDir = path.join(process.cwd(), 'scenarios', 'videos');
  
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }
  
  const safeScenarioId = scenarioId
    .replace(/[^a-zA-Z0-9가-힣\-_]/g, '')
    .substring(0, 50);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const mp4Filename = `intro-${safeScenarioId}-${timestamp}.mp4`;
  const webmFilename = `intro-${safeScenarioId}-${timestamp}.webm`;
  const mp4FilePath = path.join(videoDir, mp4Filename);
  const webmFilePath = path.join(videoDir, webmFilename);
  
  fs.writeFileSync(mp4FilePath, Buffer.from(videoBytes));
  
  const mp4Stats = fs.statSync(mp4FilePath);
  console.log(`📁 원본 MP4 저장 완료: ${mp4Filename} (${(mp4Stats.size / 1024 / 1024).toFixed(2)}MB)`);
  
  try {
    console.log(`🔄 WebM 변환 시작...`);
    const webmPath = await convertToWebM(mp4FilePath, webmFilePath);
    
    fs.unlinkSync(mp4FilePath);
    console.log(`🗑️ 원본 MP4 파일 삭제 완료`);
    
    const webmStats = fs.statSync(webmFilePath);
    console.log(`✅ WebM 변환 완료: ${webmFilename} (${(webmStats.size / 1024 / 1024).toFixed(2)}MB)`);
    
    return `/scenarios/videos/${webmFilename}`;
  } catch (convertError) {
    console.error('WebM 변환 실패, MP4 사용:', convertError);
    return `/scenarios/videos/${mp4Filename}`;
  }
}

/** True when the buffer starts with the EBML magic all WebM/Matroska files share. */
export function isWebMContainer(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/**
 * Ensure intro-video bytes are a real WebM (VP9/Opus) container.
 *
 * Veo always returns H.264/AAC in MP4 regardless of the requested format, and
 * the intro pipeline stores under a `.webm` key with `video/webm`. Chrome
 * begins playback of an MP4 mislabelled as WebM and then aborts mid-stream,
 * so the bytes must be transcoded before storage. If the bytes are already
 * WebM they pass through untouched. A transcode failure throws — silently
 * storing an unplayable clip is worse than failing the generation.
 */
export async function transcodeIntroToWebM(videoBytes: Uint8Array): Promise<Uint8Array> {
  if (isWebMContainer(videoBytes)) return videoBytes;

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intro-video-'));
  const inputPath = path.join(workDir, 'source.mp4');
  const outputPath = path.join(workDir, 'converted.webm');
  try {
    fs.writeFileSync(inputPath, Buffer.from(videoBytes));
    await convertToWebM(inputPath, outputPath);
    return fs.readFileSync(outputPath);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function convertToWebM(inputPath: string, outputPath: string): Promise<string> {
  const ffmpegCommand = `ffmpeg -i "${inputPath}" -c:v libvpx-vp9 -b:v ${VIDEO_CONFIG.webmVideoBitrate} -crf ${VIDEO_CONFIG.webmCrf} -c:a libopus -b:a ${VIDEO_CONFIG.webmAudioBitrate} -y "${outputPath}"`;
  
  console.log(`🎥 FFmpeg 명령어: ${ffmpegCommand}`);
  
  try {
    const { stdout, stderr } = await execAsync(ffmpegCommand, { timeout: 120000 });
    
    if (stderr) {
      console.log('FFmpeg stderr:', stderr.slice(-500));
    }
    
    if (!fs.existsSync(outputPath)) {
      throw new Error('WebM 파일이 생성되지 않았습니다.');
    }
    
    return outputPath;
  } catch (error: any) {
    console.error('FFmpeg 변환 오류:', error.message);
    throw error;
  }
}

/** Normalised avatar clip bytes plus the container they are actually in. */
export interface NormalizedClip {
  buffer: Buffer;
  extension: 'mp4';
  contentType: 'video/mp4';
  /** `w:h:x:y` when letterbox padding was cropped away, otherwise null. */
  crop: string | null;
}

/**
 * Bring a raw Veo avatar clip into a state the browser can actually play.
 *
 * Two problems are fixed here, both of which made avatar clips unusable:
 *
 * 1. **Container mismatch.** Veo returns H.264/AAC in an MP4 container, but the
 *    clip used to be stored under a `.webm` key with a `video/webm` content
 *    type. Chrome refuses to decode an MP4 that claims to be WebM, so `canplay`
 *    never fired and every clip fell back to the static portrait.
 *
 * 2. **Baked-in letterbox.** Veo sometimes renders a square frame padded into
 *    the requested 9:16 canvas with solid black bars. `object-fit: cover` then
 *    puts one of those bars across the top of the portrait as a black band.
 *    `cropdetect` finds the real content rectangle so the bars never ship.
 *
 * The crop is only applied when it is both meaningful and sane; anything
 * unexpected leaves the frame untouched rather than guessing at a crop.
 */
export async function normalizeAvatarClip(videoBytes: Uint8Array): Promise<NormalizedClip> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-clip-'));
  const inputPath = path.join(workDir, 'source.mp4');
  const outputPath = path.join(workDir, 'normalized.mp4');

  const passthrough: NormalizedClip = {
    // Veo hands back MP4 regardless, so this stays truthful even when ffmpeg is
    // unavailable — only the letterbox crop is lost.
    buffer: Buffer.from(videoBytes),
    extension: 'mp4',
    contentType: 'video/mp4',
    crop: null,
  };

  try {
    fs.writeFileSync(inputPath, Buffer.from(videoBytes));

    const crop = await detectLetterboxCrop(inputPath);
    // Re-encode only when cropping; otherwise copy the streams so a clean clip
    // is never degraded by a pointless generation loss.
    const videoArgs = crop
      ? `-vf "crop=${crop}" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a copy`
      : `-c copy`;
    const command = `ffmpeg -hide_banner -y -i "${inputPath}" ${videoArgs} -movflags +faststart "${outputPath}"`;

    console.log(`🎬 아바타 클립 정규화: ${crop ? `letterbox 제거 (crop=${crop})` : '컨테이너 유지 (letterbox 없음)'}`);
    await execAsync(command, { timeout: 180000 });

    if (!fs.existsSync(outputPath)) {
      throw new Error('정규화된 클립 파일이 생성되지 않았습니다.');
    }

    return {
      buffer: fs.readFileSync(outputPath),
      extension: 'mp4',
      contentType: 'video/mp4',
      crop,
    };
  } catch (error: any) {
    // A normalisation failure must not throw away an expensive generation; the
    // raw bytes are still playable, just possibly letterboxed.
    console.warn(`⚠️ 아바타 클립 정규화 실패 — 원본 바이트를 그대로 저장합니다: ${error?.message ?? error}`);
    return passthrough;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Run ffmpeg's `cropdetect` over the opening frames and return a `w:h:x:y`
 * crop string when the clip carries solid letterbox padding.
 *
 * Returns null when the frame is already full-bleed, when detection fails, or
 * when the proposed crop looks implausible (a too-aggressive crop would cut
 * into the persona's face, which is far worse than leaving a black bar).
 */
async function detectLetterboxCrop(inputPath: string): Promise<string | null> {
  // ffmpeg reports cropdetect on stderr, but never rely on a single stream here:
  // a shell-level redirect would move the lines to stdout and silently skip the
  // crop, which is exactly how the black bars shipped in the first place.
  let probeOutput = '';
  try {
    const { stdout, stderr } = await execAsync(
      `ffmpeg -hide_banner -i "${inputPath}" -vf cropdetect=24:2:0 -frames:v 90 -f null -`,
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    );
    probeOutput = `${stderr ?? ''}${stdout ?? ''}`;
  } catch (error: any) {
    // execAsync rejects on a non-zero exit; the crop lines may still be present.
    probeOutput = `${error?.stderr ?? ''}${error?.stdout ?? ''}`;
  }

  // cropdetect refines its guess frame by frame; the last report is the stable one.
  const cropPattern = /crop=(\d+):(\d+):(\d+):(\d+)/g;
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = cropPattern.exec(probeOutput)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) return null;

  const [cropW, cropH, cropX, cropY] = lastMatch.slice(1, 5).map(Number);

  const dimensions = await execAsync(
    `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`,
    { timeout: 30000 },
  );
  const [sourceW, sourceH] = dimensions.stdout.trim().split(',').map(Number);
  if (!sourceW || !sourceH) return null;

  // Nothing to do when cropdetect just reports the full frame.
  if (cropW === sourceW && cropH === sourceH) return null;

  // Guard against a runaway crop: keep at least half of each dimension and
  // require the crop window to sit inside the source frame.
  const withinFrame = cropX >= 0 && cropY >= 0 && cropX + cropW <= sourceW && cropY + cropH <= sourceH;
  const keepsEnough = cropW >= sourceW * 0.5 && cropH >= sourceH * 0.5;
  if (!withinFrame || !keepsEnough) {
    console.warn(`⚠️ cropdetect 결과가 비정상적이라 무시합니다: crop=${cropW}:${cropH}:${cropX}:${cropY} (원본 ${sourceW}x${sourceH})`);
    return null;
  }

  return `${cropW}:${cropH}:${cropX}:${cropY}`;
}

export async function deleteIntroVideo(videoUrl: string): Promise<boolean> {
  try {
    // Skip if empty or null
    if (!videoUrl) return true;
    
    // Skip if it's a full URL (http/https) - external videos
    if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
      console.log('외부 URL이므로 삭제하지 않음:', videoUrl.substring(0, 50));
      return true;
    }
    
    // Use mediaStorage for cloud storage deletion (GCS/Replit Object Storage)
    const deleted = await mediaStorage.deleteFromStorage(videoUrl);
    if (deleted) {
      return true;
    }
    
    // Fallback: Try local filesystem deletion for legacy paths
    if (videoUrl.startsWith('/scenarios/videos/') && !videoUrl.includes('..')) {
      const filePath = path.join(process.cwd(), videoUrl.slice(1));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ 비디오 파일 삭제 완료 (로컬): ${filePath}`);
        return true;
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('비디오 삭제 실패:', error);
    return false;
  }
}

export function getVideoGenerationStatus(): { available: boolean; reason?: string } {
  if (!apiKey) {
    return {
      available: false,
      reason: 'API 키가 설정되지 않았습니다.'
    };
  }
  
  return {
    available: true
  };
}

// ── Avatar clip generation ────────────────────────────────────────────────────

/**
 * Observable avatar behaviour, decided by the realtime audio stream:
 * user audio → listening, AI audio → speaking.
 */
export type AvatarClipBehavior = 'listening' | 'speaking';

/** Affect group, decided by the LLM's emotion label. */
export type AvatarClipEmotion = 'positive' | 'neutral' | 'negative';

export const AVATAR_CLIP_BEHAVIORS: readonly AvatarClipBehavior[] = ['listening', 'speaking'];
export const AVATAR_CLIP_EMOTIONS: readonly AvatarClipEmotion[] = ['positive', 'neutral', 'negative'];

/** Storage/DB slot key for a behaviour × emotion pair, e.g. "speaking_negative". */
export type AvatarClipSlot = `${AvatarClipBehavior}_${AvatarClipEmotion}`;

export function avatarClipSlot(behavior: AvatarClipBehavior, emotion: AvatarClipEmotion): AvatarClipSlot {
  return `${behavior}_${emotion}`;
}

/**
 * The complete clip library for one gender: 2 behaviours × 3 emotions.
 * Adding finer emotions later (happy/excited, angry/sad) only adds slots —
 * the behaviour dimension and every consumer stay unchanged.
 */
export const AVATAR_CLIP_SLOTS: readonly AvatarClipSlot[] = AVATAR_CLIP_BEHAVIORS.flatMap(
  behavior => AVATAR_CLIP_EMOTIONS.map(emotion => avatarClipSlot(behavior, emotion)),
);

export interface AvatarClipRequest {
  personaId: string;
  /** Audio-stream driven behaviour. */
  behavior: AvatarClipBehavior;
  /** LLM driven affect group. Defaults to neutral. */
  emotion?: AvatarClipEmotion;
  styleHint?: string;
  gender?: 'male' | 'female';
  neutralImageUrl?: string;
  /** Optional free-text rider appended after the base behaviour prompt. */
  extraPrompt?: string;
  /** Per-persona video model override; falls back to global `model_video` setting when omitted. */
  modelOverride?: string;
}

/**
 * Terms that have triggered Veo content-policy rejections.
 * Any styleHint value that contains one of these (case-insensitive) is rejected
 * before it can be concatenated into a prompt.
 */
export const AVATAR_PROMPT_BANNED_TERMS: readonly string[] = [
  'mouth moving',
  'mouth move',
  'speaking naturally',
  'facial expression',
  'close-up face',
  'close up face',
  'closeup face',
  'face close',
];

/**
 * Aspect ratio for every persona avatar clip.
 *
 * Avatar clips always fill a tall portrait frame in the chat view, so they are
 * pinned to 9:16 and never take an override from the caller. Requesting any
 * other ratio makes Veo pad the frame with black bars, which `object-fit: cover`
 * then exposes as a black band above the persona.
 */
export const AVATAR_CLIP_ASPECT_RATIO = '9:16' as const;

const AVATAR_EMOTION_DIRECTION: Record<AvatarClipEmotion, string> = {
  positive: 'Warm, encouraging demeanor. Subtle positive energy while remaining natural and professional.',
  neutral: 'Calm, composed neutral demeanor. Natural and professional.',
  negative: 'Quietly concerned, empathetic demeanor. Restrained and professional, never exaggerated.',
};

/**
 * Validate a styleHint value against the banned-term list.
 * Throws a descriptive Error if the hint contains a prohibited term.
 */
export function validateStyleHint(styleHint: string): void {
  const lower = styleHint.toLowerCase();
  for (const term of AVATAR_PROMPT_BANNED_TERMS) {
    if (lower.includes(term.toLowerCase())) {
      throw new Error(
        `styleHint contains a policy-violating term ("${term}") and cannot be forwarded to Veo. ` +
        `styleHint values must not describe face close-ups, mouth movement, or facial expressions.`,
      );
    }
  }
}

/**
 * Build a Veo prompt for an avatar clip slot (behaviour × emotion).
 *
 * Design intent: prompts describe ONLY body posture and motion — no appearance,
 * no ethnicity, no gender.  The person's looks come from the seed image.
 * Affect is expressed through demeanour only, never through explicit face wording.
 */
export function generateAvatarClipPrompt(request: AvatarClipRequest): string {
  const { behavior, styleHint, emotion = 'neutral' } = request;

  // Reject styleHints that contain policy-violating language.
  // Even though the hint is not injected into the prompt today, we validate it
  // at the boundary so callers get a clear error rather than silent acceptance.
  if (styleHint !== undefined && styleHint !== '') {
    validateStyleHint(styleHint);
  }

  // styleHint is intentionally not injected — appearance is provided via seed image.

  // Only two behaviours exist: the clip loops while the user talks, or while
  // the persona talks. Every other conversational nuance is carried by emotion.
  const behaviorDescriptions: Record<AvatarClipBehavior, string> = {
    listening:
      'Calm eye contact while attentively listening. Natural blinking. Minimal natural breathing. ' +
      'Relaxed attentive posture, mouth closed naturally. Static camera.',
    speaking:
      'Natural lip movement as if talking. Gentle expressions. Small natural hand gesture. ' +
      'Maintains eye contact with the camera. Static camera. Soft indoor office lighting.',
  };

  const base = behaviorDescriptions[behavior] ?? behaviorDescriptions.listening;
  const emotionDirection = AVATAR_EMOTION_DIRECTION[emotion] ?? AVATAR_EMOTION_DIRECTION.neutral;

  const extra = request.extraPrompt?.trim();
  return extra
    ? `${base} ${emotionDirection} ${extra}`
    : `${base} ${emotionDirection}`;
}

/**
 * Generate a single avatar clip for one behaviour × emotion slot
 * using Gemini Veo and persist it to storage.
 */
export async function generateAvatarClip(
  request: AvatarClipRequest,
): Promise<VideoGenerationResult> {
  if (!apiKey) {
    return {
      success: false,
      error: 'GEMINI_API_KEY 또는 GOOGLE_API_KEY가 설정되지 않았습니다.',
    };
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const videoPrompt = generateAvatarClipPrompt(request);
    const videoModel = request.modelOverride || await getModelForFeature('avatar_video');
    const clipSlot = avatarClipSlot(request.behavior, request.emotion ?? 'neutral');

    console.log(`🎬 아바타 클립 생성 요청: ${request.personaId} / ${clipSlot} / gender:${request.gender ?? 'unspecified'}`);
    console.log(`🎥 비디오 모델: ${videoModel}${request.modelOverride ? ' (페르소나 오버라이드)' : ''}`);
    console.log(`프롬프트: ${videoPrompt}`);

    // Load seed image when provided. WEBP is always converted to JPEG — Veo 3.1 has
    // known instability with WEBP inputs that triggers raiMediaFilteredCount=1.
    let seedImage: { imageBytes: string; mimeType: string } | undefined;
    if (request.neutralImageUrl) {
      try {
        const key = request.neutralImageUrl.replace(/^\/+/, '');
        const loadedBuf = await mediaStorage.readImageBuffer(key);
        if (loadedBuf && loadedBuf.byteLength > 0) {
          let imgBuf: Buffer = loadedBuf;
          const ext = path.extname(key).toLowerCase().replace('.', '');
          let mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

          // Veo 3.1 has known instability with WEBP seed images (triggers raiMediaFilteredCount=1).
          // Always convert WEBP → JPEG before sending.
          if (ext === 'webp') {
            try {
              imgBuf = await sharp(imgBuf).jpeg({ quality: 92 }).toBuffer();
              mimeType = 'image/jpeg';
              console.log(`🔄 시드 이미지 WEBP→JPEG 변환 완료 (${imgBuf.byteLength} bytes)`);
            } catch (convertErr: any) {
              console.warn(`⚠️ WEBP→JPEG 변환 실패, 원본 그대로 전송: ${convertErr.message}`);
              mimeType = 'image/webp';
            }
          }

          seedImage = { imageBytes: imgBuf.toString('base64'), mimeType };
          console.log(`🖼️ 시드 이미지 로드: ${key} (${mimeType}, ${imgBuf.byteLength} bytes)`);
        } else {
          console.warn(`⚠️ 시드 이미지를 찾을 수 없음: ${key} — 텍스트 프롬프트만 사용`);
        }
      } catch (imgErr: any) {
        console.warn(`⚠️ 시드 이미지 처리 오류: ${imgErr.message} — 텍스트 프롬프트만 사용`);
      }
    }

    const effectiveModel = videoModel;
    const generateParams: any = {
      model: effectiveModel,
      prompt: videoPrompt,
      config: {
        aspectRatio: AVATAR_CLIP_ASPECT_RATIO,
      },
    };
    console.log(`📐 아바타 클립 종횡비: ${AVATAR_CLIP_ASPECT_RATIO} (세로형 고정)`);
    if (seedImage) {
      generateParams.image = seedImage;
      console.log(`🖼️ 시드 이미지 설정 완료 (첫 프레임, ${seedImage.mimeType}, ${Math.round(seedImage.imageBytes.length * 3 / 4)} bytes raw)`);
    }

    const operation = await withRetry(
      () => genAI.models.generateVideos(generateParams),
      3, 'generateVideos-avatar',
    );

    let result = operation;
    let attempts = 0;
    while (!result.done && attempts < VIDEO_CONFIG.maxPollingAttempts) {
      await new Promise(resolve => setTimeout(resolve, VIDEO_CONFIG.pollingIntervalMs));
      try {
        result = await withRetry(
          () => genAI.operations.getVideosOperation({ operation: result }),
          3, `poll-avatar-${attempts}`,
        );
      } catch (_) { /* non-transient or max-retried — keep polling */ }
      attempts++;
      console.log(`⏳ 아바타 클립 생성 중... (${attempts}/${VIDEO_CONFIG.maxPollingAttempts})`);
    }

    if (!result.done) {
      return { success: false, error: '비디오 생성 시간이 초과되었습니다.' };
    }
    if (result.error) {
      const msg = typeof result.error === 'object'
        ? (result.error as any).message || JSON.stringify(result.error)
        : String(result.error);
      return { success: false, error: msg };
    }

    const generatedVideos = result.response?.generatedVideos;
    if (!generatedVideos?.length) {
      const filteredCount = result.response?.raiMediaFilteredCount;
      const filteredReasons = result.response?.raiMediaFilteredReasons;
      console.warn(
        `⚠️ 아바타 클립 생성 결과 없음 — raiMediaFilteredCount=${filteredCount ?? 'N/A'}`,
        `reasons=${JSON.stringify(filteredReasons ?? [])}`,
        `hasSeedImage=${!!seedImage}`,
        `model=${effectiveModel}`,
        `resultKeys=${Object.keys(result).join(',')}`,
        `responseFull=${JSON.stringify(result.response ?? {})}`,
      );

      // Do NOT silently fall back to text-only generation — that would produce a
      // completely different person and mislead the operator into thinking the
      // seed image was used.  Return a clear error so the user can act on it.
      if (seedImage) {
        const reasonStr = filteredReasons?.join(', ') ?? '알 수 없음';
        console.warn(`⚠️ 시드 이미지가 RAI 필터에 의해 거부됨 (사유: ${reasonStr}) — 이미지 없이 생성하려면 중립 이미지를 제거하고 다시 시도하세요.`);
        return {
          success: false,
          error: `시드 이미지가 콘텐츠 안전 필터에 의해 거부되었습니다 (사유: ${reasonStr}). 페르소나의 중립 이미지를 변경하거나, 이미지 없이 생성하려면 중립 이미지를 제거한 후 다시 시도해 주세요.`,
        };
      }

      const reasonStr = filteredReasons?.join(', ') ?? '알 수 없음';
      return { success: false, error: `생성된 비디오가 없습니다 (콘텐츠 정책 차단). 사유: ${reasonStr}` };
    }

    const videoData = generatedVideos[0].video;
    if (!videoData) return { success: false, error: '비디오 데이터를 찾을 수 없습니다.' };

    let videoBytes: Uint8Array | undefined;
    if (videoData.uri) {
      videoBytes = await fetchVideoWithTimeout(videoData.uri, apiKey!);
    } else if (videoData.videoBytes) {
      if (typeof videoData.videoBytes === 'string') {
        const bin = atob(videoData.videoBytes);
        videoBytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) videoBytes[i] = bin.charCodeAt(i);
      } else {
        videoBytes = videoData.videoBytes as Uint8Array;
      }
    }

    if (!videoBytes) return { success: false, error: '비디오 바이트를 추출할 수 없습니다.' };

    // Build a stable, readable key that includes persona, gender and clip slot.
    // We use saveToFixedPath instead of saveVideo because saveVideo's safeTitle
    // sanitiser strips hyphens (e.g. "ac-idle" → "acidle"), producing garbled names.
    const safePersonaId = request.personaId.replace(/[^a-zA-Z0-9]/g, '-');
    const safeSlot     = clipSlot.replace(/_/g, '-'); // speaking_negative → speaking-negative
    const gender       = request.gender ?? 'unknown';
    const timestamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Veo hands back H.264/AAC in MP4 and sometimes pads the frame with black
    // letterbox bars; normalise both so the stored asset is playable and free of
    // the black band that `object-fit: cover` would otherwise expose.
    const normalized = await normalizeAvatarClip(videoBytes);

    const fixedKey     = `videos/avatar-${safePersonaId}-${gender}-${safeSlot}-${timestamp}.${normalized.extension}`;
    const storagePath  = await mediaStorage.saveToFixedPath(
      normalized.buffer,
      fixedKey,
      normalized.contentType,
    );

    trackVideoUsage({
      model: effectiveModel,
      provider: 'gemini',
      metadata: { personaId: request.personaId, slot: clipSlot, durationSeconds: 6 },
    });

    console.log(`✅ 아바타 클립 생성 완료: ${storagePath}`);

    return {
      success: true,
      videoUrl: storagePath,
      prompt: videoPrompt,
      metadata: { model: effectiveModel, provider: 'gemini', durationSeconds: 6, savedLocally: true },
    };
  } catch (error: any) {
    console.error('아바타 클립 생성 오류:', error);
    if (error.message?.includes('quota') || error.status === 429)
      return { success: false, error: 'API 요청 한도를 초과했습니다.' };
    if (error.message?.includes('safety') || error.message?.includes('policy'))
      return { success: false, error: '콘텐츠 정책에 위반됩니다.' };
    return { success: false, error: error.message || '알 수 없는 오류가 발생했습니다.' };
  }
}

export function getDefaultVideoPrompt(request: {
  scenarioTitle: string;
  description?: string;
  context?: {
    situation?: string;
    stakes?: string;
    timeline?: string;
  };
}): string {
  return generateVideoPrompt(request as VideoGenerationRequest);
}

/** Download a video from a URI with a 60-second timeout. */
async function fetchVideoWithTimeout(uri: string, apiKey: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const downloadUrl = new URL(uri);
    downloadUrl.searchParams.set('key', apiKey);
    const response = await fetch(downloadUrl.toString(), {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`비디오 다운로드 실패 - Status: ${response.status}, Body: ${errorText}`);
      throw new Error(`비디오 다운로드 실패: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('비디오 다운로드 시간이 초과되었습니다 (60초). 잠시 후 다시 시도해주세요.');
    }
    throw err;
  }
}
