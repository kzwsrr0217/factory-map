import { useCallback, useEffect, useRef } from 'react';

/**
 * Returns a debounced version of `fn` — a call within `delayMs` of the
 * previous one cancels the pending invocation and restarts the timer.
 *
 * Matches the optimistic-update-then-persist pattern used by every map
 * drag handler (FloorDetails.tsx, MapView.tsx): the caller updates local
 * state immediately on every drag event, then calls this to persist only
 * the last value once the user stops dragging (500ms of inactivity),
 * instead of firing a PATCH per mousemove.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void | Promise<void>,
  delayMs = 500
): (...args: A) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always call the latest `fn` without that identity change resetting the
  // debounced function's own identity (which would defeat useCallback
  // memoization at call sites that pass this into props).
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return useCallback((...args: A) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { fnRef.current(...args); }, delayMs);
  }, [delayMs]);
}
