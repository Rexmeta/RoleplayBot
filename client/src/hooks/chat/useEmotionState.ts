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

const UNIQUE_EMOTION_ENS = Array.from(new Set(Object.values(emotionToEnglish)));
const uniqueEmotionCount = UNIQUE_EMOTION_ENS.length;

interface PersonaInfo {
  id: string;
  mbti?: string;
  gender?: string;
  name: string;
  image?: string;
  expressions?: Record<string, string>;
}

interface UseEmotionStateOptions {
  persona: PersonaInfo;
  conversationId: string;
  onReady?: () => void;
}

export function useEmotionState({ persona, conversationId, onReady }: UseEmotionStateOptions) {
  const [currentEmotion, setCurrentEmotion] = useState<string>('중립');
  const [isEmotionTransitioning, setIsEmotionTransitioning] = useState(false);
  const [personaImagesAvailable, setPersonaImagesAvailable] = useState<Record<string, boolean>>({});
  const [loadedImageUrl, setLoadedImageUrl] = useState<string>('');
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isOverlayFading, setIsOverlayFading] = useState(false);
  const initialLoadCompletedRef = useRef(false);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const getCharacterImage = (emotion: string): string | null => {
    const emotionEn = emotionToEnglish[emotion] || 'neutral';
    if (persona.expressions) {
      const url = persona.expressions[emotionEn];
      return url ? toMediaUrl(url) : null;
    }
    if (!persona.mbti && persona.image) {
      return emotionEn === 'neutral' ? persona.image : null;
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

  // 단일 Effect: 리셋 + 이미지 가용성 체크 (타이밍 충돌 방지)
  useEffect(() => {
    initialLoadCompletedRef.current = false;
    setIsInitialLoading(true);
    setIsOverlayFading(false);
    setLoadedImageUrl('');

    const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;

    const completeFallback = () => {
      if (initialLoadCompletedRef.current) return;
      initialLoadCompletedRef.current = true;
      setLoadedImageUrl(fallbackUrl);
      setIsOverlayFading(true);
      onReadyRef.current?.();
      setTimeout(() => setIsInitialLoading(false), 500);
    };

    const completeWithImage = (url: string) => {
      if (initialLoadCompletedRef.current) return;
      initialLoadCompletedRef.current = true;
      setLoadedImageUrl(url);
      setIsOverlayFading(true);
      onReadyRef.current?.();
      setTimeout(() => setIsInitialLoading(false), 500);
    };

    const fallbackTimer = setTimeout(completeFallback, 3000);

    if (persona.expressions) {
      // user persona: expressions 맵에서 즉시 가용성 결정
      const availability: Record<string, boolean> = {};
      for (const emotionEn of UNIQUE_EMOTION_ENS) {
        availability[emotionEn] = !!(persona.expressions[emotionEn]);
      }
      setPersonaImagesAvailable(availability);

      // neutral 표정으로 초기 로딩
      const neutralUrl = persona.expressions['neutral'];
      if (neutralUrl) {
        const fullUrl = toMediaUrl(neutralUrl);
        const img = new Image();
        img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(fullUrl); };
        img.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
        img.src = fullUrl;
      } else {
        clearTimeout(fallbackTimer);
        completeFallback();
      }
    } else if (!persona.mbti && persona.image) {
      // user persona: expressions 없지만 image(아바타)가 있는 경우 → neutral로 사용
      const availability: Record<string, boolean> = {};
      for (const emotionEn of UNIQUE_EMOTION_ENS) {
        availability[emotionEn] = false;
      }
      availability['neutral'] = true;
      setPersonaImagesAvailable(availability);
      const img = new Image();
      img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(persona.image!); };
      img.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
      img.src = persona.image;
    } else {
      // MBTI persona: HTTP 검사로 파일 존재 여부 확인
      setPersonaImagesAvailable({});
      const genderFolder = persona.gender || 'male';
      const mbtiId = persona.mbti?.toLowerCase() || persona.id;
      let checkedCount = 0;
      const newAvailability: Record<string, boolean> = {};

      const onAllChecked = () => {
        setPersonaImagesAvailable(newAvailability);
        const neutralAvail = newAvailability['neutral'];
        if (neutralAvail) {
          const imgUrl = toMediaUrl(`personas/${mbtiId}/${genderFolder}/neutral.webp`);
          const img = new Image();
          img.onload = () => { clearTimeout(fallbackTimer); completeWithImage(imgUrl); };
          img.onerror = () => { clearTimeout(fallbackTimer); completeFallback(); };
          img.src = imgUrl;
        } else {
          clearTimeout(fallbackTimer);
          completeFallback();
        }
      };

      for (const emotionEn of UNIQUE_EMOTION_ENS) {
        const img = new Image();
        img.onload = () => {
          newAvailability[emotionEn] = true;
          checkedCount++;
          if (checkedCount === uniqueEmotionCount) onAllChecked();
        };
        img.onerror = () => {
          newAvailability[emotionEn] = false;
          checkedCount++;
          if (checkedCount === uniqueEmotionCount) onAllChecked();
        };
        img.src = toMediaUrl(`personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`);
      }
    }

    return () => clearTimeout(fallbackTimer);
  }, [persona.id, persona.name, persona.mbti, persona.gender, persona.expressions, conversationId]);

  // 감정 변경 시 이미지 프리로드
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
