import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryVotingRound,
  UserReference,
  VotingSession
} from '../domain/planningPokerDomain';
import {
  applyStoryCreate,
  applyStoryDelete,
  applyStoryEdit,
  applyStoryImport,
  applyStoryTransition,
  applyTeamActive,
  applyTeamEdit,
  applyVotingParticipantConnection,
  applyVotingSessionStart
} from './intentCommands';

const commandTime = '2026-07-16T15:00:00.000Z';

/**
 * Creates an isolated mutable root for intent-command unit tests.
 *
 * @param source - Plain source snapshot.
 * @returns A deep-cloned document root.
 */
function cloneDocument(source: PlanningPokerDocumentRoot): PlanningPokerDocumentRoot {
  return JSON.parse(JSON.stringify(source)) as PlanningPokerDocumentRoot;
}

/**
 * Creates one detached Ready story.
 *
 * @param id - Stable story identifier.
 * @param title - Story title.
 * @returns A valid story owned by the fixture host.
 */
function createStory(id: string, title: string): PointingStory {
  return {
    id,
    title,
    description: `${title} description`,
    status: 'Ready',
    estimateHistory: [],
    createdAt: fixtureDocument.createdAt,
    createdBy: fixtureUser,
    updatedAt: fixtureDocument.updatedAt,
    updatedBy: fixtureUser
  };
}

