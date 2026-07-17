import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryVotingRound,
  VoteRecord,
  VotingSession
} from '../domain/planningPokerDomain';
import { validateDocumentInvariants } from '../domain/planningPokerValidation';
import {
  createCanonicalVoteOperationKey,
  isValidOperationId,
  reconcileCollaborativeDocument,
  selectCanonicalVotes
} from './collaborationReconciliation';

/**
 * Creates a detached story for reconciliation coverage.
 *
 * @returns A Ready story with deterministic audit values.
 */
function createStory(): PointingStory {
  return {
    id: 'story-1',
    title: 'Convergent story',
    description: 'Story used by simultaneous commands.',
    status: 'Ready',
    estimateHistory: [],
    createdAt: fixtureDocument.createdAt,
    createdBy: fixtureUser,
    updatedAt: fixtureDocument.updatedAt,
    updatedBy: fixtureUser
  };
}

/**
 * Creates a session with a supplied stable identity.
 *
 * @param id - Stable session identifier.
 * @param rounds - Optional initial rounds.
 * @returns A Lobby or Active session fixture.
 */
function createSession(id: string, rounds: readonly StoryVotingRound[] = []): VotingSession {
  return {
    id,
    teamId: fixtureDocument.team.id,
    status: rounds.length > 0 ? 'Active' : 'Lobby',
    settings: fixtureDocument.team.settings,
    participants: [],
    rounds,
    ...(rounds.length === 0 ? {} : { activeRoundId: rounds[0].id }),
    finalizedRoundIds: [],
    createdAt: fixtureDocument.createdAt,
    createdBy: fixtureUser,
    updatedAt: fixtureDocument.updatedAt,
    updatedBy: fixtureUser
  };
}

