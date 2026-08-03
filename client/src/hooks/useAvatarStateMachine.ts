/**
 * useAvatarStateMachine
 *
 * React hook that wraps the pure avatarStateMachine with:
 *   - React state management
 *   - A stable `dispatchAvatarEvent` callback that consumers use to fire events
 *
 * Usage:
 *   const { avatarState, dispatchAvatarEvent } = useAvatarStateMachine();
 *
 * Then wire events from voice service callbacks:
 *   onUserSpeakingStart: () => dispatchAvatarEvent({ type: 'UserSpeechStart' })
 *   …etc.
 */

import { useState, useCallback } from 'react';
import { transition } from '@/lib/avatar/avatarStateMachine';
import type { AvatarState, AvatarEvent } from '@/lib/avatar/types';

export type { AvatarState, AvatarEmotion, AvatarEvent } from '@/lib/avatar/types';

interface UseAvatarStateMachineResult {
  /** Current avatar state derived from the event stream */
  avatarState: AvatarState;
  /** Dispatch an event to drive a state transition */
  dispatchAvatarEvent: (event: AvatarEvent) => void;
  /** Reset to idle (convenience, equivalent to dispatching ConversationEnd) */
  resetAvatarState: () => void;
}

export function useAvatarStateMachine(
  initialState: AvatarState = 'idle'
): UseAvatarStateMachineResult {
  const [avatarState, setAvatarState] = useState<AvatarState>(initialState);

  const dispatchAvatarEvent = useCallback((event: AvatarEvent) => {
    setAvatarState(prev => {
      const next = transition(prev, event);
      if (next !== prev) {
        console.debug(`[AvatarSM] ${prev} --[${event.type}]--> ${next}`);
      }
      return next;
    });
  }, []);

  const resetAvatarState = useCallback(() => {
    setAvatarState('idle');
  }, []);

  return { avatarState, dispatchAvatarEvent, resetAvatarState };
}
