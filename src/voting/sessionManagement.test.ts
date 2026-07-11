import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  SessionParticipant,
  UserReference
} from '../domain/planningPokerDomain';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
import { TeamRepository } from '../repository/teamRepository';
import type {
  HostedTeamSummary,
  ITeamDocumentStore,
  TeamDocumentHandle
} from '../repository/teamRepository';
import type { IParticipantSessionStorage } from './sessionManagement';
import {
  createSessionShareUrl,
  selectEligibleVotingStories,
  VotingSessionService
} from './sessionManagement';

const storage: IPlanningPokerStorageConfiguration = {
  libraryTitle: 'PlanningPokerAppData',
  listId: 'list-id',
  driveId: 'drive-id',
  serverRelativeUrl: '/sites/team/PlanningPokerAppData',
  webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
  provisioningVersion: '1.0.0',
  schemaVersion: '1.0.0',
  fieldMap: {},
  lastValidatedAt: '2026-07-11T00:00:00.000Z'
};

const summary: HostedTeamSummary = {
  teamId: fixtureDocument.team.id,
  driveItemId: 'drive-item-id',
  title: fixtureDocument.team.title,
  isActive: true
};

function createHarness(
  initial: PlanningPokerDocumentRoot = fixtureDocument,
  user: UserReference = fixtureUser,
  participantStorage?: IParticipantSessionStorage,
  createId: () => string = () => 'session-new'
): {
  readonly service: VotingSessionService;
  readonly handle: TeamDocumentHandle;
  readonly store: ITeamDocumentStore;
  getDocument(): PlanningPokerDocumentRoot;
} {
  let document = initial;
  const listeners = new Set<() => void>();
  const handle: TeamDocumentHandle = {
    teamId: document.team.id,
    driveItemId: summary.driveItemId,
    getSnapshot: () => document,
    getConnectionState: () => 'Connected',
    updateTeam: jest.fn(),
    updateStories: jest.fn(),
    updateSessions: jest.fn((sessions, openSessionId, updatedAt) => {
      document = { ...document, sessions, openSessionId, updatedAt };
      listeners.forEach((listener) => listener());
    }),
    prepareVotingSession: jest.fn((candidate, updatedAt) => {
      const existing = document.sessions.find(
        (current) =>
          current.id === document.openSessionId &&
          (current.status === 'Lobby' || current.status === 'Active')
      );
      if (existing !== undefined) {
        return existing.id;
      }
      document = {
        ...document,
        sessions: [...document.sessions, candidate],
        openSessionId: candidate.id,
        updatedAt
      };
      listeners.forEach((listener) => listener());
      return candidate.id;
    }),
    joinVotingSession: jest.fn((sessionId, join, timestamp) => {
      const session = document.sessions.find((candidate) => candidate.id === sessionId);
      if (session === undefined || session.status === 'Ended') {
        return undefined;
      }
      const existing = session.participants.find((participant) =>
        join.kind === 'Named'
          ? participant.kind === 'Named' && participant.user.objectId === join.user.objectId
          : participant.kind === 'Anonymous' && participant.id === join.participantId
      );
      let selected: SessionParticipant;
      if (existing !== undefined) {
        selected = {
          ...existing,
          presence: { connection: 'Connected', lastSeenAt: timestamp }
        };
      } else if (join.kind === 'Named') {
        selected = {
          kind: 'Named',
          id: join.participantId,
          user: join.user,
          joinedAt: timestamp,
          presence: { connection: 'Connected', lastSeenAt: timestamp }
        };
      } else {
        const aliases = session.participants.filter(
          (participant) => participant.kind === 'Anonymous'
        ).length;
        selected = {
          kind: 'Anonymous',
          id: join.participantId,
          alias: `Participant ${aliases + 1}`,
          joinedAt: timestamp,
          presence: { connection: 'Connected', lastSeenAt: timestamp }
        };
      }
      const participants =
        existing === undefined
          ? [...session.participants, selected]
          : session.participants.map((participant) =>
              participant.id === existing.id ? selected : participant
            );
      document = {
        ...document,
        sessions: document.sessions.map((candidate) =>
          candidate.id === session.id
            ? { ...candidate, participants, updatedAt: timestamp }
            : candidate
        ),
        updatedAt: timestamp
      };
      listeners.forEach((listener) => listener());
      return selected;
    }),
    selectVotingStory: jest.fn(
      (sessionId, storyId, roundId, currentUser, replaceActive, timestamp) => {
        const session = document.sessions.find((candidate) => candidate.id === sessionId);
        const story = document.stories.find((candidate) => candidate.id === storyId);
        if (session === undefined || session.status !== 'Active') return 'invalid-session';
        if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
          return 'host-required';
        }
        if (story === undefined || story.status !== 'Ready') return 'invalid-story';
        const active = session.rounds.find((round) => round.id === session.activeRoundId);
        if (active !== undefined && !replaceActive) return 'active-round';
        if (active !== undefined && active.votes.length > 0) return 'round-has-votes';
        const duration = session.settings.timerEnabled
          ? (session.settings.timerDurationSeconds ?? 0)
          : 0;
        const rounds = [
          ...session.rounds.map((round) =>
            round.id === active?.id ? { ...round, status: 'Cancelled' as const } : round
          ),
          {
            id: roundId,
            storyId,
            storySnapshot: {
              storyId,
              title: story.title,
              description: story.description,
              ...(story.link === undefined ? {} : { link: story.link })
            },
            status: 'Voting' as const,
            votes: [],
            timer: {
              configuredDurationSeconds: duration,
              status: 'Ready' as const,
              remainingSeconds: duration
            }
          }
        ];
        document = {
          ...document,
          sessions: document.sessions.map((candidate) =>
            candidate.id === sessionId
              ? { ...candidate, rounds, activeRoundId: roundId, updatedAt: timestamp }
              : candidate
          ),
          updatedAt: timestamp
        };
        listeners.forEach((listener) => listener());
        return 'selected';
      }
    ),
    castVotingVote: jest.fn((sessionId, roundId, vote) => {
      const session = document.sessions.find((candidate) => candidate.id === sessionId);
      if (session === undefined || session.status !== 'Active') return 'invalid-session';
      if (!session.participants.some((participant) => participant.id === vote.participantId)) {
        return 'participant-required';
      }
      const round = session.rounds.find((candidate) => candidate.id === roundId);
      if (round === undefined || session.activeRoundId !== roundId || round.status !== 'Voting') {
        return 'invalid-round';
      }
      if (session.settings.scaleValues.indexOf(vote.value) < 0) return 'invalid-vote';
      const votes = round.votes.some((candidate) => candidate.participantId === vote.participantId)
        ? round.votes.map((candidate) =>
            candidate.participantId === vote.participantId ? vote : candidate
          )
        : [...round.votes, vote];
      document = {
        ...document,
        sessions: document.sessions.map((candidate) =>
          candidate.id === sessionId
            ? {
                ...candidate,
                rounds: candidate.rounds.map((item) =>
                  item.id === roundId ? { ...item, votes } : item
                ),
                updatedAt: vote.castAt
              }
            : candidate
        ),
        updatedAt: vote.castAt
      };
      listeners.forEach((listener) => listener());
      return 'cast';
    }),
    updateVotingTimer: jest.fn((sessionId, roundId, command, currentUser, timestamp) => {
      const session = document.sessions.find((candidate) => candidate.id === sessionId);
      if (session === undefined || session.status !== 'Active') return 'invalid-session';
      if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
        return 'host-required';
      }
      if (!session.settings.timerEnabled) return 'timer-disabled';
      const round = session.rounds.find(
        (candidate) => candidate.id === roundId && candidate.id === session.activeRoundId
      );
      if (round === undefined) return 'invalid-round';
      const timer =
        command === 'reset'
          ? {
              configuredDurationSeconds: round.timer.configuredDurationSeconds,
              status: 'Ready' as const,
              remainingSeconds: round.timer.configuredDurationSeconds,
              resetAt: timestamp
            }
          : command === 'stop'
            ? {
                configuredDurationSeconds: round.timer.configuredDurationSeconds,
                status: 'Stopped' as const,
                remainingSeconds: round.timer.remainingSeconds,
                stoppedAt: timestamp
              }
            : {
                configuredDurationSeconds: round.timer.configuredDurationSeconds,
                status: 'Running' as const,
                remainingSeconds: round.timer.remainingSeconds,
                startedAt: timestamp
              };
      document = {
        ...document,
        sessions: document.sessions.map((candidate) =>
          candidate.id === sessionId
            ? {
                ...candidate,
                rounds: candidate.rounds.map((item) =>
                  item.id === roundId ? { ...item, timer } : item
                )
              }
            : candidate
        )
      };
      listeners.forEach((listener) => listener());
      return 'updated';
    }),
    setVotingParticipantConnection: jest.fn((sessionId, participantId, connection, timestamp) => {
      document = {
        ...document,
        sessions: document.sessions.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                participants: session.participants.map((participant) =>
                  participant.id === participantId
                    ? { ...participant, presence: { connection, lastSeenAt: timestamp } }
                    : participant
                )
              }
            : session
        )
      };
    }),
    waitForSaved: jest.fn(async () => undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: jest.fn()
  };
  const store: ITeamDocumentStore = {
    list: jest.fn(async () => [summary]),
    listHostedBy: jest.fn(async () => [summary]),
    listParticipatingIn: jest.fn(async () => []),
    create: jest.fn(async () => handle),
    load: jest.fn(async () => handle),
    rename: jest.fn(async () => undefined),
    recycle: jest.fn(async () => ({})),
    updateMetadata: jest.fn(async () => undefined)
  };
  return {
    service: new VotingSessionService(
      new TeamRepository(storage, store),
      user,
      createId,
      () => '2026-07-11T12:30:00.000Z',
      participantStorage
    ),
    handle,
    store,
    getDocument: () => document
  };
}

