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
});
