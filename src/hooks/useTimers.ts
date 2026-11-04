import { useEffect, useState } from 'react';

/** Whole seconds since `startedAt`, refreshed every second; restarts at 0 when `startedAt` changes. */
export function useElapsedSeconds(startedAt: number, now: () => number): number {
  const [tick, setTick] = useState({ startedAt, elapsed: 0 });
  useEffect(() => {
    const id = setInterval(() => {
      setTick({ startedAt, elapsed: Math.max(0, Math.floor((now() - startedAt) / 1000)) });
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt, now]);
  return tick.startedAt === startedAt ? tick.elapsed : 0;
}

/** Counts down from `seconds` to 0, one step per second. 0 means "not counting". */
export function useCountdown(seconds: number): number {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return left;
}
