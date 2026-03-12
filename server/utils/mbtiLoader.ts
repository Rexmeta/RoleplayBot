import { readFileSync } from 'fs';
import { join } from 'path';
import { GlobalMBTICache } from './globalMBTICache';

// MBTI 페르소나 데이터 타입 정의
export interface MBTIPersona {
  id: string;
  mbti: string;
  personality_traits: string[];
  communication_style: string;
  motivation: string;
  fears: string[];
  speech_style?: {
    formality: string;
    sentence_endings: string[];
    filler_words: string[];
    characteristic_expressions: string[];
  };
  reaction_phrases?: {
    agreement: string[];
    disagreement: string[];
    surprise: string[];
    thinking: string[];
    empathy: string[];
  };
  background: {
    personal_values: string[];
    hobbies: string[];
    social: {
      preference: string;
      behavior: string;
    };
  };
  communication_patterns: {
    opening_style: string;
    key_phrases: string[];
    response_to_arguments: {
      [key: string]: string;
    };
    win_conditions: string[];
  };
  voice: {
    tone: string;
    pace: string;
    emotion: string;
  };
  images: {
    base: string;  // 기본 프로필 이미지
    style: string;  // 이미지 스타일 설명
    expressions: {
      중립: string;
      기쁨: string;
      슬픔: string;
      분노: string;
      놀람: string;
      호기심: string;
      불안: string;
      피로: string;
      실망: string;
      당혹: string;
    };
  };
}

// MBTI 데이터 캐시 (메모리 최적화)
const mbtiCache = new Map<string, MBTIPersona>();

/**
 * personas 폴더에서 MBTI JSON 파일을 로드하는 함수
 * @param personaRef - 예: "istj.json" 또는 "entj.json"
 * @returns MBTIPersona 객체 또는 null
 */
export async function loadMBTIPersona(personaRef: string): Promise<MBTIPersona | null> {
  try {
    // 보안: personaRef 검증 (path traversal 방지)
    const allowedTypes = getAvailableMBTITypes();
    const baseFileName = personaRef.replace('.json', '');
    
    if (!allowedTypes.includes(baseFileName) || personaRef.includes('..') || personaRef.includes('/')) {
      console.error(`❌ Invalid personaRef: ${personaRef}`);
      return null;
    }
    
    const normalizedRef = `${baseFileName}.json`;

    // 로컬 캐시에서 먼저 확인
    if (mbtiCache.has(normalizedRef)) {
      return mbtiCache.get(normalizedRef)!;
    }

    // GlobalMBTICache 확인 (서버 시작 시 프리로드된 데이터 재사용)
    const globalCache = GlobalMBTICache.getInstance();
    if (globalCache.isWarmUp()) {
      const cached = globalCache.getMBTIPersona(normalizedRef);
      if (cached) {
        mbtiCache.set(normalizedRef, cached);
        return cached;
      }
    }

    // 폴백: 파일에서 직접 읽기
    const personasPath = join(process.cwd(), 'personas', normalizedRef);
    const fileContent = readFileSync(personasPath, 'utf-8');
    const mbtiPersona: MBTIPersona = JSON.parse(fileContent);
    
    mbtiCache.set(normalizedRef, mbtiPersona);
    return mbtiPersona;
    
  } catch (error) {
    console.error(`❌ Failed to load MBTI persona from ${personaRef}:`, error);
    return null;
  }
}

/**
 * 시나리오 페르소나와 MBTI 데이터를 결합하는 함수
 * @param scenarioPersona - 시나리오에서 가져온 페르소나 정보
 * @param personaRef - MBTI JSON 파일 참조 (예: "istj.json")
 * @returns 결합된 페르소나 정보
 */
