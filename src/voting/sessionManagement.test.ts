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
import { createSessionShareUrl, VotingSessionService } from './sessionManagement';

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
