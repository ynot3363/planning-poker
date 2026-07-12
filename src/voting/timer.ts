import type { VotingTimer } from '../domain/planningPokerDomain';

/** Derived timer state safe for display without per-second Fluid mutations. */
export interface VotingTimerPresentation {
  readonly status: 'Ready' | 'Running' | 'Stopped' | 'Expired';
  readonly remainingSeconds: number;
  readonly formattedTime: string;
}

/**
 * Derives remaining time from the persisted start timestamp and remaining-at-start value.
 *
 * @param timer - Persisted synchronized timer state.
 * @param now - Current local timestamp in milliseconds.
 * @returns Clamped display state for the current instant.
 */
export function selectVotingTimer(timer: VotingTimer, now: number): VotingTimerPresentation {
  const startedAt = timer.startedAt === undefined ? Number.NaN : Date.parse(timer.startedAt);
  const elapsedSeconds =
    timer.status === 'Running' && Number.isFinite(startedAt)
      ? Math.max(0, Math.floor((now - startedAt) / 1000))
      : 0;
  const remainingSeconds = Math.max(0, timer.remainingSeconds - elapsedSeconds);
  const status = timer.status === 'Running' && remainingSeconds === 0 ? 'Expired' : timer.status;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  return {
    status,
    remainingSeconds,
    formattedTime: `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`
  };
}
