import { useCallback, useRef, useState } from "react";

/**
 * Scenario context bar orchestration: open on entry; the FIRST dismissal
 * synchronously invokes onFirstDismiss (inside the user gesture). Later
 * closes/reopens never call it again, so the conversation is not restarted.
 */
export function useScenarioContextGate(onFirstDismiss: () => void) {
  const [isOpen, setIsOpen] = useState(true);
  const [hasDismissed, setHasDismissed] = useState(false);
  const dismissedRef = useRef(false);
  const isOpenRef = useRef(true);
  isOpenRef.current = isOpen;
  const callbackRef = useRef(onFirstDismiss);
  callbackRef.current = onFirstDismiss;

  const close = useCallback(() => {
    setIsOpen(false);
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setHasDismissed(true);
    callbackRef.current();
  }, []);
  const open = useCallback(() => setIsOpen(true), []);
  const toggle = useCallback(() => {
    if (isOpenRef.current) close(); else open();
  }, [close, open]);

  return { isOpen, hasDismissed, close, open, toggle };
}
