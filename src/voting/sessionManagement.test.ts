import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { PlanningPokerDocumentRoot, UserReference } from '../domain/planningPokerDomain';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
import { TeamRepository } from '../repository/teamRepository';
import type {
  HostedTeamSummary,
  ITeamDocumentStore,
  TeamDocumentHandle
} from '../repository/teamRepository';
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
  user: UserReference = fixtureUser
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
      () => 'session-new',
      () => '2026-07-11T12:30:00.000Z'
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
