import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';
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

    const videoModel = await getModelForFeature('video');

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
        error: '생성된 비디오가 없습니다.',
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

    const localVideoPath = await mediaStorage.saveVideo(videoBytes, request.scenarioId, request.scenarioTitle);
    
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

export type AvatarClipState =
  | 'idle'
  | 'listening'
  | 'listening_nod'
  | 'thinking'
  | 'speaking'
  | 'speaking_pause';

export interface AvatarClipRequest {
  personaId: string;
  state: AvatarClipState;
  styleHint?: string;
  gender?: 'male' | 'female';
  neutralImageUrl?: string;
  /** Optional free-text rider appended after the base state prompt. */
  extraPrompt?: string;
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
 * Build a Veo prompt for an avatar clip state.
 *
 * Design intent: prompts describe ONLY body posture and motion — no appearance,
 * no ethnicity, no gender.  The person's looks come from the seed image.
 * Mouth is kept closed/still in every state to avoid lip-sync policy issues.
 */
export function generateAvatarClipPrompt(request: AvatarClipRequest): string {
  const { state, styleHint } = request;

  // Reject styleHints that contain policy-violating language.
  // Even though the hint is not injected into the prompt today, we validate it
  // at the boundary so callers get a clear error rather than silent acceptance.
  if (styleHint !== undefined && styleHint !== '') {
    validateStyleHint(styleHint);
  }

  // styleHint is intentionally not injected — appearance is provided via seed image.

  // Design principles for all states:
  // 1. Seamless perfect loop — clip ends on the identical frame it started; no visible cut.
  // 2. Camera is always locked off — no zoom, pan, dolly, or any camera movement whatsoever.
  // 3. All states except "speaking": lips remain sealed shut; mouth does not open at all.
  // 4. idle / listening / thinking / speaking_pause: near-zero motion; only eye blinks.
  // 5. speaking: natural animated expression including mouth movement is intentional.
  const stateDescriptions: Record<AvatarClipState, string> = {
    idle:
      'Upper body of a person sitting completely still in a neutral resting pose. ' +
      'Only motion allowed: natural eye blinks. ' +
      'Lips sealed shut — mouth does not open. No head movement whatsoever, no nodding, no tilting. ' +
      'No body sway, no gestures, no shoulder movement. Calm, neutral expression. ' +
      'Static locked-off camera — no zoom, no pan, no movement. Soft indoor lighting, no text. ' +
      'Seamless perfect loop — first and last frames identical. Loopable. 6 seconds.',
    listening:
      'Upper body of a person sitting in a fixed attentive pose, holding perfectly still. ' +
      'Only motion allowed: natural eye blinks. ' +
      'Lips sealed shut — mouth does not open. No head tilting, no nodding, no body movement. ' +
      'Focused, calm expression. ' +
      'Static locked-off camera — no zoom, no pan, no movement. Soft indoor lighting, no text. ' +
      'Seamless perfect loop — first and last frames identical. Loopable. 6 seconds.',
    listening_nod:
      'Upper body of a person performing one single slow shallow nod — head dips only slightly then ' +
      'returns to the exact starting position. ' +
      'Lips sealed shut throughout — mouth does not open. No other body movement. ' +
      'Static locked-off camera — no zoom, no pan, no movement. Soft indoor lighting, no text. ' +
      'Seamless perfect loop — head ends at the exact same angle as the start. Loopable. 6 seconds.',
    thinking:
      'Upper body of a person sitting completely still in quiet contemplation. ' +
      'Only motion allowed: natural eye blinks; eyes may drift very slightly once then return to centre. ' +
      'Lips sealed shut — mouth does not open. Zero head movement, zero body movement. ' +
      'Thoughtful, calm expression. ' +
      'Static locked-off camera — no zoom, no pan, no movement. Soft indoor lighting, no text. ' +
      'Seamless perfect loop — first and last frames identical. Loopable. 6 seconds.',
    speaking:
      'Upper body of a person engaged in lively conversation, animated posture and expressive face. ' +
      'Lips and jaw articulate actively as if talking. ' +
      'Small, contained wrist-level hand gesture once, returning to rest by the end. Slight forward lean. ' +
      'Static locked-off camera — no zoom, no pan, no camera motion. Soft indoor lighting, no text. ' +
      'Seamless perfect loop — pose and hands return to starting position by the final frame. Loopable. 6 seconds.',
    speaking_pause:
      'Upper body of a person sitting still in a composed upright pose, momentarily paused. ' +
      'Only motion allowed: natural eye blinks and a single slow breath. ' +
      'Lips sealed shut — mouth does not open. No head movement, no gestures. ' +
      'Static locked-off camera — no zoom, no pan, no movement. Soft indoor lighting, no text. ' +
      'Seamless perfect loop — first and last frames identical. Loopable. 6 seconds.',
  };

  const base = stateDescriptions[state] ?? stateDescriptions['idle'];
  // Append caller-supplied extra prompt after the base description.
  const extra = request.extraPrompt?.trim();
  return extra ? `${base} ${extra}` : base;
}

/**
 * Generate a single avatar clip (looping video for the given AvatarClipState)
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
    const videoModel = await getModelForFeature('video');

    console.log(`🎬 아바타 클립 생성 요청: ${request.personaId} / ${request.state} / gender:${request.gender ?? 'unspecified'}`);
    console.log(`프롬프트: ${videoPrompt}`);

    // Build optional seed image parameter.
    // The Gemini API only accepts imageBytes (base64) — gcsUri is NOT supported.
    // mediaStorage.readImageBuffer() handles the full storage chain:
    //   Replit Object Storage sidecar → GCS fallback
    // This works correctly even when the local sidecar cache is cold or files
    // live only in GCS (the dual-write backend keeps them in sync).
    let seedImage: { imageBytes: string; mimeType: string } | undefined;
    if (request.neutralImageUrl) {
      try {
        const key = request.neutralImageUrl.replace(/^\/+/, '');
        const imgBuf = await mediaStorage.readImageBuffer(key);
        if (imgBuf && imgBuf.byteLength > 0) {
          const ext = path.extname(key).toLowerCase().replace('.', '');
          const mimeType = ext === 'webp' ? 'image/webp'
            : ext === 'png'  ? 'image/png'
            : 'image/jpeg';
          seedImage = { imageBytes: imgBuf.toString('base64'), mimeType };
          console.log(`🖼️ 시드 이미지 로드: ${key} (${mimeType}, ${imgBuf.byteLength} bytes)`);
        } else {
          console.warn(`⚠️ 시드 이미지를 찾을 수 없음: ${key} — 텍스트 프롬프트만 사용`);
        }
      } catch (imgErr: any) {
        console.warn(`⚠️ 시드 이미지 처리 오류: ${imgErr.message} — 텍스트 프롬프트만 사용`);
      }
    }

    const generateParams: any = { model: videoModel, prompt: videoPrompt };
    if (seedImage) generateParams.image = seedImage;

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
      return { success: false, error: '생성된 비디오가 없습니다.' };
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

    // Build a stable, readable key that includes persona, gender and state.
    // We use saveToFixedPath instead of saveVideo because saveVideo's safeTitle
    // sanitiser strips hyphens (e.g. "ac-idle" → "acidle"), producing garbled names.
    const safePersonaId = request.personaId.replace(/[^a-zA-Z0-9]/g, '-');
    const safeState    = (request.state as string).replace(/_/g, '-'); // listening_nod → listening-nod
    const gender       = request.gender ?? 'unknown';
    const timestamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fixedKey     = `videos/avatar-${safePersonaId}-${gender}-${safeState}-${timestamp}.webm`;
    const storagePath  = await mediaStorage.saveToFixedPath(
      Buffer.from(videoBytes),
      fixedKey,
      'video/webm',
    );

    trackVideoUsage({
      model: videoModel,
      provider: 'gemini',
      metadata: { personaId: request.personaId, state: request.state, durationSeconds: 6 },
    });

    console.log(`✅ 아바타 클립 생성 완료: ${storagePath}`);

    return {
      success: true,
      videoUrl: storagePath,
      prompt: videoPrompt,
      metadata: { model: videoModel, provider: 'gemini', durationSeconds: 6, savedLocally: true },
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
