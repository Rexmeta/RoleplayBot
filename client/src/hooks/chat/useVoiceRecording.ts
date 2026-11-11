import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { conversationSpeechLocale, type ConversationLanguage } from "@shared/conversationLanguage";

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const VOICE_INPUT_MARKER = '🎤';

const removeInterimText = (text: string): string => {
  const markerPattern = new RegExp(`\\[${VOICE_INPUT_MARKER}.*?\\].*$`);
  return text.replace(markerPattern, '').trim();
};

interface UseVoiceRecordingOptions {
  language?: ConversationLanguage;
  onTranscript: (text: string) => void;
  onInterimTranscript: (text: string) => void;
}

export function useVoiceRecording({ onTranscript, onInterimTranscript, language }: UseVoiceRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const { toast } = useToast();
  const { t } = useTranslation();
  const feedbackRef = useRef({ toast, t });
  feedbackRef.current = { toast, t };

  // Fix 4: stale closure 방지 - 콜백을 ref로 감싸서 항상 최신 참조를 사용
  const onTranscriptRef = useRef(onTranscript);
  const onInterimTranscriptRef = useRef(onInterimTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onInterimTranscriptRef.current = onInterimTranscript;
  }, [onTranscript, onInterimTranscript]);

  useEffect(() => {
    setIsRecording(false);
    let active = true;
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = conversationSpeechLocale(language ?? "ko");
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          if (!active) return;
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          if (!active) return;
          const result = event.results[0];
          const transcript = result[0].transcript;

          if (result.isFinal) {
            onTranscriptRef.current(transcript.trim());
          } else {
            onInterimTranscriptRef.current(`[${VOICE_INPUT_MARKER}] ${transcript.trim()}`);
          }
        };

        recognition.onerror = (event: any) => {
          if (!active) return;
          const { toast, t } = feedbackRef.current;
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

          onInterimTranscriptRef.current('');
        };

        recognition.onend = () => {
          if (!active) return;
          setIsRecording(false);
          onInterimTranscriptRef.current('');
        };

        recognitionRef.current = recognition;
        return () => {
          active = false;
          recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
          recognition.abort();
          if (recognitionRef.current === recognition) recognitionRef.current = null;
        };
      } else {
        setSpeechSupported(false);
      }
    }
  }, [language]);

  const startRecording = () => {
    if (!language) return; // Wait for the server-owned conversation language.
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
    speechSupported: speechSupported && !!language,
    recognitionRef,
    startRecording,
    stopRecording,
    cleanup,
    removeInterimText,
    VOICE_INPUT_MARKER,
  };
}
