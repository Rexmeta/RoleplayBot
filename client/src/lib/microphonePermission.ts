import { beginIOSMicrophonePermissionSession } from './iosAudioSession';

// Share the physical browser prompt across settings and voice-start callers.
// getUserMedia cannot be aborted: even abandoned results must stop their tracks.
let pending: Promise<void> | null = null;
let capturePending: Promise<MediaStream> | null = null;

export function requestMicrophonePermission(): Promise<void> {
  if (pending) return pending;
  // Recording can itself be awaiting the same browser permission prompt.
  // Its caller owns the stream; settings/start callers share only the outcome.
  if (capturePending) return capturePending.then(() => {});
  const release = beginIOSMicrophonePermissionSession();
  pending = (async () => {
    try {
      if (window.isSecureContext === false) throw new DOMException('HTTPS required', 'SecurityError');
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Capture unavailable', 'NotSupportedError');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } finally {
      release();
    }
  })();
  const request = pending;
  void request.finally(() => { if (pending === request) pending = null; }).catch(() => {});
  return request;
}

export async function acquireMicrophone(constraints: MediaStreamConstraints, isCurrent: () => boolean = () => true): Promise<MediaStream> {
  // Do not race a temporary permission stream with the actual recording.
  if (pending) await pending;
  if (capturePending) await capturePending;
  if (!isCurrent()) throw new DOMException('Capture cancelled', 'AbortError');
  if (window.isSecureContext === false) throw new DOMException('HTTPS required', 'SecurityError');
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Capture unavailable', 'NotSupportedError');
  const request = navigator.mediaDevices.getUserMedia(constraints);
  capturePending = request;
  try {
    return await request;
  } finally {
    if (capturePending === request) capturePending = null;
  }
}

export function microphoneErrorKey(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notFound';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  if (name === 'SecurityError') return 'secureContext';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'failed';
}

export function microphoneSettingsKey(): string {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)
    ? 'safariSettings' : 'browserSettings';
}