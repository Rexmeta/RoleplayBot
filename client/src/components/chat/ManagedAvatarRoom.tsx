import { useEffect, useId, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";

type ManagedClient = { start(): Promise<void>; stop(): Promise<void>; interrupt(): Promise<void> };
type Descriptor = {
  sessionId: string; pipeline: "anam_full"; audioOwner: "avatarrouter";
  clientScriptUrl: string; clientScriptPath: string; expiresAt: string; connection: unknown;
};
type ManagedSDK = {
  createClient(options: {
    connection: Descriptor; video: HTMLVideoElement;
    onAudioOwner(owner: string): Promise<void>;
    endSession(): Promise<unknown>; interruptSession(): Promise<unknown>;
    onState(state: string, code?: string): void;
  }): ManagedClient;
};
declare global { interface Window { AvatarRouter?: ManagedSDK } }

const scripts = new Map<string, Promise<void>>();
function loadClient(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.pathname !== "/sdk/avatarrouter-client.js" ||
      parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("invalid_client_script");
  let pending = scripts.get(url);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error("client_load_timeout"));
      }, 20000);
      script.src = url;
      script.onload = () => { clearTimeout(timeout); window.AvatarRouter ? resolve() : reject(new Error("client_missing")); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("client_load_failed")); };
      document.head.appendChild(script);
    });
    scripts.set(url, pending);
    void pending.catch(() => scripts.delete(url));
  }
  return pending;
}

/** Native pipeline only: no Gemini generation, PCM, LiveKit or local TTS. */
export default function ManagedAvatarRoom({ endpoint, onError }: {
  endpoint: string; onError?: (message: string) => void;
}) {
  const id = useId();
  const video = useRef<HTMLVideoElement>(null);
  const clientRef = useRef<ManagedClient>();
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [state, setState] = useState("connecting");
  useEffect(() => {
    let cancelled = false, started = false, endSent = false;
    let client: ManagedClient | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const end = async () => {
      if (endSent) return;
      endSent = true;
      await apiRequest("POST", `${endpoint}/end`, {});
    };
    const stop = () => {
      void end().catch(() => { errorRef.current?.("종료 요청을 확인하지 못했습니다. 서버 상태를 확인하고 종료를 다시 요청하세요."); });
      void client?.stop().catch(() => {});
    };
    // StrictMode's first effect is cancelled before any one-time POST.
    const timer = setTimeout(() => {
      started = true;
      void (async () => {
        const response = await apiRequest("POST", `${endpoint}/client-connection`, {});
        const descriptor = await response.json() as Descriptor;
        if (descriptor.pipeline !== "anam_full" || descriptor.audioOwner !== "avatarrouter" ||
            !Number.isFinite(Date.parse(descriptor.expiresAt)) || Date.parse(descriptor.expiresAt) <= Date.now()) {
          throw new Error("invalid_descriptor");
        }
        if (cancelled) return;
        expiry = setTimeout(stop, Math.min(120000, Math.max(1, Date.parse(descriptor.expiresAt) - Date.now())));
        await loadClient(descriptor.clientScriptUrl);
        if (cancelled || !video.current) return;
        client = window.AvatarRouter!.createClient({
          connection: descriptor, video: video.current,
          onAudioOwner: async owner => {
            if (owner !== "avatarrouter") throw new Error("native_audio_owner_required");
          },
          endSession: end,
          interruptSession: () => apiRequest("POST", `${endpoint}/interrupt`, {}),
          onState: next => {
            if (cancelled) return;
            setState(next);
            if (next === "error" || next === "failed") {
              errorRef.current?.("Anam 연결에 실패했습니다. 자동 재연결하지 않고 종료를 요청합니다.");
              stop();
            }
          },
        });
        clientRef.current = client;
        await client.start();
      })().catch(() => {
        if (!cancelled) {
          setState("failed");
          errorRef.current?.("Anam 미디어를 시작하지 못했습니다. 마이크·재생 권한과 서버 상태를 확인하세요. 새 세션을 자동 생성하지 않습니다.");
        }
        stop();
      });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(expiry);
      clientRef.current = undefined;
      if (started) stop();
    };
  }, [endpoint]);

  return <div className="relative h-full min-h-64 bg-slate-950" data-testid="managed-avatar-room">
    <video id={`managed-avatar-${id}`} ref={video} autoPlay playsInline className="h-full w-full object-cover" />
    <span role="status" className="absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">
      Anam · {state === "playing" ? "영상 재생 중" : state === "connected" ? "연결됨 · 재생 대기" : state === "ended" ? "로컬 재생 종료" : state === "failed" ? "연결 실패" : "연결 준비 중"}
    </span>
    <button type="button" className="absolute bottom-[calc(8rem+env(safe-area-inset-bottom,0px))] right-3 rounded-full border border-slate-200 bg-white/90 px-3 py-2 text-xs text-slate-600 shadow-sm backdrop-blur-sm"
      onClick={() => void clientRef.current?.interrupt().catch(() => errorRef.current?.("끼어들기 요청에 실패했습니다."))}>
      응답 중단
    </button>
  </div>;
}
