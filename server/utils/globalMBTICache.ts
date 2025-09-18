import { join } from 'path';
import { readFileSync, readdirSync } from 'fs';
import type { MBTIPersona } from './mbtiLoader';

/**
 * 글로벌 MBTI 캐시 시스템
 * 서버 시작 시 모든 MBTI 데이터를 메모리에 로드하여 성능 향상
 */
export class GlobalMBTICache {
  private static instance: GlobalMBTICache | null = null;
  private cache: Map<string, MBTIPersona> = new Map();
  private enrichedPersonaCache: Map<string, any> = new Map();
  private isLoaded = false;

  private constructor() {}

  static getInstance(): GlobalMBTICache {
    if (!this.instance) {
      this.instance = new GlobalMBTICache();
    }
    return this.instance;
  }

  /**
   * 서버 시작 시 모든 MBTI 데이터를 프리로드
   */
  async preloadAllMBTIData(): Promise<void> {
    if (this.isLoaded) return;

    console.log('🚀 Preloading all MBTI personas for optimal performance...');
    const startTime = Date.now();

    try {
      const personasDir = join(process.cwd(), 'personas');
      const files = readdirSync(personasDir).filter(file => file.endsWith('.json'));
      
      // 병렬로 모든 MBTI 파일 로드
      const loadPromises = files.map(async (file) => {
        try {
          const filePath = join(personasDir, file);
          const fileContent = readFileSync(filePath, 'utf-8');
          const mbtiPersona: MBTIPersona = JSON.parse(fileContent);
          
          const key = file; // e.g., 'infj.json'
          this.cache.set(key, mbtiPersona);
          
          return { file, success: true };
        } catch (error) {
          console.error(`❌ Failed to load ${file}:`, error);
          return { file, success: false };
        }
      });

      const results = await Promise.all(loadPromises);
      const successCount = results.filter(r => r.success).length;
      const loadTime = Date.now() - startTime;

      console.log(`✅ MBTI Cache preloaded: ${successCount}/${files.length} personas in ${loadTime}ms`);
      this.isLoaded = true;

    } catch (error) {
      console.error('❌ Failed to preload MBTI data:', error);
      throw error;
    }
  }

  /**
   * 캐시된 MBTI 데이터 반환 (즉시 반환)
   */
  getMBTIPersona(personaRef: string): MBTIPersona | null {
    // 보안 검증
    if (personaRef.includes('..') || personaRef.includes('/')) {
      console.error(`❌ Invalid personaRef: ${personaRef}`);
      return null;
    }

    // .json 확장자 정규화
    const normalizedRef = personaRef.endsWith('.json') ? personaRef : `${personaRef}.json`;
    
    const persona = this.cache.get(normalizedRef);
    if (!persona) {
      console.warn(`⚠️ MBTI persona not found in cache: ${normalizedRef}`);
      return null;
    }

    return persona;
  }

  /**
   * enriched persona 캐시 관리
   */
  setEnrichedPersona(key: string, persona: any): void {
    this.enrichedPersonaCache.set(key, persona);
  }

  getEnrichedPersona(key: string): any | null {
    return this.enrichedPersonaCache.get(key) || null;
  }

  /**
   * 캐시 상태 정보 반환
   */
  getCacheStats(): {
    mbtiCount: number;
    enrichedCount: number;
    isLoaded: boolean;
    availableTypes: string[];
  } {
    return {
      mbtiCount: this.cache.size,
      enrichedCount: this.enrichedPersonaCache.size,
      isLoaded: this.isLoaded,
      availableTypes: Array.from(this.cache.keys()).map(key => key.replace('.json', ''))
    };
  }

  /**
   * 사용 가능한 MBTI 타입 목록 반환
   */
  getAvailableTypes(): string[] {
    return Array.from(this.cache.keys()).map(key => key.replace('.json', ''));
  }

  /**
   * 캐시 리셋 (개발/테스트용)
   */
  clearCache(): void {
    this.cache.clear();
    this.enrichedPersonaCache.clear();
    this.isLoaded = false;
    console.log('🗑️ MBTI cache cleared');
  }

  /**
   * 캐시 워밍업 체크
   */
  isWarmUp(): boolean {
    return this.isLoaded && this.cache.size > 0;
  }
}