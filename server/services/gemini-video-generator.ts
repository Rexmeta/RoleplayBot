import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { trackVideoUsage } from './aiUsageTracker';
import { mediaStorage } from './mediaStorage';

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

const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

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
      error: 'GOOGLE_API_KEY 또는 GEMINI_API_KEY가 설정되지 않았습니다.'
    };
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    
    const videoPrompt = request.customPrompt || generateVideoPrompt(request);
    
    console.log(`🎬 Gemini Veo 비디오 생성 요청: ${request.scenarioTitle}`);
    console.log(`프롬프트: ${videoPrompt}`);

    const operation = await genAI.models.generateVideos({
      model: "veo-3.1-generate-preview",
      prompt: videoPrompt,
    });

    console.log('📋 Veo API 응답 - 작업 시작됨:', operation.name);

    let result = operation;
    let attempts = 0;
    
    while (!result.done && attempts < VIDEO_CONFIG.maxPollingAttempts) {
      await new Promise(resolve => setTimeout(resolve, VIDEO_CONFIG.pollingIntervalMs));
      
      try {
        result = await genAI.operations.getVideosOperation({ operation: result });
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
      
      const downloadUrl = new URL(videoData.uri);
      downloadUrl.searchParams.set('key', apiKey!);
      
      const response = await fetch(downloadUrl.toString(), {
        headers: {
          'x-goog-api-key': apiKey!
        }
      });
      
      if (!response.ok) {
        console.error(`비디오 다운로드 실패 - Status: ${response.status}, StatusText: ${response.statusText}`);
        const errorText = await response.text().catch(() => '');
        console.error(`응답 내용: ${errorText}`);
        throw new Error(`비디오 다운로드 실패: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      videoBytes = new Uint8Array(arrayBuffer);
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
      model: 'veo-3.1-generate-preview',
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
        model: "veo-3.1-generate-preview",
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
    if (!videoUrl.startsWith('/scenarios/videos/')) {
      console.log('외부 URL이므로 삭제하지 않음:', videoUrl);
      return true;
    }
    
    const filePath = path.join(process.cwd(), videoUrl.slice(1));
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ 비디오 파일 삭제 완료: ${filePath}`);
      return true;
    }
    
    console.log('삭제할 파일이 존재하지 않음:', filePath);
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
