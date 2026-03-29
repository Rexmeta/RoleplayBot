import { useState, useEffect, useRef } from "react";
import { toMediaUrl } from "@/lib/mediaUrl";

export const emotionToEnglish: Record<string, string> = {
  '중립': 'neutral', '기쁨': 'happy', '슬픔': 'sad', '분노': 'angry', '놀람': 'surprised',
  '호기심': 'curious', '불안': 'anxious', '피로': 'tired', '실망': 'disappointed', '당혹': 'confused',
  '단호': 'determined',
  'neutral': 'neutral', 'happy': 'happy', 'sad': 'sad', 'angry': 'angry', 'surprised': 'surprised',
  'curious': 'curious', 'anxious': 'anxious', 'tired': 'tired', 'disappointed': 'disappointed', 'confused': 'confused',
  '中立': 'neutral', '喜悦': 'happy', '悲伤': 'sad', '愤怒': 'angry', '惊讶': 'surprised',
  '好奇': 'curious', '焦虑': 'anxious', '疲劳': 'tired', '失望': 'disappointed', '困惑': 'confused',
  '喜び': 'happy', '悲しみ': 'sad', '怒り': 'angry', '驚き': 'surprised',
  '好奇心': 'curious', '不安': 'anxious'
};

export const emotionEmojis: { [key: string]: string } = {
  '기쁨': '😊', '슬픔': '😢', '분노': '😠', '놀람': '😲', '중립': '😐',
  '호기심': '🤔', '불안': '😰', '피로': '😩', '실망': '😞', '당혹': '😕', '단호': '😤',
  'happy': '😊', 'sad': '😢', 'angry': '😠', 'surprised': '😲', 'neutral': '😐',
  'curious': '🤔', 'anxious': '😰', 'tired': '😩', 'disappointed': '😞', 'confused': '😕',
  '喜悦': '😊', '悲伤': '😢', '愤怒': '😠', '惊讶': '😲', '中立': '😐',
  '好奇': '🤔', '焦虑': '😰', '疲劳': '😩', '失望': '😞', '困惑': '😕',
  '喜び': '😊', '悲しみ': '😢', '怒り': '😠', '驚き': '😲',
  '好奇心': '🤔', '不安': '😰'
};

const uniqueEmotionCount = new Set(Object.values(emotionToEnglish)).size;

interface PersonaInfo {
  id: string;
  mbti?: string;
  gender?: string;
  name: string;
  image?: string;
  expressions?: Record<string, string>; // user persona 표정 맵
}

interface UseEmotionStateOptions {
  persona: PersonaInfo;
  conversationId: string;
  onReady?: () => void;
}

