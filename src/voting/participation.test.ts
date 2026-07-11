import {
  anonymousParticipantFixture,
  fixtureDocument,
  fixtureUser
} from '../domain/planningPokerFixtures';
import type { VotingSession } from '../domain/planningPokerDomain';
import { getEligibleVoterIds, selectParticipation } from './participation';

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
      counts: { joined: 1, voted: 1, remaining: 0 },
      rows: [expect.objectContaining({ displayName: fixtureUser.displayName, hasVoted: true })]
    });
    expect(JSON.stringify(presentation)).not.toContain('"8"');
  });

  it('shows only aggregate anonymous state plus the current browser alias', () => {
    expect(selectParticipation(createSession('Anonymous'), 'participant-1')).toEqual({
      mode: 'Anonymous',
      counts: { joined: 1, voted: 1, remaining: 0 },
      currentAlias: 'Participant 1'
    });
  });
});
