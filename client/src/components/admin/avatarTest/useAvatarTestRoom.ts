import { MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { apiRequest } from "@/lib/queryClient";
import { AvatarTestSession, avatarTestReady } from "@shared/avatar/adminAvatarTest";

type Connection = { url: string; token: string; expiresAt: string };

async function fetchConnection(sessionId: string, endpoint: string): Promise<Connection> {
  const response = await apiRequest("GET", `${endpoint}/sessions/${encodeURIComponent(sessionId)}/connection?_=${Date.now()}`);
  return response.json() as Promise<Connection>;
}

type Options = {
  endpoint?: string;
  session: AvatarTestSession | null;
  sessionRef: MutableRefObject<AvatarTestSession | null>;
  mountedRef: MutableRefObject<boolean>;
  stoppedRef: MutableRefObject<boolean>;
  stoppingRef: MutableRefObject<boolean>;
  pollFailedRef: MutableRefObject<boolean>;
  onError: (message: string) => void;
};

export function useAvatarTestRoom({ endpoint = "/api/live-avatar/test", session, sessionRef, mountedRef, stoppedRef, stoppingRef, pollFailedRef, onError }: Options) {
  const [connecting, setConnecting] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [mediaConnected, setMediaConnected] = useState(false);
  const [videoTrack, setVideoTrack] = useState<Track | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [audioPlaybackReady, setAudioPlaybackReady] = useState(true);
  const videoHost = useRef<HTMLDivElement>(null);
  const audioHost = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  const tokenRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const connectionInFlightRef = useRef(false);
  const lastConnectionKeyRef = useRef("");
  const videoSubscribedRef = useRef(false);
  const audioSubscribedRef = useRef(false);
  const audioPlaybackReadyRef = useRef(true);
  const isReady = Boolean(session && avatarTestReady(session));

  const disconnectMedia = useCallback(() => {
    generationRef.current += 1;
    connectionInFlightRef.current = false;
    tokenRef.current = null;
    videoSubscribedRef.current = false;
    audioSubscribedRef.current = false;
    audioPlaybackReadyRef.current = true;
    if (mountedRef.current) {
      setMediaConnected(false);
      setConnecting(false);
      setVideoTrack(null);
      setAudioBlocked(false);
      setAudioPlaybackReady(true);
    }
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      for (const participant of Array.from(room.remoteParticipants.values())) {
        for (const publication of Array.from(participant.trackPublications.values())) {
          publication.track?.detach().forEach((node) => {
            if ("pause" in node && typeof node.pause === "function") node.pause();
            node.remove();
          });
        }
      }
      room.removeAllListeners();
      room.disconnect();
    }
    videoHost.current?.replaceChildren();
    audioHost.current?.replaceChildren();
  }, [mountedRef]);

  useEffect(() => {
    const active = sessionRef.current;
    if (!active || !avatarTestReady(active) || roomRef.current || connectionInFlightRef.current ||
        stoppedRef.current || stoppingRef.current || pollFailedRef.current) return;
    const activeId = active.id;
    const key = `${activeId}:${connectionAttempt}`;
    if (lastConnectionKeyRef.current === key) return;
    lastConnectionKeyRef.current = key;
    connectionInFlightRef.current = true;
    const generation = ++generationRef.current;
    setConnecting(true);
    void (async () => {
      let room: Room | null = null;
      try {
        const connection = await fetchConnection(activeId, endpoint);
        if (generationRef.current !== generation || !mountedRef.current || sessionRef.current?.id !== activeId ||
            !avatarTestReady(sessionRef.current) || stoppedRef.current || stoppingRef.current || pollFailedRef.current) return;
        tokenRef.current = connection.token;
        room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (generationRef.current !== generation || sessionRef.current?.id !== activeId || stoppedRef.current || stoppingRef.current) return;
          if (track.kind === Track.Kind.Video) {
            videoSubscribedRef.current = true;
            setVideoTrack(track);
            setMediaConnected(audioSubscribedRef.current && audioPlaybackReadyRef.current);
          } else if (track.kind === Track.Kind.Audio) {
            audioSubscribedRef.current = true;
            const node = track.attach();
            node.autoplay = true;
            node.setAttribute("playsinline", "true");
            audioHost.current?.appendChild(node);
            void node.play().then(() => {
              if (generationRef.current !== generation) return;
              setMediaConnected(videoSubscribedRef.current && audioPlaybackReadyRef.current);
            }).catch(() => {
              if (generationRef.current === generation) {
                audioPlaybackReadyRef.current = false;
                setAudioPlaybackReady(false);
                setAudioBlocked(true);
                setMediaConnected(false);
              }
            });
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((node) => node.remove());
          if (track.kind === Track.Kind.Video) {
            videoSubscribedRef.current = false;
            setVideoTrack(null);
            setMediaConnected(false);
          } else if (track.kind === Track.Kind.Audio) {
            audioSubscribedRef.current = false;
            setMediaConnected(false);
          }
        });
        room.on(RoomEvent.AudioPlaybackStatusChanged, (canPlayback: boolean) => {
          audioPlaybackReadyRef.current = canPlayback;
          setAudioPlaybackReady(canPlayback);
          setAudioBlocked(!canPlayback);
          setMediaConnected(videoSubscribedRef.current && audioSubscribedRef.current && canPlayback);
        });
        room.on(RoomEvent.Disconnected, () => {
          if (generationRef.current === generation && !stoppedRef.current) {
            setMediaConnected(false);
            setVideoTrack(null);
            videoSubscribedRef.current = false;
            audioSubscribedRef.current = false;
            onError("아바타 미디어 연결이 끊겼습니다. 세션 상태를 확인한 뒤 수동으로 다시 연결하세요.");
          }
        });
        await room.connect(connection.url, connection.token, { autoSubscribe: true });
        if (generationRef.current !== generation || !mountedRef.current || stoppedRef.current || stoppingRef.current) {
          room.disconnect();
          return;
        }
        const hasVideo = Array.from(room.remoteParticipants.values()).some((participant) =>
          Array.from(participant.trackPublications.values()).some((publication) =>
            publication.track?.kind === Track.Kind.Video && publication.isSubscribed,
          ),
        );
        videoSubscribedRef.current = hasVideo;
        setMediaConnected(hasVideo && audioSubscribedRef.current && audioPlaybackReadyRef.current);
      } catch {
        if (generationRef.current === generation && mountedRef.current) {
          room?.disconnect();
          if (roomRef.current === room) roomRef.current = null;
          tokenRef.current = null;
          setMediaConnected(false);
          onError("아바타 미디어 연결에 실패했습니다. 상태를 확인한 뒤 수동으로 다시 연결하세요.");
        }
      } finally {
        if (generationRef.current === generation) {
          connectionInFlightRef.current = false;
          if (mountedRef.current) setConnecting(false);
        }
      }
    })();
    return () => {
      if (sessionRef.current?.id !== activeId || !avatarTestReady(sessionRef.current)) generationRef.current += 1;
    };
  }, [session?.id, isReady, connectionAttempt, endpoint]);

  useEffect(() => {
    if (!videoTrack || !videoHost.current) return;
    const node = videoTrack.attach();
    node.autoplay = true;
    node.setAttribute("playsinline", "true");
    node.className = "h-full w-full object-cover";
    videoHost.current.replaceChildren(node);
    return () => {
      videoTrack.detach().forEach((element) => element.remove());
      if (videoHost.current?.contains(node)) node.remove();
    };
  }, [videoTrack]);

  const retryConnection = () => {
    if (stoppedRef.current || stoppingRef.current) return;
    pollFailedRef.current = false;
    onError("");
    disconnectMedia();
    lastConnectionKeyRef.current = "";
    setConnectionAttempt((attempt) => attempt + 1);
  };
  const startAudio = async () => {
    try {
      await roomRef.current?.startAudio();
      audioPlaybackReadyRef.current = true;
      setAudioPlaybackReady(true);
      setAudioBlocked(false);
      setMediaConnected(videoSubscribedRef.current && audioSubscribedRef.current);
    } catch {
      audioPlaybackReadyRef.current = false;
      setAudioPlaybackReady(false);
      setAudioBlocked(true);
      setMediaConnected(false);
    }
  };

  return {
    connecting, connectionAttempt, setConnectionAttempt, mediaConnected, videoTrack, audioBlocked,
    audioPlaybackReady, videoHost, audioHost, disconnectMedia, retryConnection, startAudio,
    videoSubscribedRef, lastConnectionKeyRef,
  };
}