export function useEmotionState({ persona, conversationId, onReady }: UseEmotionStateOptions) {
  const [currentEmotion, setCurrentEmotion] = useState<string>('중립');
  const [isEmotionTransitioning, setIsEmotionTransitioning] = useState(false);
  const [personaImagesAvailable, setPersonaImagesAvailable] = useState<{ [key: string]: boolean }>({});
  const [loadedImageUrl, setLoadedImageUrl] = useState<string>('');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isOverlayFading, setIsOverlayFading] = useState(false);
  const initialLoadCompletedRef = useRef(false);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // user persona: expressions 맵에서 직접 URL 반환
  // MBTI persona: 기존 GCS 파일 경로 패턴 사용
  const getCharacterImage = (emotion: string): string | null => {
    const emotionEn = emotionToEnglish[emotion] || 'neutral';

    if (persona.expressions) {
      const url = persona.expressions[emotionEn];
      return url ? toMediaUrl(url) : null;
    }

    const genderFolder = persona.gender || 'male';
    const mbtiId = persona.mbti?.toLowerCase() || persona.id;
    if (personaImagesAvailable[emotionEn]) {
      return toMediaUrl(`personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`);
    }
    return null;
  };

  const hasNoPersonaImages = Object.values(personaImagesAvailable).every(v => v === false) &&
    Object.keys(personaImagesAvailable).length === uniqueEmotionCount;

  const preloadImage = (imageUrl: string) => {
    const img = new Image();
    img.onload = () => {
      setTimeout(() => {
        setLoadedImageUrl(imageUrl);
        setIsEmotionTransitioning(false);
      }, 100);
    };
    img.onerror = () => {
      setIsEmotionTransitioning(false);
    };
    img.src = imageUrl;
  };

  // user persona: expressions 맵에서 이미지 가용성 즉시 결정
  // MBTI persona: HTTP 검사로 파일 존재 여부 확인
  useEffect(() => {
    if (persona.expressions) {
      const availability: { [key: string]: boolean } = {};
      const uniqueEmotionEns = Array.from(new Set(Object.values(emotionToEnglish)));
      for (const emotionEn of uniqueEmotionEns) {
        availability[emotionEn] = !!(persona.expressions[emotionEn]);
      }
      setPersonaImagesAvailable(availability);
      return;
    }

    const checkPersonaImages = async () => {
      const genderFolder = persona.gender || 'male';
      const mbtiId = persona.mbti?.toLowerCase() || persona.id;
      const uniqueEmotionEns = Array.from(new Set(Object.values(emotionToEnglish)));
      const checkPromises = uniqueEmotionEns.map((emotionEn) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            setPersonaImagesAvailable(prev => ({ ...prev, [emotionEn]: true }));
            resolve();
          };
          img.onerror = () => {
            setPersonaImagesAvailable(prev => ({ ...prev, [emotionEn]: false }));
            resolve();
          };
          img.src = toMediaUrl(`personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`);
        });
      });
      await Promise.all(checkPromises);
    };

    checkPersonaImages();
  }, [persona.id, persona.mbti, persona.gender, persona.expressions, conversationId]);

  useEffect(() => {
    initialLoadCompletedRef.current = false;
    setIsInitialLoading(true);
    setIsOverlayFading(false);
    setPersonaImagesAvailable({});
    setLoadedImageUrl('');

    const timeoutId = setTimeout(() => {
      if (!initialLoadCompletedRef.current) {
        initialLoadCompletedRef.current = true;
        const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;
        setLoadedImageUrl(fallbackUrl);
        setIsOverlayFading(true);
        onReadyRef.current?.();
        setTimeout(() => {
          setIsInitialLoading(false);
        }, 500);
      }
    }, 3000);

    return () => clearTimeout(timeoutId);
  }, [persona.id, persona.name, conversationId]);

  useEffect(() => {
    if (initialLoadCompletedRef.current) return;

    const allEmotionsChecked = Object.keys(personaImagesAvailable).length === uniqueEmotionCount;
    if (!allEmotionsChecked) return;

    const initialImageUrl = getCharacterImage('중립');

    const completeInitialLoad = (imageUrl?: string) => {
      if (initialLoadCompletedRef.current) return;
      initialLoadCompletedRef.current = true;

      if (imageUrl) {
        setLoadedImageUrl(imageUrl);
      }
      setIsOverlayFading(true);
      onReadyRef.current?.();
      setTimeout(() => {
        setIsInitialLoading(false);
      }, 500);
    };

    if (initialImageUrl) {
      const img = new Image();
      img.onload = () => { completeInitialLoad(initialImageUrl); };
      img.onerror = () => {
        const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;
        setLoadedImageUrl(fallbackUrl);
        completeInitialLoad();
      };
      img.src = initialImageUrl;
    } else {
      const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;
      setLoadedImageUrl(fallbackUrl);
      completeInitialLoad();
    }
  }, [personaImagesAvailable, persona.id, persona.gender, persona.mbti, persona.name]);

  useEffect(() => {
    if (currentEmotion) {
      const newImageUrl = getCharacterImage(currentEmotion);
      if (newImageUrl) {
        preloadImage(newImageUrl);
      }
    }
  }, [currentEmotion]);

  return {
    currentEmotion,
    setCurrentEmotion,
    isEmotionTransitioning,
    setIsEmotionTransitioning,
    personaImagesAvailable,
    loadedImageUrl,
    isInitialLoading,
    isOverlayFading,
    hasNoPersonaImages,
    getCharacterImage,
    preloadImage,
  };
}
