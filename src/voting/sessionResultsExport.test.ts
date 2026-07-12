import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { VotingSession } from '../domain/planningPokerDomain';
import {
  SESSION_RESULT_COLUMNS,
  createSessionResultRows,
  createSessionResultsFileName,
  serializeSessionResults
} from './sessionResultsExport';

const session: VotingSession = {
  id: 'session-1',
  teamId: fixtureDocument.team.id,
  status: 'Ended',
  settings: fixtureDocument.team.settings,
  participants: [
    {
      kind: 'Named',
      id: 'secret-participant',
      user: fixtureUser,
      joinedAt: fixtureDocument.createdAt,
      presence: { connection: 'Disconnected', lastSeenAt: fixtureDocument.updatedAt }
    }
  ],
  rounds: [
    {
      id: 'round-final',
      storyId: 'story-final',
      storySnapshot: {
        storyId: 'story-final',
        title: '=Final, "story"',
        description: 'Snapshot description',
        link: 'https://example.com/item\n1'
      },
      status: 'Finalized',
      votes: [
        { participantId: 'secret-participant', value: '5', castAt: fixtureDocument.updatedAt },
        { participantId: 'secret-other', value: '3', castAt: fixtureDocument.updatedAt }
      ],
      timer: { configuredDurationSeconds: 300, status: 'Stopped', remainingSeconds: 20 },
      assignedValue: '5',
      finalizedAt: '2026-07-11T13:00:00.000Z',
      finalizedBy: fixtureUser
    },
    {
      id: 'round-cancelled',
      storyId: 'story-cancelled',
      storySnapshot: { storyId: 'story-cancelled', title: 'Cancelled', description: '' },
      status: 'Cancelled',
      votes: [],
      timer: { configuredDurationSeconds: 300, status: 'Stopped', remainingSeconds: 300 }
    }
  ],
  finalizedRoundIds: ['round-final'],
  endedAt: '2026-07-11T13:10:00.000Z',
  endedBy: fixtureUser,
  createdAt: fixtureDocument.createdAt,
  updatedAt: fixtureDocument.updatedAt
};

describe('session results export', () => {
  it('projects finalized rounds only with scale-ordered aggregate data', () => {
    expect(createSessionResultRows(fixtureDocument, session)).toEqual([
      expect.objectContaining({
        storyId: 'story-final',
        storyTitle: '=Final, "story"',
        assignedPointValue: '5',
        totalVotes: 2,
        voteBreakdown: '3: 1; 5: 1'
      })
    ]);
  });

  it('serializes escaped formula-safe CSV without identity or vote records', () => {
    const csv = serializeSessionResults(fixtureDocument, session);
    expect(csv.startsWith(`\uFEFF${SESSION_RESULT_COLUMNS.join(',')}\r\n`)).toBe(true);
    expect(csv).toContain('"\'=Final, ""story"""');
    expect(csv).toContain('"https://example.com/item\n1"');
    for (const secret of [
      fixtureUser.displayName,
      fixtureUser.loginName,
      fixtureUser.objectId,
      'secret-participant',
      'secret-other'
    ]) {
      expect(csv).not.toContain(secret);
    }
  });

  it('emits a header-only export and safe required filename', () => {
    expect(
      serializeSessionResults(fixtureDocument, { ...session, rounds: [], finalizedRoundIds: [] })
    ).toBe(`\uFEFF${SESSION_RESULT_COLUMNS.join(',')}\r\n`);
    expect(createSessionResultsFileName('Delivery / Team.', 'session:1')).toBe(
      'Delivery - Team-session-session-1-results.csv'
    );
  });
});
