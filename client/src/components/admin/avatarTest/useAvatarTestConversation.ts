import { MutableRefObject, useCallback, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { AvatarTestMessage, AvatarTestSession, AvatarTestTurnInput, avatarTestReady } from "@shared/avatar/adminAvatarTest";

type TurnResponse = { userText: string; replyText: string };
type Options = {
  endpoint?: string;
  sessionRef: MutableRefObject<AvatarTestSession | null>;
  mountedRef: MutableRefObject<boolean>;
  stoppedRef: MutableRefObject<boolean>;
  stoppingRef: MutableRefObject<boolean>;
  isMediaReady: () => boolean;
  onError: (message: string) => void;
};

async function postTurn(sessionId: string, payload: AvatarTestTurnInput, endpoint: string): Promise<TurnResponse> {
  const response = await apiRequest("POST", `${endpoint}/sessions/${encodeURIComponent(sessionId)}/turn`, payload);
  return response.json() as Promise<TurnResponse>;
}
function friendlyTurnError(cause: unknown): string {
  const code = (cause instanceof Error ? cause.message : "").toUpperCase();
  if (code.includes("AUDIO") || code.includes("CONSENT")) return "음성 입력 동의 또는 지원 형식을 확인하세요.";
  if (code.includes("SESSION_EXPIRED") || code.includes("410")) return "테스트 세션이 만료되었습니다. 종료 상태를 확인하세요.";
  if (code.includes("NOT_READY") || code.includes("RENDERER")) return "아바타가 응답할 준비가 되지 않았습니다. 세션 상태를 확인하세요.";
  if (code.includes("LIMIT") || code.includes("429")) return "관리자 테스트 사용 한도에 도달했습니다.";
  return "테스트 턴을 완료하지 못했습니다. 상태를 확인하고 다시 시도하세요.";
}

export function useAvatarTestConversation({ endpoint = "/api/live-avatar/test", sessionRef, mountedRef, stoppedRef, stoppingRef, isMediaReady, onError }: Options) {
  const [audioConfirmed, setAudioConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<AvatarTestMessage[]>([]);
  const [turnBusy, setTurnBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [micPending, setMicPending] = useState(false);
  const audioConsentRef = useRef(false);
  const mediaReadyRef = useRef(isMediaReady);
  const turnGenerationRef = useRef(0);
  const turnBusyRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<FileReader | null>(null);
  const micGenerationRef = useRef(0);
  const micPendingRef = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);

  audioConsentRef.current = audioConfirmed;
  mediaReadyRef.current = isMediaReady;

  const stopMicrophone = useCallback(() => {
    micGenerationRef.current += 1;
    if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = null;
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader && reader.readyState === FileReader.LOADING) reader.abort();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* already inactive */ }
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    micPendingRef.current = false;
    if (mountedRef.current) {
      setRecording(false);
      setMicPending(false);
    }
  }, [mountedRef]);

  const cancelTurn = useCallback(() => {
    turnGenerationRef.current += 1;
    turnBusyRef.current = false;
    if (mountedRef.current) setTurnBusy(false);
  }, [mountedRef]);

  const sendTurn = async (input: AvatarTestTurnInput) => {
    const current = sessionRef.current;
    if (!audioConsentRef.current || !current || !avatarTestReady(current) || !mediaReadyRef.current() ||
        recording || micPendingRef.current || recorderRef.current || turnBusyRef.current || stoppedRef.current || stoppingRef.current) return;
    turnBusyRef.current = true;
    setTurnBusy(true);
    const generation = ++turnGenerationRef.current;
    onError("");
    try {
      const result = await postTurn(current.id, {
        ...input,
        history: conversation.slice(-10).map((item) => ({ role: item.role, content: item.content.slice(0, 600) })),
      }, endpoint);
      if (generation !== turnGenerationRef.current || sessionRef.current?.id !== current.id || stoppedRef.current) return;
      setConversation((items) => [...items, { role: "user", content: result.userText }, { role: "assistant", content: result.replyText }]);
      setMessage("");
    } catch (cause) {
      if (generation === turnGenerationRef.current) onError(friendlyTurnError(cause));
    } finally {
      if (generation === turnGenerationRef.current) {
        turnBusyRef.current = false;
        if (mountedRef.current) setTurnBusy(false);
      }
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      if (recordingTimerRef.current !== null) window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
      recorderRef.current?.stop();
      return;
    }
    const current = sessionRef.current;
    if (recorderRef.current || micPendingRef.current || !audioConsentRef.current || !mediaReadyRef.current() ||
        !current || !avatarTestReady(current) || turnBusyRef.current || stoppedRef.current || stoppingRef.current) return;
    micPendingRef.current = true;
    setMicPending(true);
    const generation = ++micGenerationRef.current;
    const sessionId = current.id;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== micGenerationRef.current || sessionRef.current?.id !== sessionId ||
          !audioConsentRef.current || !mediaReadyRef.current() || stoppedRef.current || stoppingRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("unsupported recording format");
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        stopMicrophone();
        onError("마이크 녹음을 완료하지 못했습니다.");
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        if (mountedRef.current) setRecording(false);
        if (!chunks.length || generation !== micGenerationRef.current || stoppingRef.current || stoppedRef.current) return;
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        if (blob.size > 1_500_000) {
          onError("녹음 파일이 너무 큽니다. 15초보다 짧게 녹음해 주세요.");
          return;
        }
        const reader = new FileReader();
        readerRef.current = reader;
        reader.onload = () => {
          if (generation !== micGenerationRef.current || sessionRef.current?.id !== sessionId ||
              !audioConsentRef.current || !mediaReadyRef.current() || stoppedRef.current || stoppingRef.current) return;
          const encoded = String(reader.result || "");
          const audioBase64 = encoded.includes(",") ? encoded.slice(encoded.indexOf(",") + 1) : "";
          const mimeType = mime.startsWith("audio/mp4") ? "audio/mp4" : mime.startsWith("audio/ogg") ? "audio/ogg" : "audio/webm";
          if (audioBase64.length > 2_000_000) onError("인코딩된 녹음 파일이 2 MB 제한을 초과했습니다.");
          else if (audioBase64) void sendTurn({ audioBase64, mimeType, history: [] });
          readerRef.current = null;
        };
        reader.onerror = () => {
          if (generation === micGenerationRef.current) onError("녹음 파일을 읽지 못했습니다.");
          readerRef.current = null;
        };
        reader.readAsDataURL(blob);
      };
      micPendingRef.current = false;
      setMicPending(false);
      recorder.start();
      setRecording(true);
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 15_000);
    } catch {
      stopMicrophone();
      if (mountedRef.current) onError("마이크 권한을 확인하고 지원되는 녹음 형식으로 다시 시도하세요.");
    } finally {
      micPendingRef.current = false;
      if (mountedRef.current) setMicPending(false);
    }
  };

  return {
    audioConfirmed, setAudioConfirmed, audioConsentRef, message, setMessage, conversation, setConversation,
    turnBusy, recording, micPending, sendTurn, toggleRecording, stopMicrophone, cancelTurn,
  };
}
