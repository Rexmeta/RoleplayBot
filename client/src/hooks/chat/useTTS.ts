import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";

const getSpeechSynthesisLang = (langCode: string): string => {
  const langMap: Record<string, string> = {
    'ko': 'ko-KR',
    'en': 'en-US',
    'ja': 'ja-JP',
    'zh': 'zh-CN'
  };
  return langMap[langCode] || 'ko-KR';
};

interface UseTTSOptions {
  personaId: string;
  personaGender: 'male' | 'female';
  inputMode: 'text' | 'tts' | 'realtime-voice';
}

export function useTTS({ personaId, personaGender, inputMode }: UseTTSOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  const lastSpokenMessageRef = useRef<string>("");
  const { toast } = useToast();
  const { i18n, t } = useTranslation();

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesisRef.current = window.speechSynthesis;
    }
  }, []);

  const getVoiceSettings = (emotion: string = '중립', gender: 'male' | 'female' = 'male') => {
    const baseSettings = {
      lang: getSpeechSynthesisLang(i18n.language),
      volume: 0.8,
    };

    const genderSettings = gender === 'female'
      ? { rate: 1.15, pitch: 1.4 }
      : { rate: 1.05, pitch: 1.2 };

    const emotionAdjustments: Record<string, { rate: number; pitch: number }> = {
      '기쁨': { rate: genderSettings.rate + 0.1, pitch: genderSettings.pitch + 0.1 },
      '슬픔': { rate: genderSettings.rate - 0.15, pitch: genderSettings.pitch - 0.2 },
      '분노': { rate: genderSettings.rate + 0.05, pitch: genderSettings.pitch - 0.1 },
      '놀람': { rate: genderSettings.rate + 0.2, pitch: genderSettings.pitch + 0.2 },
      '중립': genderSettings
    };

    return {
      ...baseSettings,
      ...(emotionAdjustments[emotion] || genderSettings)
    };
  };

  const waitForVoices = (): Promise<SpeechSynthesisVoice[]> => {
    return new Promise((resolve) => {
      const voices = speechSynthesisRef.current?.getVoices() || [];
      if (voices.length > 0) {
        resolve(voices);
      } else {
        const onVoicesChanged = () => {
          const newVoices = speechSynthesisRef.current?.getVoices() || [];
          if (newVoices.length > 0) {
            speechSynthesisRef.current?.removeEventListener('voiceschanged', onVoicesChanged);
            resolve(newVoices);
          }
        };
        speechSynthesisRef.current?.addEventListener('voiceschanged', onVoicesChanged);
        setTimeout(() => {
          speechSynthesisRef.current?.removeEventListener('voiceschanged', onVoicesChanged);
          resolve(speechSynthesisRef.current?.getVoices() || []);
        }, 3000);
      }
    });
  };

  const selectKoreanVoice = (voices: SpeechSynthesisVoice[], gender: string): SpeechSynthesisVoice | null => {
    const koreanVoices = voices.filter(voice =>
      voice.lang === 'ko-KR' || voice.lang.startsWith('ko')
    );

    if (koreanVoices.length === 0) {
      return null;
    }

    let selectedVoice: SpeechSynthesisVoice | null = null;

    if (gender === 'male') {
      selectedVoice = koreanVoices.find(voice => {
        const name = voice.name.toLowerCase();
        return name.includes('injoon') ||
               name.includes('남성') ||
               name.includes('male') ||
               name.includes('man');
      }) || null;
    } else {
      selectedVoice = koreanVoices.find(voice => {
        const name = voice.name.toLowerCase();
        return name.includes('heami') ||
               name.includes('yuna') ||
               name.includes('여성') ||
               name.includes('female') ||
               name.includes('woman') ||
               name.includes('google');
      }) || null;
    }

    if (!selectedVoice) {
      selectedVoice = koreanVoices[0];
    }

    return selectedVoice;
  };

  const stopSpeaking = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }

    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }

    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
    }

    setIsSpeaking(false);
  };

  const fallbackToWebSpeechAPI = async (text: string, emotion?: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) {
      toast({
        title: t('voice.notAvailable'),
        description: t('voice.notAvailableDesc'),
        variant: "destructive"
      });
      return;
    }

    if (!speechSynthesisRef.current) {
      speechSynthesisRef.current = window.speechSynthesis;
    }

    speechSynthesisRef.current.cancel();

    try {
      const cleanText = text.replace(/<[^>]*>/g, '').replace(/[*#_`]/g, '').replace(/\([^)]{1,30}\)/g, '').replace(/\s+/g, ' ').trim();
      const voiceSettings = getVoiceSettings(emotion, personaGender);

      const voices = await waitForVoices();
      const selectedVoice = selectKoreanVoice(voices, personaGender);

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = voiceSettings.lang;
      utterance.rate = voiceSettings.rate;
      utterance.pitch = voiceSettings.pitch;
      utterance.volume = voiceSettings.volume;

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => { setIsSpeaking(true); };
      utterance.onend = () => { setIsSpeaking(false); };

      utterance.onerror = (event) => {
        console.error('❌ 음성 재생 오류:', event);
        setIsSpeaking(false);
        toast({
          title: t('voice.playError'),
          description: t('voice.playErrorDesc'),
          variant: "destructive"
        });
      };

      speechSynthesisRef.current.speak(utterance);
    } catch (error) {
      console.error('❌ 브라우저 TTS 처리 중 오류:', error);
      setIsSpeaking(false);
      toast({
        title: t('voice.processingError'),
        description: t('voice.processingErrorDesc'),
        variant: "destructive"
      });
    }
  };

  const speakText = async (text: string, isAutoPlay: boolean = false, emotion?: string) => {
    if (inputMode === 'text' && isAutoPlay) return;
    if (isAutoPlay && lastSpokenMessageRef.current === text) return;

    stopSpeaking();

    try {
      setIsSpeaking(true);

      const response = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          scenarioId: personaId,
          emotion: emotion || '중립'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'TTS 생성 실패');
      }

      const data = await response.json();

      const audioBlob = new Blob(
        [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))],
        { type: 'audio/mpeg' }
      );

      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrlRef.current = audioUrl;
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;

      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        currentAudioUrlRef.current = null;
      };

      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        currentAudioUrlRef.current = null;
        toast({
          title: t('voice.playError'),
          description: t('voice.playErrorDesc'),
          variant: "destructive"
        });
      };

      if (isAutoPlay) {
        lastSpokenMessageRef.current = text;
      }

      await audio.play();
    } catch (error) {
      setIsSpeaking(false);
      console.error('ElevenLabs TTS 오류:', error);

      try {
        await fallbackToWebSpeechAPI(text, emotion);
      } catch (fallbackError) {
        console.error('백업 TTS도 실패:', fallbackError);
        if (!isAutoPlay) {
          toast({
            title: t('voice.serviceError'),
            description: t('voice.serviceErrorDesc'),
            variant: "destructive"
          });
        }
      }
    }
  };

  const cleanup = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
      speechSynthesisRef.current = null;
    }
  };

  return {
    isSpeaking,
    currentAudioRef,
    speakText,
    stopSpeaking,
    cleanup,
  };
}
