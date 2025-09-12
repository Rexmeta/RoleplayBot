import { readFileSync } from 'fs';
import { join } from 'path';

// MBTI 페르소나 데이터 타입 정의
export interface MBTIPersona {
  id: string;
  mbti: string;
  personality_traits: string[];
  communication_style: string;
  motivation: string;
  fears: string[];
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
  image: {
    profile: string;
    style: string;
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
    // 캐시에서 먼저 확인
    if (mbtiCache.has(personaRef)) {
      return mbtiCache.get(personaRef)!;
    }

    // personas 폴더 경로 설정
    const personasPath = join(process.cwd(), 'personas', personaRef);
    
    // JSON 파일 읽기
    const fileContent = readFileSync(personasPath, 'utf-8');
    const mbtiPersona: MBTIPersona = JSON.parse(fileContent);
    
    // 캐시에 저장
    mbtiCache.set(personaRef, mbtiPersona);
    
    console.log(`✅ MBTI Persona loaded: ${mbtiPersona.mbti} (${mbtiPersona.id})`);
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
    image: mbtiData.image
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
 * MBTI 캐시를 초기화하는 함수 (개발/테스트용)
 */
export function clearMBTICache(): void {
  mbtiCache.clear();
  console.log('🗑️ MBTI cache cleared');
}