describe('intent-specific SharedTree commands', () => {
  it('updates Presence only in the authoritative open Lobby or Active session', () => {
    const participant = {
      kind: 'Named' as const,
      id: 'participant-one',
      user: fixtureUser,
      joinedAt: fixtureDocument.createdAt,
      presence: { connection: 'Connected' as const, lastSeenAt: fixtureDocument.updatedAt }
    };
    const lobby: VotingSession = {
      id: 'session-open',
      teamId: fixtureDocument.team.id,
      status: 'Lobby',
      settings: fixtureDocument.team.settings,
      participants: [participant],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const document = cloneDocument({
      ...fixtureDocument,
      sessions: [lobby, { ...lobby, id: 'session-non-open' }],
      openSessionId: lobby.id
    });

    expect(
      applyVotingParticipantConnection(document, {
        sessionId: lobby.id,
        participantId: participant.id,
        connection: 'Disconnected',
        timestamp: commandTime
      })
    ).toBe('updated');
    expect(document.sessions[0].participants[0].presence).toEqual({
      connection: 'Disconnected',
      lastSeenAt: commandTime
    });
    expect(
      applyVotingParticipantConnection(document, {
        sessionId: lobby.id,
        participantId: participant.id,
        connection: 'Disconnected',
        timestamp: '2026-07-16T15:00:01.000Z'
      })
    ).toBe('unchanged');
    expect(
      applyVotingParticipantConnection(document, {
        sessionId: 'session-non-open',
        participantId: participant.id,
        connection: 'Disconnected',
        timestamp: commandTime
      })
    ).toBe('invalid-session');
    expect(
      applyVotingParticipantConnection(document, {
        sessionId: 'missing-session',
        participantId: participant.id,
        connection: 'Disconnected',
        timestamp: commandTime
      })
    ).toBe('invalid-session');

    const mutableLobby = document.sessions[0] as VotingSession & {
      status: VotingSession['status'];
    };
    mutableLobby.status = 'Active';
    expect(
      applyVotingParticipantConnection(document, {
        sessionId: lobby.id,
        participantId: participant.id,
        connection: 'Connected',
        timestamp: '2026-07-16T15:00:02.000Z'
      })
    ).toBe('updated');
    mutableLobby.status = 'Ended';
    (document as PlanningPokerDocumentRoot & { openSessionId?: string }).openSessionId = undefined;
    const endedSnapshot = cloneDocument(document);
    expect(
      applyVotingParticipantConnection(document, {
        sessionId: lobby.id,
        participantId: participant.id,
        connection: 'Disconnected',
        timestamp: '2026-07-16T15:00:03.000Z'
      })
    ).toBe('session-ended');
    expect(document).toEqual(endedSnapshot);
  });

  it('rejects a stale team edit without restoring a removed host or old settings', () => {
    const removedHost: UserReference = {
      objectId: 'removed-host',
      displayName: 'Removed Host',
      loginName: 'removed@example.com'
    };
    const document = cloneDocument({
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        hosts: [fixtureUser],
        settings: {
          ...fixtureDocument.team.settings,
          timerEnabled: true,
          timerDurationSeconds: 60
        },
        updatedAt: '2026-07-16T14:00:00.000Z'
      }
    });
    const before = cloneDocument(document);

    const result = applyTeamEdit(document, {
      teamId: document.team.id,
      expectedUpdatedAt: fixtureDocument.team.updatedAt,
      title: document.team.title,
      description: 'Stale description',
      isActive: document.team.isActive,
      hosts: [fixtureUser, removedHost],
      configuredMembers: document.team.configuredMembers,
      settings: fixtureDocument.team.settings,
      currentUser: fixtureUser,
      updatedAt: commandTime
    });

    expect(result).toEqual({ status: 'conflict', reason: 'team-changed' });
    expect(document).toEqual(before);
  });

  it('changes only team activity and preserves concurrent roster, settings, stories, and sessions', () => {
    const story = createStory('existing-story', 'Existing');
    const document = cloneDocument({ ...fixtureDocument, stories: [story] });
    const preservedHosts = cloneDocument(document).team.hosts;
    const preservedSettings = cloneDocument(document).team.settings;
    const preservedStories = cloneDocument(document).stories;
    const preservedSessions = cloneDocument(document).sessions;

    const result = applyTeamActive(document, {
      teamId: document.team.id,
      expectedIsActive: true,
      isActive: false,
      currentUser: fixtureUser,
      updatedAt: commandTime
    });

    expect(result).toEqual({ status: 'applied' });
    expect(document.team.isActive).toBe(false);
    expect(document.team.hosts).toEqual(preservedHosts);
    expect(document.team.settings).toEqual(preservedSettings);
    expect(document.stories).toEqual(preservedStories);
    expect(document.sessions).toEqual(preservedSessions);
  });

  it('appends creates and imports while preserving existing stories and rejecting a batch atomically', () => {
    const existing = createStory('existing-story', 'Existing');
    const created = createStory('created-story', 'Created');
    const firstImport = createStory('import-one', 'Import one');
    const secondImport = createStory('import-two', 'Import two');
    const document = cloneDocument({ ...fixtureDocument, stories: [existing] });

    expect(
      applyStoryCreate(document, {
        story: created,
        currentUser: fixtureUser,
        updatedAt: commandTime
      })
    ).toEqual({ status: 'applied' });
    expect(
      applyStoryImport(document, {
        stories: [firstImport, secondImport],
        currentUser: fixtureUser,
        updatedAt: commandTime
      })
    ).toEqual({ status: 'applied' });
    expect(document.stories.map((story) => story.id)).toEqual([
      existing.id,
      created.id,
      firstImport.id,
      secondImport.id
    ]);
    expect(document.stories[1]).not.toBe(created);
    expect(document.stories[2]).not.toBe(firstImport);

    const beforeConflict = cloneDocument(document);
    expect(
      applyStoryImport(document, {
        stories: [
          { ...firstImport, title: 'Conflicting duplicate' },
          createStory('third', 'Third')
        ],
        currentUser: fixtureUser,
        updatedAt: commandTime
      })
    ).toEqual({ status: 'conflict', reason: 'duplicate-id' });
    expect(document).toEqual(beforeConflict);
  });

  it('surfaces a stale story edit and never overwrites concurrent finalization fields', () => {
    const staleBaseline = createStory('story-one', 'Original');
    const finalized: PointingStory = {
      ...staleBaseline,
      status: 'Pointed',
      currentEstimate: '5',
      estimateHistory: [
        {
          sessionId: 'session-one',
          roundId: 'round-one',
          value: '5',
          finalizedAt: '2026-07-16T14:00:00.000Z',
          finalizedBy: fixtureUser
        }
      ],
      updatedAt: '2026-07-16T14:00:00.000Z'
    };
    const document = cloneDocument({ ...fixtureDocument, stories: [finalized] });
    const before = cloneDocument(document);

    const result = applyStoryEdit(document, {
      storyId: finalized.id,
      expectedUpdatedAt: staleBaseline.updatedAt,
      title: 'Stale edit',
      description: 'Must not replace finalization',
      currentUser: fixtureUser,
      updatedAt: commandTime
    });

    expect(result).toEqual({ status: 'conflict', reason: 'story-changed' });
    expect(document).toEqual(before);
  });

  it('patches current story content while preserving lifecycle, estimates, and history', () => {
    const finalized: PointingStory = {
      ...createStory('story-one', 'Original'),
      status: 'Pointed',
      currentEstimate: '3',
      estimateHistory: [
        {
          sessionId: 'session-one',
          roundId: 'round-one',
          value: '3',
          finalizedAt: fixtureDocument.updatedAt,
          finalizedBy: fixtureUser
        }
      ]
    };
    const document = cloneDocument({ ...fixtureDocument, stories: [finalized] });

    const result = applyStoryEdit(document, {
      storyId: finalized.id,
      expectedUpdatedAt: finalized.updatedAt,
      title: 'Edited',
      description: 'Edited description',
      link: '/sites/team/edited',
      currentUser: fixtureUser,
      updatedAt: commandTime
    });

    expect(result).toEqual({ status: 'applied' });
    expect(document.stories[0]).toMatchObject({
      title: 'Edited',
      status: 'Pointed',
      currentEstimate: '3',
      estimateHistory: finalized.estimateHistory
    });
  });

  it('rechecks lifecycle and open-round guards before transition or deletion', () => {
    const story = createStory('story-one', 'Story');
    const round: StoryVotingRound = {
      id: 'round-one',
      storyId: story.id,
      storySnapshot: {
        storyId: story.id,
        title: story.title,
        description: story.description
      },
      status: 'Voting',
      votes: [],
      timer: { configuredDurationSeconds: 0, status: 'Ready', remainingSeconds: 0 }
    };
    const session: VotingSession = {
      id: 'session-one',
      teamId: fixtureDocument.team.id,
      status: 'Active',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [round],
      activeRoundId: round.id,
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const document = cloneDocument({
      ...fixtureDocument,
      stories: [story],
      sessions: [session],
      openSessionId: session.id
    });
    const before = cloneDocument(document);

    expect(
      applyStoryTransition(document, {
        storyId: story.id,
        status: 'Archived',
        allowedFrom: ['Ready', 'Pointed'],
        currentUser: fixtureUser,
        updatedAt: commandTime
      })
    ).toEqual({ status: 'rejected', reason: 'story-in-open-round' });
    expect(
      applyStoryDelete(document, {
        storyId: story.id,
        currentUser: fixtureUser,
        updatedAt: commandTime
      })
    ).toEqual({ status: 'rejected', reason: 'story-in-open-round' });
    expect(document).toEqual(before);
  });

  it('starts only the authoritative Lobby and preserves joined participants and sibling history', () => {
    const endedSession: VotingSession = {
      id: 'ended-session',
      teamId: fixtureDocument.team.id,
      status: 'Ended',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      endedAt: fixtureDocument.updatedAt,
      endedBy: fixtureUser,
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const lobby: VotingSession = {
      ...endedSession,
      id: 'lobby-session',
      status: 'Lobby',
      participants: [
        {
          kind: 'Named',
          id: 'participant-one',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ],
      endedAt: undefined,
      endedBy: undefined
    };
    const document = cloneDocument({
      ...fixtureDocument,
      sessions: [endedSession, lobby],
      openSessionId: lobby.id
    });
    const preservedEnded = cloneDocument(document).sessions[0];
    const preservedParticipants = cloneDocument(document).sessions[1].participants;

    expect(applyVotingSessionStart(document, lobby.id, fixtureUser, commandTime)).toEqual({
      status: 'applied'
    });
    expect(document.sessions[0]).toEqual(preservedEnded);
    expect(document.sessions[1].participants).toEqual(preservedParticipants);
    expect(document.sessions[1].status).toBe('Active');
    expect(applyVotingSessionStart(document, lobby.id, fixtureUser, commandTime)).toEqual({
      status: 'idempotent'
    });
  });
});
