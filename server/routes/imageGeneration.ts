import { Router } from 'express';
import { GoogleGenAI } from "@google/genai";
import * as fs from 'fs';
import * as path from 'path';

// Gemini 클라이언트 초기화
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenAI({ apiKey });

const router = Router();

// 시나리오 이미지 생성 엔드포인트
router.post('/generate-scenario-image', async (req, res) => {
  try {
    const { scenarioTitle, description, theme, industry, customPrompt } = req.body;

    if (!scenarioTitle) {
      return res.status(400).json({ 
        error: '시나리오 제목이 필요합니다.' 
      });
    }

    // 커스텀 프롬프트가 있으면 사용, 없으면 자동 생성
    const imagePrompt = customPrompt || generateImagePrompt(scenarioTitle, description, theme, industry);

    console.log(`🎨 Gemini 이미지 생성 요청: ${scenarioTitle}`);
    console.log(`프롬프트: ${imagePrompt}`);

    // Gemini 2.5 Flash Image를 사용한 이미지 생성 (올바른 API 사용법)
    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
    });
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageData = part.inlineData;
          imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
          break;
        }
      }
    }
    
    if (!imageUrl) {
      throw new Error('이미지가 생성되지 않았습니다.');
    }

    // base64 이미지를 로컬 파일로 저장
    const localImagePath = await saveImageToLocal(imageUrl, scenarioTitle);
    
    console.log(`✅ Gemini 이미지 생성 성공, 로컬 저장 완료: ${localImagePath}`);

    res.json({
      success: true,
      imageUrl: localImagePath, // 로컬 파일 경로 반환
      originalImageUrl: imageUrl, // 원본 base64 URL도 포함
      prompt: imagePrompt,
      metadata: {
        model: "gemini-2.5-flash-image-preview",
        provider: "gemini",
        savedLocally: true
      }
    });

  } catch (error: any) {
    console.error('Gemini 이미지 생성 오류:', error);
    
    // Gemini API 오류 처리
    if (error.message?.includes('quota') || error.status === 429) {
      return res.status(429).json({
        error: '요청 한도 초과',
        details: 'API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
        fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
      });
    }

    if (error.message?.includes('safety') || error.message?.includes('policy')) {
      return res.status(400).json({
        error: '콘텐츠 정책 위반',
        details: '생성하려는 이미지가 콘텐츠 정책에 위반됩니다. 다른 내용으로 시도해주세요.',
        fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
      });
    }

    // 일반적인 오류에 대한 폴백
    res.status(500).json({
      error: '이미지 생성 실패',
      details: error.message || '알 수 없는 오류가 발생했습니다.',
      fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
    });
  }
});

// 이미지 생성 프롬프트 구성 함수
function generateImagePrompt(title: string, description?: string, theme?: string, industry?: string): string {
  let prompt = "";
  let focusElement = "modern corporate office environment"; // 기본값 설정

  // 시나리오 제목 기반 핵심 요소 1-2개 추출 (간결하게)
  if (title.includes('파업') || title.includes('노사')) {
    focusElement = "business professionals in tense negotiation meeting";
  } else if (title.includes('앱') || title.includes('개발')) {
    focusElement = "modern tech office with developers at work";
  } else if (title.includes('협상') || title.includes('갈등')) {
    focusElement = "corporate meeting room with business professionals";
  } else if (title.includes('제조') || title.includes('공장')) {
    focusElement = "industrial factory floor with equipment";
  } else if (title.includes('프로젝트') || title.includes('일정')) {
    focusElement = "project team meeting around a table";
  }

  // 업종별 요소 (선택적, 간단하게) - title보다 우선순위 높음
  if (industry === '제조업') {
    focusElement = "industrial factory setting";
  } else if (industry === 'IT') {
    focusElement = "modern tech office space";
  } else if (industry === '금융') {
    focusElement = "professional banking office";
  }

  // 실사 사진 중심의 간결한 프롬프트 구성
  prompt = `Photorealistic documentary-style photograph of ${focusElement}. `;
  prompt += "Professional corporate photography, natural lighting, real business setting, ";
  prompt += "sharp focus, high quality, authentic workplace scene. ";
  prompt += "NO text, NO speech bubbles, NO captions, NO graphic overlays.";

  return prompt;
}

// base64 이미지를 로컬 파일로 저장하는 함수
async function saveImageToLocal(base64ImageUrl: string, scenarioTitle: string): Promise<string> {
  try {
    // base64 데이터에서 이미지 정보 추출
    const matches = base64ImageUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('유효하지 않은 base64 이미지 형식입니다.');
    }

    const mimeType = matches[1];
    const imageData = matches[2];
    
    // 파일 확장자 결정
    const extension = mimeType.includes('png') ? 'png' : 
                     mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 
                     'png'; // 기본값
    
    // 파일명 생성 (안전한 파일명으로 변환)
    const safeTitle = scenarioTitle
      .replace(/[^a-zA-Z0-9가-힣\s]/g, '') // 특수문자 제거
      .replace(/\s+/g, '-') // 공백을 하이픈으로
      .substring(0, 50); // 길이 제한
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${safeTitle}-${timestamp}.${extension}`;
    
    // 저장 경로 설정
    const imageDir = path.join(process.cwd(), 'scenarios', 'images');
    
    // 디렉토리가 없으면 생성
    if (!fs.existsSync(imageDir)) {
      fs.mkdirSync(imageDir, { recursive: true });
    }
    
    const filePath = path.join(imageDir, filename);
    
    // base64 데이터를 파일로 저장
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(filePath, buffer);
    
    // 웹에서 접근 가능한 상대 경로 반환
    const webPath = `/scenarios/images/${filename}`;
    
    console.log(`📁 이미지 로컬 저장 완료: ${webPath}`);
    return webPath;
    
  } catch (error) {
    console.error('이미지 로컬 저장 실패:', error);
    throw error;
  }
}

// 미리보기 이미지 생성 (더 빠른 응답을 위한 간단한 버전)
router.post('/generate-preview', async (req, res) => {
  try {
    const { scenarioTitle } = req.body;

    if (!scenarioTitle) {
      return res.status(400).json({ 
        error: '시나리오 제목이 필요합니다.' 
      });
    }

    // 간단한 프롬프트로 빠른 생성
    const simplePrompt = `A minimal, professional illustration representing "${scenarioTitle}", modern business style, clean composition, corporate colors, vector-like appearance`;

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-image-preview",
      contents: [{ role: 'user', parts: [{ text: simplePrompt }] }]
    });
    
    // 응답에서 이미지 데이터 추출
    let imageUrl = null;
    if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) {
      for (const part of result.candidates[0].content.parts) {
        if (part.inlineData) {
          const imageData = part.inlineData;
          imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
          break;
        }
      }
    }

    if (!imageUrl) {
      throw new Error('미리보기 이미지가 생성되지 않았습니다.');
    }

    // 미리보기 이미지도 로컬에 저장
    const localImagePath = await saveImageToLocal(imageUrl, scenarioTitle);
    
    res.json({
      success: true,
      imageUrl: localImagePath, // 로컬 파일 경로 반환
      originalImageUrl: imageUrl, // 원본 base64 URL도 포함
      prompt: simplePrompt,
      isPreview: true,
      metadata: {
        savedLocally: true
      }
    });

  } catch (error: any) {
    console.error('미리보기 이미지 생성 오류:', error);
    res.status(500).json({
      error: '미리보기 이미지 생성 실패',
      details: error.message,
      fallbackImageUrl: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1024&h=1024&fit=crop&auto=format'
    });
  }
});

// saveImageToLocal 함수도 export
export { saveImageToLocal };

export default router;