export async function enrichPersonaWithMBTI(scenarioPersona: any, personaRef?: string): Promise<any> {
  if (!personaRef) {
    console.warn(`⚠️ No personaRef provided for persona ${scenarioPersona.name}`);
    return scenarioPersona;
  }

  const mbtiData = await loadMBTIPersona(personaRef);
  
  if (!mbtiData) {
    console.warn(`⚠️ Could not load MBTI data for ${personaRef}, using scenario data only`);
    return scenarioPersona;
  }

  // MBTI 상세 정보로 시나리오 페르소나 보강
  const enrichedPersona = {
    ...scenarioPersona,
    mbti: mbtiData.mbti,
    personality_traits: mbtiData.personality_traits,
    communication_style: mbtiData.communication_style,
    motivation: mbtiData.motivation,
    fears: mbtiData.fears,
    background: mbtiData.background,
    communication_patterns: mbtiData.communication_patterns,
    voice: mbtiData.voice,
    images: mbtiData.images
  };

  console.log(`🔗 Persona enriched: ${scenarioPersona.name} with ${mbtiData.mbti} traits`);
  return enrichedPersona;
}

/**
 * 사용 가능한 모든 MBTI 유형 목록을 반환
 * @returns MBTI 유형 문자열 배열
 */
export function getAvailableMBTITypes(): string[] {
  return [
    'istj', 'isfj', 'infj', 'intj',
    'istp', 'isfp', 'infp', 'intp', 
    'estp', 'esfp', 'enfp', 'entp',
    'estj', 'esfj', 'enfj', 'entj'
  ];
}

/**
 * 시나리오 페르소나에 가벼운 MBTI 정보만 추가 (목록 표시용)
 * @param scenarioPersona - 시나리오에서 가져온 페르소나 정보
 * @param personaRef - MBTI JSON 파일 참조
 * @returns MBTI와 experience만 포함된 페르소나
 */
export async function enrichPersonaWithBasicMBTI(scenarioPersona: any, personaRef?: string): Promise<any> {
  if (!personaRef) {
    return scenarioPersona;
  }

  const mbtiData = await loadMBTIPersona(personaRef);
  
  if (!mbtiData) {
    return scenarioPersona;
  }

  // 가벼운 정보만 추가 (목록 표시용)
  return {
    ...scenarioPersona,
    mbti: mbtiData.mbti
  };
}

/**
 * 이미지 경로를 성별별 폴더 구조로 변환 (구 형식 → 새 형식)
 * @param persona - 페르소나 객체
 * @param gender - 성별 ('male' | 'female')
 * @returns 변환된 페르소나 객체
 */
export function transformImagePathsByGender(persona: any, gender: 'male' | 'female' = 'male'): any {
  if (!persona.images || !persona.images.expressions) {
    return persona;
  }

  // 이미지 경로 변환: /personas/enfj/neutral.png → /personas/enfj/male/neutral.png
  const transformPath = (path: string, gender: string): string => {
    if (!path) return path;
    
    // 이미 성별 폴더가 있으면 그대로 반환
    if (path.includes('/male/') || path.includes('/female/')) {
      return path;
    }
    
    // /personas/{id}/{emotion}.png → /personas/{id}/{gender}/{emotion}.png
    const regex = /^(\/personas\/[^/]+)\/([^/]+\.png)$/;
    const match = path.match(regex);
    
    if (match) {
      return `${match[1]}/${gender}/${match[2]}`;
    }
    
    return path;
  };

  // 이미지 경로 변환
  const transformedPersona = {
    ...persona,
    images: {
      ...persona.images,
      expressions: Object.entries(persona.images.expressions).reduce((acc, [key, path]) => {
        acc[key as keyof typeof persona.images.expressions] = transformPath(path as string, gender);
        return acc;
      }, {} as typeof persona.images.expressions)
    }
  };

  return transformedPersona;
}

/**
 * MBTI 캐시를 초기화하는 함수 (개발/테스트용)
 */
export function clearMBTICache(): void {
  mbtiCache.clear();
  console.log('🗑️ MBTI cache cleared');
}