describe('VotingSessionService', () => {
  it('creates one durable Lobby with a settings snapshot and discovery metadata', async () => {
    const harness = createHarness();

    const context = await harness.service.prepareSession(summary);

    expect(context.getSession()).toMatchObject({
      id: 'session-new',
      teamId: fixtureDocument.team.id,
      status: 'Lobby',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: []
    });
    expect(harness.getDocument().openSessionId).toBe('session-new');
    expect(harness.handle.waitForSaved).toHaveBeenCalledTimes(1);
    expect(harness.store.updateMetadata).toHaveBeenCalledWith(harness.getDocument());
  });

  it('reuses the authoritative open session instead of creating a duplicate Lobby', async () => {
    const first = createHarness();
    const prepared = await first.service.prepareSession(summary);
    const harness = createHarness(first.getDocument());

    const reopened = await harness.service.prepareSession(summary);

    expect(reopened.getSession().id).toBe(prepared.getSession().id);
    expect(harness.handle.updateSessions).not.toHaveBeenCalled();
  });

  it('converges concurrent prepare attempts on one transactionally guarded Lobby', async () => {
    const harness = createHarness();

    const [first, second] = await Promise.all([
      harness.service.prepareSession(summary),
      harness.service.prepareSession(summary)
    ]);

    expect(first.getSession().id).toBe(second.getSession().id);
    expect(harness.getDocument().sessions).toHaveLength(1);
    expect(harness.handle.prepareVotingSession).toHaveBeenCalledTimes(1);
  });

  it('allows an authenticated user outside the configured roster to resolve an accessible Lobby', async () => {
    const hostHarness = createHarness();
    await hostHarness.service.prepareSession(summary);
    const guest: UserReference = {
      objectId: 'guest-id',
      displayName: 'Guest User',
      loginName: 'guest@example.com'
    };
    const guestHarness = createHarness(hostHarness.getDocument(), guest);

    const context = await guestHarness.service.joinSession(fixtureDocument.team.id, 'session-new');

    expect(context.isHost).toBe(false);
    expect(context.isConfiguredMember).toBe(false);
    expect(context.getSession().status).toBe('Lobby');
    expect(context.getSession().participants).toEqual([
      expect.objectContaining({ kind: 'Named', user: guest })
    ]);
  });

  it('deduplicates named joins by stable Entra object ID', async () => {
    const hostHarness = createHarness();
    const prepared = await hostHarness.service.prepareSession(summary);

    const first = await hostHarness.service.joinSession(summary.teamId, prepared.getSession().id);
    const second = await hostHarness.service.joinSession(summary.teamId, prepared.getSession().id);

    expect(first.participantId).toBe(second.participantId);
    expect(second.getSession().participants).toHaveLength(1);
  });

  it('reclaims an anonymous alias from browser-session state without persisting identity', async () => {
    const values = new Map<string, string>();
    const browserStorage: IParticipantSessionStorage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    };
    const anonymousDocument: PlanningPokerDocumentRoot = {
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        settings: { ...fixtureDocument.team.settings, votingMode: 'Anonymous' }
      }
    };
    const harness = createHarness(anonymousDocument, fixtureUser, browserStorage);
    const prepared = await harness.service.prepareSession(summary);

    const first = await harness.service.joinSession(summary.teamId, prepared.getSession().id);
    const second = await harness.service.joinSession(summary.teamId, prepared.getSession().id);

    expect(first.participantId).toBe(second.participantId);
    expect(second.getSession().participants).toEqual([
      expect.objectContaining({ kind: 'Anonymous', alias: 'Participant 1' })
    ]);
    expect(JSON.stringify(second.getSession())).not.toContain(fixtureUser.objectId);
    expect(JSON.stringify(second.getSession())).not.toContain(fixtureUser.loginName);
  });

  it('allocates unique sequential aliases when anonymous clients join concurrently', async () => {
    const anonymousDocument: PlanningPokerDocumentRoot = {
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        settings: { ...fixtureDocument.team.settings, votingMode: 'Anonymous' }
      }
    };
    let firstId = 0;
    const first = createHarness(
      anonymousDocument,
      fixtureUser,
      { getItem: () => undefined, setItem: jest.fn(), removeItem: jest.fn() },
      () => `first-${(firstId += 1)}`
    );
    const prepared = await first.service.prepareSession(summary);
    let secondId = 0;
    const secondService = new VotingSessionService(
      new TeamRepository(storage, first.store),
      { ...fixtureUser, objectId: 'second-user' },
      () => `second-${(secondId += 1)}`,
      () => '2026-07-11T12:30:00.000Z',
      { getItem: () => undefined, setItem: jest.fn(), removeItem: jest.fn() }
    );

    await Promise.all([
      first.service.joinSession(summary.teamId, prepared.getSession().id),
      secondService.joinSession(summary.teamId, prepared.getSession().id)
    ]);

    expect(prepared.getSession().participants).toEqual([
      expect.objectContaining({ alias: 'Participant 1' }),
      expect.objectContaining({ alias: 'Participant 2' })
    ]);
  });

  it('starts voting once and treats a repeated start as idempotent', async () => {
    const harness = createHarness();
    const context = await harness.service.prepareSession(summary);
    const updatesAfterPrepare = (harness.handle.updateSessions as jest.Mock).mock.calls.length;

    await expect(harness.service.startVoting(context)).resolves.toMatchObject({ status: 'Active' });
    await expect(harness.service.startVoting(context)).resolves.toMatchObject({ status: 'Active' });

    expect((harness.handle.updateSessions as jest.Mock).mock.calls.length).toBe(
      updatesAfterPrepare + 1
    );
  });

  it('synchronizes the Lobby-to-Active transition to another subscribed context', async () => {
    const harness = createHarness();
    const host = await harness.service.prepareSession(summary);
    const participant = await harness.service.joinSession(summary.teamId, host.getSession().id);
    const changed = jest.fn();
    const unsubscribe = harness.service.subscribe(participant, changed);

    await harness.service.startVoting(host);

    expect(participant.getSession().status).toBe('Active');
    expect(changed).toHaveBeenCalled();
    unsubscribe();
  });

  it('lists hosted teams plus open configured-participant sessions without duplicates', async () => {
    const harness = createHarness();
    const participantTeam: HostedTeamSummary = {
      teamId: 'participant-team',
      driveItemId: 'participant-drive',
      title: 'Participant Team',
      isActive: true,
      activeSessionId: 'participant-session'
    };
    (harness.store.listParticipatingIn as jest.Mock).mockResolvedValue([
      participantTeam,
      { ...summary, activeSessionId: 'host-session' }
    ]);

    await expect(harness.service.listVotingTeams()).resolves.toEqual([
      expect.objectContaining({ teamId: summary.teamId, relationship: 'Host' }),
      expect.objectContaining({ teamId: participantTeam.teamId, relationship: 'Participant' })
    ]);
  });

  it('marks a departing named client disconnected without removing its roster entry', async () => {
    const harness = createHarness();
    const prepared = await harness.service.prepareSession(summary);
    const participant = await harness.service.joinSession(summary.teamId, prepared.getSession().id);

    harness.service.markDisconnected(participant);

    expect(participant.getSession().participants).toEqual([
      expect.objectContaining({
        id: participant.participantId,
        presence: expect.objectContaining({ connection: 'Disconnected' })
      })
    ]);
  });

  it('selects a Ready story, snapshots it, and upserts one vote per participant', async () => {
    const story = {
      id: 'story-ready',
      teamId: fixtureDocument.team.id,
      title: 'Synchronize estimates',
      description: 'Vote together.',
      link: '/sites/team/Lists/Backlog/1',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    let nextId = 0;
    const harness = createHarness(
      { ...fixtureDocument, stories: [story] },
      fixtureUser,
      undefined,
      () => `generated-${(nextId += 1)}`
    );
    const prepared = await harness.service.prepareSession(summary);
    const joined = await harness.service.joinSession(summary.teamId, prepared.getSession().id);
    await harness.service.startVoting(joined);

    await harness.service.selectStory(joined, story.id);
    const round = joined.getSession().rounds[0];
    const metadataUpdatesBeforeVotes = (harness.store.updateMetadata as jest.Mock).mock.calls
      .length;
    expect(round).toMatchObject({
      storyId: story.id,
      storySnapshot: { title: story.title, link: story.link },
      status: 'Voting',
      votes: []
    });

    await harness.service.castVote(joined, round.id, '3');
    await harness.service.castVote(joined, round.id, '5');

    expect(joined.getSession().rounds[0].votes).toEqual([
      expect.objectContaining({ participantId: joined.participantId, value: '5' })
    ]);
    expect(harness.store.updateMetadata).toHaveBeenCalledTimes(metadataUpdatesBeforeVotes);
  });

  it('runs synchronized host timer commands for the active round', async () => {
    const story = {
      id: 'timed-story',
      title: 'Timed story',
      description: '',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    let nextId = 0;
    const harness = createHarness(
      { ...fixtureDocument, stories: [story] },
      fixtureUser,
      undefined,
      () => `timer-${(nextId += 1)}`
    );
    const prepared = await harness.service.prepareSession(summary);
    const host = await harness.service.joinSession(summary.teamId, prepared.getSession().id);
    await harness.service.startVoting(host);
    await harness.service.selectStory(host, story.id);
    const roundId = host.getSession().activeRoundId as string;

    await harness.service.startTimer(host, roundId);
    expect(host.getSession().rounds[0].timer.status).toBe('Running');
    await harness.service.stopTimer(host, roundId);
    expect(host.getSession().rounds[0].timer.status).toBe('Stopped');
    await harness.service.startTimer(host, roundId);
    expect(host.getSession().rounds[0].timer.status).toBe('Running');
    await harness.service.resetTimer(host, roundId);
    expect(host.getSession().rounds[0].timer).toMatchObject({
      status: 'Ready',
      remainingSeconds: 300
    });
    jest.mocked(harness.handle.updateVotingTimer).mockReturnValueOnce('invalid-command');
    await expect(harness.service.startTimer(host, roundId)).rejects.toMatchObject({
      code: 'invalid-timer-command',
      message: 'The timer has already moved to another state.'
    });
  });

  it('rejects invalid scale values, stale rounds, and replacement after any vote', async () => {
    const story = {
      id: 'story-ready',
      teamId: fixtureDocument.team.id,
      title: 'First story',
      description: '',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    let nextId = 0;
    const harness = createHarness(
      { ...fixtureDocument, stories: [story, { ...story, id: 'story-second', title: 'Second' }] },
      fixtureUser,
      undefined,
      () => `generated-${(nextId += 1)}`
    );
    const prepared = await harness.service.prepareSession(summary);
    const joined = await harness.service.joinSession(summary.teamId, prepared.getSession().id);
    await harness.service.startVoting(joined);
    await harness.service.selectStory(joined, story.id);
    const roundId = joined.getSession().activeRoundId as string;

    await expect(harness.service.castVote(joined, roundId, '100')).rejects.toMatchObject({
      code: 'invalid-vote'
    });
    await expect(harness.service.castVote(joined, 'stale-round', '3')).rejects.toMatchObject({
      code: 'invalid-round'
    });
    await harness.service.castVote(joined, roundId, '3');
    await expect(harness.service.replaceStory(joined, 'story-second')).rejects.toMatchObject({
      code: 'round-has-votes'
    });
  });

  it('keeps concurrent votes from two synchronized participant contexts', async () => {
    const story = {
      id: 'story-ready',
      title: 'Concurrent voting',
      description: '',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    let hostId = 0;
    const harness = createHarness(
      { ...fixtureDocument, stories: [story] },
      fixtureUser,
      undefined,
      () => `host-${(hostId += 1)}`
    );
    const guestService = new VotingSessionService(
      new TeamRepository(storage, harness.store),
      { objectId: 'guest-user', displayName: 'Guest', loginName: 'guest@example.com' },
      () => 'guest-participant',
      () => '2026-07-11T12:31:00.000Z'
    );
    const prepared = await harness.service.prepareSession(summary);
    const host = await harness.service.joinSession(summary.teamId, prepared.getSession().id);
    const guest = await guestService.joinSession(summary.teamId, prepared.getSession().id);
    await harness.service.startVoting(host);
    await harness.service.selectStory(host, story.id);
    const roundId = host.getSession().activeRoundId as string;

    await Promise.all([
      harness.service.castVote(host, roundId, '3'),
      guestService.castVote(guest, roundId, '5')
    ]);

    expect(host.getSession().rounds[0].votes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: host.participantId, value: '3' }),
        expect.objectContaining({ participantId: guest.participantId, value: '5' })
      ])
    );
  });

  it('filters voting eligibility by lifecycle and finalized session history', () => {
    const ready = {
      id: 'ready',
      teamId: fixtureDocument.team.id,
      title: 'Ready',
      description: '',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const finalizedRound = {
      id: 'round-final',
      storyId: 'finalized',
      storySnapshot: { storyId: 'finalized', title: 'Done', description: '' },
      status: 'Finalized' as const,
      votes: [],
      timer: { configuredDurationSeconds: 0, status: 'Ready' as const, remainingSeconds: 0 }
    };
    const activeSession = {
      id: 'session-active',
      teamId: fixtureDocument.team.id,
      status: 'Active' as const,
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [finalizedRound],
      finalizedRoundIds: [finalizedRound.id],
      createdAt: fixtureDocument.createdAt,
      updatedAt: fixtureDocument.updatedAt
    };
    const document = {
      ...fixtureDocument,
      stories: [
        ready,
        { ...ready, id: 'finalized' },
        { ...ready, id: 'pointed', status: 'Pointed' as const },
        { ...ready, id: 'archived', status: 'Archived' as const }
      ],
      sessions: [activeSession]
    };

    expect(selectEligibleVotingStories(document, activeSession).map((story) => story.id)).toEqual([
      'ready'
    ]);
  });

  it('rejects Lobby preparation when authoritative team state is inactive', async () => {
    const harness = createHarness({
      ...fixtureDocument,
      team: { ...fixtureDocument.team, isActive: false }
    });

    await expect(harness.service.prepareSession(summary)).rejects.toMatchObject({
      code: 'inactive-team'
    });
  });

  it('rejects a stale or mismatched session route explicitly', async () => {
    const harness = createHarness();

    await expect(
      harness.service.joinSession(fixtureDocument.team.id, 'missing')
    ).rejects.toMatchObject({
      code: 'invalid-session'
    });
  });

  it('reports an ended session explicitly even after its open pointer is cleared', async () => {
    const hostHarness = createHarness();
    const prepared = await hostHarness.service.prepareSession(summary);
    const endedDocument: PlanningPokerDocumentRoot = {
      ...hostHarness.getDocument(),
      sessions: [{ ...prepared.getSession(), status: 'Ended' }],
      openSessionId: undefined
    };
    const harness = createHarness(endedDocument);

    await expect(
      harness.service.joinSession(fixtureDocument.team.id, 'session-new')
    ).rejects.toMatchObject({ code: 'ended-session' });
  });

  it('clears browser-local anonymous reconnect state when an ended session is resolved', async () => {
    const values = new Map<string, string>();
    const storageKey = `planningPoker:anonymous:${fixtureDocument.team.id}:session-ended`;
    values.set(
      storageKey,
      JSON.stringify({ reconnectToken: 'local-token', participantId: 'anonymous-1' })
    );
    const browserStorage: IParticipantSessionStorage = {
      getItem: (key) => values.get(key),
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    };
    const endedSession = {
      id: 'session-ended',
      teamId: fixtureDocument.team.id,
      status: 'Ended' as const,
      settings: { ...fixtureDocument.team.settings, votingMode: 'Anonymous' as const },
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      updatedAt: fixtureDocument.updatedAt
    };
    const harness = createHarness(
      { ...fixtureDocument, sessions: [endedSession] },
      fixtureUser,
      browserStorage
    );

    await expect(
      harness.service.joinSession(fixtureDocument.team.id, endedSession.id)
    ).rejects.toMatchObject({ code: 'ended-session' });
    expect(values.has(storageKey)).toBe(false);
  });
});

describe('createSessionShareUrl', () => {
  it('preserves SharePoint parameters and writes only opaque focused identifiers', () => {
    const url = createSessionShareUrl(
      'https://example.sharepoint.com/sites/team/SitePages/Poker.aspx?source=home',
      'team_1',
      'session-2'
    );

    expect(url).toContain('source=home');
    expect(url).toContain('planningPokerView=Voting');
    expect(url).toContain('planningPokerTeam=team_1');
    expect(url).toContain('planningPokerSession=session-2');
    expect(url).not.toContain('Example+Team');
  });
});
