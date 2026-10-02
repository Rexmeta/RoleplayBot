type IOSAudioSessionType = 'auto' | 'play-and-record';

interface NavigatorWithAudioSession extends Navigator {
  audioSession?: {
    type: IOSAudioSessionType;
  };
}

/**
 * iPadOS can request the desktop user-agent, so touch-capable MacIntel must be
 * treated as iOS as well. All browsers on iOS use WebKit's system audio route.
 */
export function isIOSWebKitAudioPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;

  return /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Keep the WebKit audio session in its bidirectional call profile while a
 * realtime conversation is active. On iPhone this lets the system preserve the
 * currently routed Bluetooth headset for both playback and capture.
 *
 * Older Safari versions do not expose navigator.audioSession; they continue to
 * use their automatic routing without failing the voice session.
 */
let realtimeActive = false;
let permissionRequests = 0;

export function setIOSRealtimeAudioSessionActive(active: boolean): boolean {
  realtimeActive = active;
  return applyIOSAudioSession();
}

/** Temporary probes cannot restore auto while a newer conversation is active. */
export function beginIOSMicrophonePermissionSession(): () => void {
  permissionRequests++;
  applyIOSAudioSession();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    permissionRequests--;
    applyIOSAudioSession();
  };
}

function applyIOSAudioSession(): boolean {
  if (!isIOSWebKitAudioPlatform()) return false;

  const audioSession = (navigator as NavigatorWithAudioSession).audioSession;
  if (!audioSession) return false;

  try {
    audioSession.type = realtimeActive || permissionRequests > 0 ? 'play-and-record' : 'auto';
    return true;
  } catch (error) {
    console.warn('Could not update the iOS audio session type:', error);
    return false;
  }
}