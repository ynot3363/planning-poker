import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import type { VotingTimer } from '../domain/planningPokerDomain';
import { RoleGuard } from '../shell/RoleGuard';
import { selectVotingTimer } from './timer';
import styles from './VotingPage.module.scss';

/** Props for one synchronized informational round timer. */
export interface IVotingTimerPanelProps {
  readonly timer: VotingTimer;
  readonly isHost: boolean;
  readonly disabled: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onReset: () => void;
}

/**
 * Renders a locally ticking timer and host-only synchronized commands.
 *
 * @param props - Persisted timer, role, busy state, and guarded commands.
 * @returns The timer status and controls.
 */
export function VotingTimerPanel(props: IVotingTimerPanelProps): React.ReactElement {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    setNow(Date.now());
    if (props.timer.status !== 'Running') {
      return undefined;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return (): void => window.clearInterval(interval);
  }, [props.timer]);
  const presentation = selectVotingTimer(props.timer, now);
  return (
    <section className={styles.timerPanel} aria-labelledby="voting-timer-heading">
      <h3 id="voting-timer-heading">Timer</h3>
      <p
        className={styles.timerValue}
        aria-label={`${presentation.remainingSeconds} seconds remaining`}
      >
        {presentation.formattedTime}
      </p>
      <p className={styles.timerStatus}>{presentation.status}</p>
      {presentation.status === 'Expired' && (
        <p className={styles.timerExpired} role="status">
          Time expired. Voting remains open.
        </p>
      )}
      <RoleGuard allowed={props.isHost}>
        <div className={styles.timerActions}>
          {presentation.status === 'Running' ? (
            <PrimaryButton disabled={props.disabled} onClick={props.onStop}>
              Stop
            </PrimaryButton>
          ) : (
            <PrimaryButton
              disabled={props.disabled || presentation.remainingSeconds === 0}
              onClick={props.onStart}
            >
              {presentation.status === 'Stopped' ? 'Resume' : 'Start'}
            </PrimaryButton>
          )}
          <DefaultButton
            disabled={
              props.disabled ||
              (presentation.status === 'Ready' &&
                presentation.remainingSeconds === props.timer.configuredDurationSeconds)
            }
            onClick={props.onReset}
          >
            Reset
          </DefaultButton>
        </div>
      </RoleGuard>
    </section>
  );
}
