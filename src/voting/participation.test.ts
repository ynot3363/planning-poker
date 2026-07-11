import {
  anonymousParticipantFixture,
  fixtureDocument,
  fixtureUser
} from '../domain/planningPokerFixtures';
import type { VotingSession } from '../domain/planningPokerDomain';
import {
  getEligibleVoterIds,
  normalizeParticipantUpn,
  selectCurrentVoteValue,
  selectParticipation
} from './participation';

const namedParticipant = {
  kind: 'Named' as const,
  id: 'named-1',
  user: fixtureUser,
  joinedAt: fixtureDocument.createdAt,
  presence: { connection: 'Connected' as const, lastSeenAt: fixtureDocument.updatedAt }
};

/**
 * Creates the smallest synchronized session required by participation selectors.
 *
 * @param mode - Privacy mode to represent in the fixture.
 * @returns A session with one joined participant and one hidden vote.
 */
function createSession(mode: 'Named' | 'Anonymous'): VotingSession {
  return {
    id: 'session-1',
    teamId: fixtureDocument.team.id,
    status: 'Active',
    settings: { ...fixtureDocument.team.settings, votingMode: mode },
    participants: mode === 'Named' ? [namedParticipant] : [anonymousParticipantFixture],
    rounds: [
      {
        id: 'round-1',
        storyId: 'story-1',
        storySnapshot: { storyId: 'story-1', title: 'Story', description: '' },
        status: 'Voting',
        votes: [
          {
            participantId: mode === 'Named' ? 'named-1' : 'participant-1',
            value: '8',
            castAt: fixtureDocument.updatedAt
          }
        ],
        timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
      }
    ],
    activeRoundId: 'round-1',
    finalizedRoundIds: [],
    createdAt: fixtureDocument.createdAt,
    updatedAt: fixtureDocument.updatedAt
  };
}

describe('participation selectors', () => {
  it('derives eligible voters only from the joined roster', () => {
    expect(getEligibleVoterIds(createSession('Named'))).toEqual(['named-1']);
  });

  it('shows named vote status without exposing the vote value', () => {
    const presentation = selectParticipation(createSession('Named'), 'named-1');

    expect(presentation).toEqual({
      mode: 'Named',
      counts: { joined: 1, connected: 1, disconnected: 0, voted: 1, remaining: 0 },
      rows: [
        expect.objectContaining({
          displayName: fixtureUser.displayName,
          upn: fixtureUser.loginName,
          hasVoted: true
        })
      ]
    });
    expect(JSON.stringify(presentation)).not.toContain('"8"');
  });

  it('normalizes SharePoint claims logins for live persona and photo lookups', () => {
    expect(normalizeParticipantUpn('i:0#.f|membership| ada@example.com ')).toBe('ada@example.com');
    expect(normalizeParticipantUpn('grace@example.com')).toBe('grace@example.com');

    const session = createSession('Named');
    const presentation = selectParticipation(
      {
        ...session,
        participants: [
          {
            ...namedParticipant,
            user: {
              ...fixtureUser,
              loginName: 'i:0#.f|membership|ada@example.com'
            }
          }
        ]
      },
      'named-1'
    );

    expect(presentation.mode).toBe('Named');
    if (presentation.mode === 'Named') {
      expect(presentation.rows[0].upn).toBe('ada@example.com');
    }
  });

  it('returns only the current participant vote for local selection feedback', () => {
    expect(selectCurrentVoteValue(createSession('Named'), 'named-1')).toBe('8');
    expect(selectCurrentVoteValue(createSession('Named'), 'someone-else')).toBeUndefined();
  });

  it('shows only aggregate anonymous state plus the current browser alias', () => {
    expect(selectParticipation(createSession('Anonymous'), 'participant-1')).toEqual({
      mode: 'Anonymous',
      counts: { joined: 1, connected: 1, disconnected: 0, voted: 1, remaining: 0 },
      currentAlias: 'Participant 1'
    });
  });

  it('retains a disconnected named voter without counting them as remaining', () => {
    const session = createSession('Named');
    const disconnectedSession: VotingSession = {
      ...session,
      participants: [
        {
          ...namedParticipant,
          presence: {
            connection: 'Disconnected',
            lastSeenAt: fixtureDocument.updatedAt
          }
        }
      ],
      rounds: [{ ...session.rounds[0], votes: [] }]
    };
    const presentation = selectParticipation(disconnectedSession, 'named-1');

    expect(presentation.counts).toEqual({
      joined: 1,
      connected: 0,
      disconnected: 1,
      voted: 0,
      remaining: 0
    });
    expect(getEligibleVoterIds(disconnectedSession)).toEqual([]);
  });
});
