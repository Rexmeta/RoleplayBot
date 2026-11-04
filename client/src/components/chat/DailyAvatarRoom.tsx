import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, RotateCw } from "lucide-react";
import Daily from "@daily-co/daily-js";

type Connection = { transport: "daily"; pipeline: "tavus_full"; url: string; token: string; expiresAt?: string };
type Props = { connection: Connection; onError?: (message: string) => void };
type MediaParticipant = { session_id: string; local?: boolean; tracks?: { video?: { state?: string; persistentTrack?: MediaStreamTrack }; audio?: { state?: string; persistentTrack?: MediaStreamTrack } } };

export default function DailyAvatarRoom({ connection, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const callRef = useRef<ReturnType<typeof Daily.createCallObject> | null>(null);
  const [status, setStatus] = useState<"joining" | "joined" | "error">("joining");
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState<MediaStreamTrack | null>(null);
  const [remoteAudio, setRemoteAudio] = useState<MediaStreamTrack | null>(null);
  const [roomError, setRoomError] = useState("");

  const syncParticipants = useCallback((participants: Record<string, MediaParticipant>) => {
    const remote = Object.values(participants).find(participant => !participant.local);
    setRemoteVideo(remote?.tracks?.video?.state === "playable" ? remote.tracks.video.persistentTrack || null : null);
    setRemoteAudio(remote?.tracks?.audio?.state === "playable" ? remote.tracks.audio.persistentTrack || null : null);
  }, []);

  useEffect(() => {
    let disposed = false;
    let call: ReturnType<typeof Daily.createCallObject> | null = null;
    let leavePromise: Promise<unknown> | null = null;
    let destroyPromise: Promise<unknown> | null = null;
    const fail = (_event?: unknown) => {
      if (disposed) return;
      // Provider errors can include room URLs or credentials; never surface them.
      const message = "The private room connection failed. Check the session status or end the session.";
      setRoomError(message);
      setStatus("error");
      onError?.(message);
    };
    const updateParticipants = () => {
      if (call && !disposed) syncParticipants(call.participants() as Record<string, MediaParticipant>);
    };
    const onTrack = (event: any) => {
      if (event.participant) updateParticipants();
    };
    const leaveSafely = async () => {
      if (!call) return;
      if (!leavePromise) leavePromise = call.leave().catch(() => undefined);
      await leavePromise;
    };
    const shutdown = async () => {
      await leaveSafely();
      if (call && !destroyPromise) destroyPromise = call.destroy().catch(() => undefined);
      await destroyPromise;
    };

    try {
      call = Daily.createCallObject({ audioSource: true, videoSource: false });
      callRef.current = call;
      call.on("joined-meeting", () => {
        if (!disposed) {
          setStatus("joined");
          updateParticipants();
        }
      });
      call.on("participant-joined", updateParticipants);
      call.on("participant-updated", updateParticipants);
      call.on("participant-left", updateParticipants);
      call.on("track-started", onTrack);
      call.on("track-stopped", onTrack);
      call.on("error", () => fail("Daily room error."));
      call.on("left-meeting", () => {
        if (!disposed) fail("The room connection ended.");
      });

      const joiningCall = call;
      void joiningCall.join({ url: connection.url, token: connection.token, audioSource: true, videoSource: false })
        .then(() => {
          if (disposed) {
            return shutdown().then(() => {
              if (callRef.current === joiningCall) callRef.current = null;
            });
          }
          updateParticipants();
        })
        .catch(fail);
    } catch (cause) {
      fail(cause);
    }

    return () => {
      disposed = true;
      if (call) {
        void (async () => {
          await shutdown();
          if (callRef.current === call) callRef.current = null;
        })();
      }
    };
    // Each connection is a distinct, short-lived room credential; never keep it after teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.url, connection.token]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.srcObject = remoteVideo ? new MediaStream([remoteVideo]) : null;
    const audio = audioRef.current;
    if (audio) {
      audio.srcObject = remoteAudio ? new MediaStream([remoteAudio]) : null;
      if (!remoteAudio) setPlaybackFailed(false);
      else {
        void audio.play().then(() => setPlaybackFailed(false)).catch(() => setPlaybackFailed(true));
      }
    }
  }, [remoteAudio, remoteVideo]);

  const retryPlayback = async () => {
    if (!audioRef.current) return;
    try { await audioRef.current.play(); setPlaybackFailed(false); }
    catch { setPlaybackFailed(true); }
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#24383b]" data-testid="daily-avatar-room">
      <video ref={videoRef} autoPlay playsInline className="h-full w-full object-cover" aria-label="Tavus avatar video" data-testid="daily-remote-video" />
      <audio ref={audioRef} autoPlay playsInline data-testid="daily-remote-audio" />
      {status === "joining" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#24383b]/90 text-center text-sm text-[#e0ebe8]" role="status" data-testid="daily-joining">
        <LoaderCircle className="h-6 w-6 animate-spin" />Joining the private room…
      </div>}
      {status === "joined" && !remoteVideo && <div className="absolute inset-x-0 bottom-4 flex justify-center" role="status" data-testid="daily-waiting-media">
        <span className="rounded-full border border-white/15 bg-[#24383b]/80 px-3 py-1.5 text-xs text-[#e0ebe8]">Waiting for PAL video…</span>
      </div>}
      {status === "error" && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#24383b]/95 px-6 text-center text-sm text-[#f4e4df]" role="alert" data-testid="daily-room-error">
        <AlertTriangle className="h-6 w-6" /><span>{roomError}</span>
      </div>}
      {playbackFailed && status === "joined" && <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-xl border border-[#d4dfdb] bg-[#f8faf9] p-3 text-xs text-[#32484e]" role="alert" data-testid="daily-playback-error">
        <span>Audio playback was blocked by your browser.</span>
        <button type="button" onClick={() => void retryPlayback()} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#28675d] px-3 py-2 font-semibold text-white hover:bg-[#20584f]" data-testid="daily-playback-retry"><RotateCw className="h-3.5 w-3.5" />Retry audio</button>
      </div>}
    </div>
  );
}
