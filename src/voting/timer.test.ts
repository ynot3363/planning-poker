import { selectVotingTimer } from './timer';

describe('voting timer presentation', () => {
  it('formats Ready and Stopped time without changing the persisted value', () => {
    expect(
      selectVotingTimer(
        { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 },
        Date.parse('2026-07-11T12:00:00.000Z')
      )
    ).toEqual({ status: 'Ready', remainingSeconds: 300, formattedTime: '5:00' });
  });

  it('derives a running countdown and clamps expiration at zero', () => {
    const timer = {
      configuredDurationSeconds: 60,
      status: 'Running' as const,
      remainingSeconds: 45,
      startedAt: '2026-07-11T12:00:00.000Z'
    };

    expect(selectVotingTimer(timer, Date.parse('2026-07-11T12:00:12.000Z'))).toEqual({
      status: 'Running',
      remainingSeconds: 33,
      formattedTime: '0:33'
    });
    expect(selectVotingTimer(timer, Date.parse('2026-07-11T12:02:00.000Z'))).toEqual({
      status: 'Expired',
      remainingSeconds: 0,
      formattedTime: '0:00'
    });
  });

  it('clamps negative elapsed time when a client clock is behind the start timestamp', () => {
    expect(
      selectVotingTimer(
        {
          configuredDurationSeconds: 60,
          status: 'Running',
          remainingSeconds: 60,
          startedAt: '2026-07-11T12:00:10.000Z'
        },
        Date.parse('2026-07-11T12:00:00.000Z')
      )
    ).toEqual({ status: 'Running', remainingSeconds: 60, formattedTime: '1:00' });
  });

  it('does not derive elapsed time for stopped timers after refresh', () => {
    expect(
      selectVotingTimer(
        {
          configuredDurationSeconds: 300,
          status: 'Stopped',
          remainingSeconds: 125,
          stoppedAt: '2026-07-11T12:00:00.000Z'
        },
        Date.parse('2026-07-12T12:00:00.000Z')
      )
    ).toEqual({ status: 'Stopped', remainingSeconds: 125, formattedTime: '2:05' });
  });
});