describe('collaborative reconciliation', () => {
  it('validates bounded stable operation identities', () => {
    expect(isValidOperationId('vote-command-1')).toBe(true);
    expect(isValidOperationId('')).toBe(false);
    expect(isValidOperationId('   ')).toBe(false);
    expect(isValidOperationId('x'.repeat(201))).toBe(false);
  });

  it('repairs concurrent keyed facts deterministically and idempotently', () => {
    const firstRound: StoryVotingRound = {
      id: 'round-b',
      storyId: 'story-1',
      storySnapshot: { storyId: 'story-1', title: 'Convergent story', description: '' },
      status: 'Voting',
      votes: [
        {
          operationId: 'vote-b',
          participantId: 'named-b',
          value: '8',
          castAt: fixtureDocument.updatedAt
        },
        {
          operationId: 'vote-a',
          participantId: 'named-a',
          value: '3',
          castAt: fixtureDocument.updatedAt
        }
      ],
      timer: { configuredDurationSeconds: 0, status: 'Ready', remainingSeconds: 0 }
    };
    const secondRound: StoryVotingRound = {
      ...firstRound,
      id: 'round-a',
      votes: []
    };
    const losingSession = createSession('session-b');
    const winningSession: VotingSession = {
      ...createSession('session-a', [firstRound, secondRound]),
      participants: [
        {
          kind: 'Named',
          id: 'named-b',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        },
        {
          kind: 'Named',
          id: 'named-a',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        },
        {
          kind: 'Anonymous',
          id: 'anonymous-b',
          alias: 'Participant 1',
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        },
        {
          kind: 'Anonymous',
          id: 'anonymous-a',
          alias: 'Participant 1',
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ],
      activeRoundId: 'round-b'
    };
    const document = JSON.parse(
      JSON.stringify({
        ...fixtureDocument,
        stories: [createStory()],
        sessions: [losingSession, winningSession],
        openSessionId: losingSession.id
      })
    ) as PlanningPokerDocumentRoot;

    expect(reconcileCollaborativeDocument(document)).toMatchObject({
      changed: true,
      canonicalOpenSessionId: 'session-a'
    });
    expect(document.openSessionId).toBe('session-a');
    expect(document.sessions.find((session) => session.id === 'session-b')).toMatchObject({
      status: 'Ended'
    });
    const session = document.sessions.find(
      (candidate) => candidate.id === 'session-a'
    ) as VotingSession;
    expect(session.activeRoundId).toBe('round-a');
    expect(session.rounds.find((round) => round.id === 'round-b')).toMatchObject({
      status: 'Cancelled'
    });
    expect(session.participants.filter((participant) => participant.kind === 'Named')).toHaveLength(
      1
    );
    expect(
      session.participants
        .filter((participant) => participant.kind === 'Anonymous')
        .map((participant) => participant.alias)
        .sort()
    ).toEqual(['Participant 1', 'Participant 2']);
    expect(selectCanonicalVotes(session.rounds[0])).toEqual([
      expect.objectContaining({ operationId: 'vote-a', participantId: 'named-a', value: '3' })
    ]);
    expect(validateDocumentInvariants(document)).toEqual([]);
    expect(reconcileCollaborativeDocument(document)).toEqual({
      changed: false,
      canonicalOpenSessionId: 'session-a'
    });
  });

  it('deduplicates retries while preserving distinct causal corrections', () => {
    const story = createStory();
    const round: StoryVotingRound = {
      id: 'round-final',
      storyId: story.id,
      storySnapshot: { storyId: story.id, title: story.title, description: story.description },
      status: 'Finalized',
      votes: [],
      timer: { configuredDurationSeconds: 0, status: 'Stopped', remainingSeconds: 0 },
      assignedValue: '3',
      finalizedAt: fixtureDocument.updatedAt,
      finalizedBy: fixtureUser
    };
    const session: VotingSession = {
      ...createSession('session-final'),
      status: 'Ended',
      rounds: [round],
      finalizedRoundIds: [round.id, round.id]
    };
    const document = JSON.parse(
      JSON.stringify({
        ...fixtureDocument,
        stories: [
          {
            ...story,
            status: 'Pointed',
            currentEstimate: '3',
            estimateHistory: [
              {
                operationId: 'finalize-a',
                sessionId: session.id,
                roundId: round.id,
                value: '3',
                finalizedAt: fixtureDocument.updatedAt,
                finalizedBy: fixtureUser
              },
              {
                operationId: 'finalize-a',
                sessionId: session.id,
                roundId: round.id,
                value: '3',
                finalizedAt: fixtureDocument.updatedAt,
                finalizedBy: fixtureUser
              },
              {
                operationId: 'correction-b',
                supersedesOperationId: 'finalize-a',
                sessionId: session.id,
                roundId: round.id,
                value: '5',
                finalizedAt: '2026-07-17T01:00:00.000Z',
                finalizedBy: fixtureUser
              }
            ]
          }
        ],
        sessions: [session],
        openSessionId: undefined
      })
    ) as PlanningPokerDocumentRoot;

    reconcileCollaborativeDocument(document);

    expect(document.stories[0].estimateHistory).toHaveLength(2);
    expect(document.stories[0]).toMatchObject({ status: 'Pointed', currentEstimate: '5' });
    expect(document.sessions[0].rounds[0]).toMatchObject({
      assignedValue: '5',
      finalizationOperationId: 'correction-b'
    });
    expect(document.sessions[0].finalizedRoundIds).toEqual([round.id]);
    expect(validateDocumentInvariants(document)).toEqual([]);
  });

  it('assigns deterministic operation identities to legacy votes and history', () => {
    const story = createStory();
    const round: StoryVotingRound = {
      id: 'round-legacy',
      storyId: story.id,
      storySnapshot: { storyId: story.id, title: story.title, description: story.description },
      status: 'Finalized',
      votes: [
        {
          participantId: 'participant-legacy',
          value: '3',
          castAt: fixtureDocument.updatedAt
        }
      ],
      timer: { configuredDurationSeconds: 0, status: 'Stopped', remainingSeconds: 0 },
      assignedValue: '3',
      finalizedAt: fixtureDocument.updatedAt,
      finalizedBy: fixtureUser
    };
    const session: VotingSession = {
      ...createSession('session-legacy'),
      status: 'Ended',
      participants: [
        {
          kind: 'Named',
          id: 'participant-legacy',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Disconnected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ],
      rounds: [round],
      finalizedRoundIds: [round.id]
    };
    const document = JSON.parse(
      JSON.stringify({
        ...fixtureDocument,
        stories: [
          {
            ...story,
            status: 'Pointed',
            currentEstimate: '3',
            estimateHistory: [
              {
                sessionId: session.id,
                roundId: round.id,
                value: '3',
                finalizedAt: fixtureDocument.updatedAt,
                finalizedBy: fixtureUser
              }
            ]
          }
        ],
        sessions: [session]
      })
    ) as PlanningPokerDocumentRoot;

    expect(reconcileCollaborativeDocument(document).changed).toBe(true);
    expect(document.sessions[0].rounds[0].votes[0].operationId).toBe(
      'legacy-vote:round-legacy:participant-legacy:3'
    );
    expect(document.stories[0].estimateHistory[0].operationId).toBe(
      'legacy-history:session-legacy:round-legacy:3'
    );
    expect(reconcileCollaborativeDocument(document).changed).toBe(false);
  });

  it('keeps an undone reveal open until the canonical vote operations change', () => {
    const story = createStory();
    const round: StoryVotingRound = {
      id: 'round-undone',
      storyId: story.id,
      storySnapshot: { storyId: story.id, title: story.title, description: story.description },
      status: 'Voting',
      votes: [
        {
          operationId: 'vote-before-undo',
          participantId: 'participant-1',
          value: '3',
          castAt: fixtureDocument.updatedAt
        }
      ],
      timer: { configuredDurationSeconds: 300, status: 'Stopped', remainingSeconds: 240 }
    };
    const session: VotingSession = {
      ...createSession('session-undone', [round]),
      participants: [
        {
          kind: 'Named',
          id: 'participant-1',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ]
    };
    const document = JSON.parse(
      JSON.stringify({
        ...fixtureDocument,
        stories: [story],
        sessions: [session],
        openSessionId: session.id
      })
    ) as PlanningPokerDocumentRoot;
    const hydratedRound = document.sessions[0].rounds[0];
    (
      hydratedRound as unknown as {
        automaticRevealSuppressionKey?: string;
      }
    ).automaticRevealSuppressionKey = createCanonicalVoteOperationKey(hydratedRound);
    const options = { getConnectedParticipantIds: (): readonly string[] => ['participant-1'] };

    reconcileCollaborativeDocument(document, options);
    expect(hydratedRound.status).toBe('Voting');

    (hydratedRound.votes as VoteRecord[]).push({
      operationId: 'vote-after-undo',
      supersedesOperationId: 'vote-before-undo',
      participantId: 'participant-1',
      value: '5',
      castAt: '2026-07-17T12:00:00.000Z'
    });
    reconcileCollaborativeDocument(document, options);

    expect(hydratedRound).toMatchObject({
      status: 'Revealed',
      revealReason: 'Automatic',
      revealedVotedCount: 1
    });
    expect(hydratedRound.automaticRevealSuppressionKey).toBeUndefined();
  });
});
