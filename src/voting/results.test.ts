import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  SessionParticipant,
  StoryVotingRound,
  VotingSession
} from '../domain/planningPokerDomain';
import { canAutoReveal, selectVotingResults } from './results';

const participants: readonly SessionParticipant[] = [
  {
    kind: 'Named',
    id: 'participant-1',
    user: fixtureUser,
    joinedAt: '2026-07-11T12:00:00.000Z',
    presence: { connection: 'Connected', lastSeenAt: '2026-07-11T12:01:00.000Z' }
  },
  {
    kind: 'Named',
    id: 'participant-2',
    user: {
      ...fixtureUser,
      objectId: 'user-2',
      displayName: 'Second User',
      loginName: 'i:0#.f|membership|second@example.com'
    },
    joinedAt: '2026-07-11T12:00:10.000Z',
    presence: { connection: 'Connected', lastSeenAt: '2026-07-11T12:01:00.000Z' }
  }
];

const round: StoryVotingRound = {
  id: 'round-1',
  storyId: 'story-1',
  storySnapshot: { storyId: 'story-1', title: 'Story', description: '' },
  status: 'Voting',
  votes: [{ participantId: 'participant-1', value: '3', castAt: '2026-07-11T12:01:00.000Z' }],
  timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
};

function createSession(votingMode: 'Named' | 'Anonymous'): VotingSession {
  return {
    id: 'session-1',
    teamId: fixtureDocument.team.id,
    status: 'Active',
    settings: { ...fixtureDocument.team.settings, votingMode },
    participants,
    rounds: [round],
    activeRoundId: round.id,
    finalizedRoundIds: [],
    createdAt: fixtureDocument.createdAt,
    updatedAt: fixtureDocument.updatedAt
  };
}

describe('voting result selectors', () => {
  it('requires at least one connected voter and every connected vote for automatic reveal', () => {
    expect(canAutoReveal(round, [])).toBe(false);
    expect(canAutoReveal(round, participants)).toBe(false);
    expect(
      canAutoReveal(
        {
          ...round,
          votes: [
            ...round.votes,
            { participantId: 'participant-2', value: '5', castAt: '2026-07-11T12:01:01.000Z' }
          ]
        },
        participants
      )
    ).toBe(true);
    expect(
      canAutoReveal(round, [
        {
          ...participants[0],
          presence: { ...participants[0].presence, connection: 'Disconnected' }
        },
        participants[1]
      ])
    ).toBe(false);
    expect(
      canAutoReveal(round, [
        participants[0],
        {
          ...participants[1],
          presence: { ...participants[1].presence, connection: 'Disconnected' }
        }
      ])
    ).toBe(true);
  });

  it('returns only voted scale values in scale order and excludes late participants', () => {
    const session = createSession('Named');
    const presentation = selectVotingResults(
      {
        ...session,
        participants: [
          ...participants,
          {
            ...participants[1],
            id: 'participant-late',
            joinedAt: '2026-07-11T12:03:00.000Z'
          }
        ]
      },
      {
        ...round,
        status: 'Revealed',
        revealedAt: '2026-07-11T12:02:00.000Z',
        revealReason: 'Manual',
        revealedVotedCount: 1,
        revealedMissingCount: 1
      }
    );

    expect(presentation).toMatchObject({
      mode: 'Named',
      votedCount: 1,
      missingCount: 1,
      breakdown: [{ value: '3', count: 1, percentage: 100 }]
    });
    if (presentation?.mode === 'Named') {
      expect(presentation.rows).toEqual([
        expect.objectContaining({ displayName: fixtureUser.displayName, value: '3' }),
        expect.objectContaining({ displayName: 'Second User', upn: 'second@example.com' })
      ]);
      expect(presentation.rows.some((row) => row.participantId === 'participant-late')).toBe(false);
    }
  });

  it('returns anonymous aggregates without identity or alias fields', () => {
    const presentation = selectVotingResults(createSession('Anonymous'), {
      ...round,
      status: 'Revealed',
      revealedAt: '2026-07-11T12:02:00.000Z',
      revealReason: 'Automatic',
      revealedVotedCount: 1,
      revealedMissingCount: 0
    });
    const serialized = JSON.stringify(presentation);

    expect(presentation).toMatchObject({ mode: 'Anonymous', votedCount: 1, missingCount: 0 });
    expect(serialized).not.toContain('displayName');
    expect(serialized).not.toContain('loginName');
    expect(serialized).not.toContain('alias');
    expect(serialized).not.toContain(fixtureUser.displayName);
  });
});
