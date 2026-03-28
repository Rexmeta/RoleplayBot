import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const getSpeechSynthesisLang = (langCode: string): string => {
  const langMap: Record<string, string> = {
    'ko': 'ko-KR',
    'en': 'en-US',
    'ja': 'ja-JP',
    'zh': 'zh-CN'
  };
  return langMap[langCode] || 'ko-KR';
};

const VOICE_INPUT_MARKER = '🎤';

const removeInterimText = (text: string): string => {
  const markerPattern = new RegExp(`\\[${VOICE_INPUT_MARKER}.*?\\].*$`);
  return text.replace(markerPattern, '').trim();
};

interface UseVoiceRecordingOptions {
  onTranscript: (text: string) => void;
  onInterimTranscript: (text: string) => void;
}

export function useVoiceRecording({ onTranscript, onInterimTranscript }: UseVoiceRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();
  const { i18n, t } = useTranslation();

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = getSpeechSynthesisLang(i18n.language);
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          const result = event.results[0];
          const transcript = result[0].transcript;

          if (result.isFinal) {
            onTranscript(transcript.trim());
          } else {
            onInterimTranscript(`[${VOICE_INPUT_MARKER}] ${transcript.trim()}`);
          }
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);

          let errorMessage = t('voice.recognitionFailed');
          if (event.error === 'no-speech') {
            errorMessage = t('voice.noSpeech');
          } else if (event.error === 'not-allowed') {
            errorMessage = t('voice.notAllowed');
          } else if (event.error === 'network') {
            errorMessage = t('voice.networkError');
          }

          toast({
            title: t('voice.recognitionError'),
            description: errorMessage,
            variant: "destructive"
          });

          onInterimTranscript('');
        };

        recognition.onend = () => {
          setIsRecording(false);
          onInterimTranscript('');
        };

        recognitionRef.current = recognition;
      } else {
        setSpeechSupported(false);
      }
    }
  }, [toast, i18n.language, t]);

  const startRecording = () => {
    if (!speechSupported) {
      toast({
        title: t('voice.notSupported'),
        description: t('voice.notSupported'),
        variant: "destructive"
      });
      return;
    }

    try {
      recognitionRef.current?.start();
      toast({
        title: t('voice.inputStart'),
        description: t('voice.inputStartDesc'),
      });
    } catch (error) {
      console.error('음성 인식 시작 실패:', error);
      toast({
        title: t('voice.inputError'),
        description: t('voice.inputErrorDesc'),
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    toast({
      title: t('voice.inputComplete'),
      description: t('voice.inputCompleteDesc'),
    });
  };

  const cleanup = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  return {
    isRecording,
    speechSupported,
    recognitionRef,
    startRecording,
    stopRecording,
    cleanup,
    removeInterimText,
    VOICE_INPUT_MARKER,
  };
}
