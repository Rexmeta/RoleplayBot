import { useCallback, useEffect, useRef, useState } from "react";

// Local UI only. No audio tracks, samples, or speech signals leave this component.
export type UserAudioActivity = { level: number };

const silent = { active: false, amplitude: 0 };
const hangoverMs = 380;

export function useLiveAvatarUserSpeech() {
  const [speech, setSpeech] = useState(silent);
  const stopTimer = useRef<ReturnType<typeof setTimeout>>();
  const reset = useCallback(() => {
    clearTimeout(stopTimer.current);
    setSpeech(silent);
  }, []);
  useEffect(() => () => clearTimeout(stopTimer.current), []);

  const onActivity = useCallback((activity: UserAudioActivity) => {
    if (Number.isFinite(activity?.level) && activity.level >= 0.03 && activity.level <= 1) {
      clearTimeout(stopTimer.current);
      setSpeech({ active: true, amplitude: Math.min(1, activity.level * 2.5) });
      stopTimer.current = setTimeout(reset, hangoverMs);
    }
  }, [reset]);
  return { speech, onActivity, reset };
}
