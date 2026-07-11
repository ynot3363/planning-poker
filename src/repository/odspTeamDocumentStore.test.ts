const mockCreateContainer = jest.fn();
const mockGetContainer = jest.fn();
const mockPresenceListeners = new Map<string, (value: unknown) => void>();
const mockPresenceBindings = new Map<object, unknown>();
const mockPresenceAttendees = new Set<object>();
jest.mock('@fluidframework/odsp-client/beta', () => ({
  OdspClient: class OdspClient {
    public createContainer(...args: unknown[]): Promise<unknown> {
      return mockCreateContainer(...args) as Promise<unknown>;
    }

    public getContainer(...args: unknown[]): Promise<unknown> {
      return mockGetContainer(...args) as Promise<unknown>;
    }
  }
}));
jest.mock('fluid-framework', () => ({
  getPresence: jest.fn(() => ({
    attendees: {
      getMyself: jest.fn(() => ({ getConnectionStatus: () => 'Connected' })),
      events: {
        on: jest.fn((eventName: string, listener: (value: unknown) => void) => {
          mockPresenceListeners.set(eventName, listener);
          return () => mockPresenceListeners.delete(eventName);
        })
      }
    },
    states: {
      getWorkspace: jest.fn(() => ({
        states: {
          participant: {
            local: { sessionId: '', participantId: '', mode: 'None' },
            events: {
              on: jest.fn((eventName: string, listener: (value: unknown) => void) => {
                mockPresenceListeners.set(eventName, listener);
                return () => mockPresenceListeners.delete(eventName);
              })
            },
            getRemote: jest.fn((attendee: object) => ({
              value: () => mockPresenceBindings.get(attendee)
            })),
            getStateAttendees: jest.fn(() => Array.from(mockPresenceAttendees))
          }
        }
      }))
    }
  }))
}));

import { Tree } from '@fluidframework/tree';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { PlanningPokerDocumentRoot, VotingSession } from '../domain/planningPokerDomain';
import type {
  IPlanningPokerStorageConfiguration,
  ISharePointTransport
} from '../storage/storageTypes';
import type { IPlanningPokerDriveService } from './graphDriveService';
import { OdspTeamDocumentStore, createOdspTokenProvider } from './odspTeamDocumentStore';

const storage: IPlanningPokerStorageConfiguration = {
  libraryTitle: 'PlanningPokerAppData',
  listId: 'list-id',
  driveId: 'drive-id',
  serverRelativeUrl: '/sites/team/PlanningPokerAppData',
  webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
  provisioningVersion: '1.0.0',
  schemaVersion: '1.0.0',
  fieldMap: {
    'Team ID': 'PlanningPokerTeamID',
    Hosts: 'PlanningPokerHosts',
    Participants: 'PlanningPokerParticipants',
    'Is Active': 'PlanningPokerIsActive',
    'Schema Version': 'PlanningPokerSchemaVersion',
    'Active Session ID': 'PlanningPokerActiveSessionID',
    'Last Activity': 'PlanningPokerLastActivity'
  },
  lastValidatedAt: '2026-07-10T00:00:00.000Z'
};

const tokenProvider = createOdspTokenProvider(storage.webAbsoluteUrl, async () => 'token');

function createDriveService(): jest.Mocked<IPlanningPokerDriveService> {
  return {
    listSiteDrives: jest.fn(async (_webAbsoluteUrl: string) => []),
    getDrive: jest.fn(async (driveId: string) => ({ id: driveId })),
    getByPath: jest.fn(async (_driveId: string, _fileName: string) => ({ id: 'drive-item-id' })),
    get: jest.fn(async (_driveId: string, _driveItemId: string) => ({
      sharepointIds: { listItemId: '12' }
    })),
    rename: jest.fn(async (_driveId: string, _driveItemId: string, _fileName: string) => undefined),
    recycle: jest.fn(async (_driveId: string, _driveItemId: string) => ({}))
  };
}

function createTransport(
  get: (path: string) => Promise<unknown>
): jest.Mocked<ISharePointTransport> {
  return {
    get: jest.fn(get) as ISharePointTransport['get'],
    post: jest.fn(async () => undefined) as ISharePointTransport['post'],
    patch: jest.fn(async () => undefined) as ISharePointTransport['patch']
  } as jest.Mocked<ISharePointTransport>;
}

describe('OdspTeamDocumentStore', () => {
  beforeEach(() => {
    mockPresenceListeners.clear();
    mockPresenceBindings.clear();
    mockPresenceAttendees.clear();
  });
  it('uses separate SharePoint and push-channel token audiences', async () => {
    const getToken = jest.fn(async () => 'aad-token');
    const provider = createOdspTokenProvider(storage.webAbsoluteUrl, getToken);

    await provider.fetchStorageToken(storage.webAbsoluteUrl, false);
    await provider.fetchWebsocketToken(storage.webAbsoluteUrl, true);

    expect(getToken).toHaveBeenNthCalledWith(1, 'https://example.sharepoint.com', false);
    expect(getToken).toHaveBeenNthCalledWith(2, 'https://pushchannel.1drv.ms', true);
  });

  it('filters hosted metadata by stable SharePoint user ID and resolves the drive item', async () => {
    const transport = createTransport(async (path) => {
      return {
        value: [
          {
            Id: 12,
            Title: 'Example Team',
            File: { Name: 'Example Team.fluid' },
            PlanningPokerTeamID: fixtureDocument.team.id,
            PlanningPokerIsActive: true,
            PlanningPokerHosts: [{ Id: 17 }],
            PlanningPokerParticipants: [{ Id: 18 }]
          },
          {
            Id: 13,
            Title: 'Other Team',
            File: { Name: 'Other Team.fluid' },
            PlanningPokerTeamID: 'other-team',
            PlanningPokerIsActive: true,
            PlanningPokerHosts: [{ Id: 99 }],
            PlanningPokerParticipants: [{ Id: 17 }]
          }
        ]
      };
    });
    const driveService = createDriveService();
    const store = new OdspTeamDocumentStore(storage, transport, driveService, tokenProvider);

    await expect(store.listHostedBy({ ...fixtureUser, sharePointUserId: 17 })).resolves.toEqual([
      {
        teamId: fixtureDocument.team.id,
        driveItemId: 'drive-item-id',
        title: 'Example Team',
        isActive: true
      }
    ]);
    expect(driveService.getByPath).toHaveBeenCalledWith('drive-id', 'Example Team.fluid');
    await expect(
      store.listParticipatingIn({ ...fixtureUser, sharePointUserId: 17 })
    ).resolves.toEqual([expect.objectContaining({ teamId: 'other-team', title: 'Other Team' })]);
  });

  it('projects resolved people and discovery fields to the SharePoint list item', async () => {
    const transport = createTransport(async () => ({
      value: [
        {
          Id: 12,
          Title: 'Example Team',
          File: { Name: 'Example Team.fluid' },
          PlanningPokerTeamID: fixtureDocument.team.id,
          PlanningPokerIsActive: true,
          PlanningPokerHosts: [{ Id: 17 }]
        }
      ]
    }));
    const store = new OdspTeamDocumentStore(
      storage,
      transport,
      createDriveService(),
      tokenProvider
    );
    const document = {
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        hosts: [{ ...fixtureUser, sharePointUserId: 17 }],
        configuredMembers: [{ ...fixtureUser, objectId: 'member', sharePointUserId: 18 }]
      }
    };

    await store.updateMetadata(document);

    expect(transport.patch).toHaveBeenCalledWith(
      expect.stringContaining('/items(12)'),
      expect.objectContaining({
        Title: 'Example Team',
        PlanningPokerTeamID: fixtureDocument.team.id,
        PlanningPokerHostsId: [17],
        PlanningPokerParticipantsId: [18],
        PlanningPokerIsActive: true,
        PlanningPokerSchemaVersion: '1.0.0',
        PlanningPokerLastActivity: fixtureDocument.updatedAt
      })
    );
  });

  it('creates, snapshots, acknowledges, renames, and disposes an attached document', async () => {
    let root: unknown;
    const view = {
      compatibility: { canInitialize: true, canView: true },
      get root(): unknown {
        return root;
      },
      set root(value: unknown) {
        root = value;
      },
      initialize: jest.fn((value: unknown) => {
        root = value;
      }),
      dispose: jest.fn()
    };
    const container = {
      initialObjects: { appTree: { viewWith: jest.fn(() => view) } },
      attach: jest.fn(async () => 'attached-item-id'),
      isDirty: false,
      connect: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      dispose: jest.fn()
    };
    const services = { dispose: jest.fn() };
    mockCreateContainer.mockResolvedValueOnce({ container, services });
    const transport = createTransport(async () => ({ value: [] }));
    const driveService = createDriveService();
    const store = new OdspTeamDocumentStore(storage, transport, driveService, tokenProvider);

    const handle = await store.create(fixtureDocument.team, 'Example Team.fluid');

    expect(handle.getSnapshot()).toEqual(fixtureDocument);
    const lobby: VotingSession = {
      id: 'session-1',
      teamId: fixtureDocument.team.id,
      status: 'Lobby',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const runTransaction = jest
      .spyOn(Tree, 'runTransaction')
      .mockImplementation((treeView, change) => {
        change((treeView as unknown as { root: unknown }).root as never);
        return undefined as never;
      });
    handle.prepareVotingSession(lobby, fixtureDocument.updatedAt);
    const sessionsBeforeJoin = (root as PlanningPokerDocumentRoot).sessions;
    expect(
      handle.joinVotingSession(
        lobby.id,
        { kind: 'Named', participantId: 'participant-1', user: fixtureUser },
        fixtureDocument.updatedAt
      )
    ).toMatchObject({ id: 'participant-1', kind: 'Named' });
    expect((root as PlanningPokerDocumentRoot).sessions).toBe(sessionsBeforeJoin);
    expect(handle.getSnapshot().sessions[0].participants).toHaveLength(1);
    const readyStory = {
      id: 'story-1',
      teamId: fixtureDocument.team.id,
      title: 'Transactional story',
      description: 'A synchronized round.',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    handle.updateStories(
      [readyStory, { ...readyStory, id: 'story-2', title: 'Replacement story' }],
      fixtureDocument.updatedAt
    );
    handle.updateSessions(
      [{ ...handle.getSnapshot().sessions[0], status: 'Active' }],
      lobby.id,
      fixtureDocument.updatedAt
    );
    expect(
      handle.selectVotingStory(
        lobby.id,
        readyStory.id,
        'round-1',
        fixtureUser,
        false,
        fixtureDocument.updatedAt
      )
    ).toBe('selected');
    expect(
      handle.selectVotingStory(
        lobby.id,
        'story-2',
        'round-2',
        fixtureUser,
        true,
        fixtureDocument.updatedAt
      )
    ).toBe('selected');
    expect(handle.getSnapshot().sessions[0].rounds[0].status).toBe('Cancelled');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        participantId: 'participant-1',
        value: '3',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('cast');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        participantId: 'participant-1',
        value: '5',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('cast');
    expect(handle.getSnapshot().sessions[0].rounds[1].votes).toEqual([
      expect.objectContaining({ participantId: 'participant-1', value: '5' })
    ]);
    expect(
      handle.castVotingVote(lobby.id, 'round-1', {
        participantId: 'participant-1',
        value: '8',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('invalid-round');
    expect(
      handle.updateVotingTimer(
        lobby.id,
        'round-2',
        'start',
        fixtureUser,
        '2026-07-10T00:01:00.000Z'
      )
    ).toBe('updated');
    expect(handle.getSnapshot().sessions[0].rounds[1].timer.status).toBe('Running');
    expect(
      handle.updateVotingTimer(lobby.id, 'round-2', 'stop', fixtureUser, '2026-07-10T00:01:30.000Z')
    ).toBe('updated');
    expect(handle.getSnapshot().sessions[0].rounds[1].timer).toMatchObject({
      status: 'Stopped',
      remainingSeconds: 270
    });
    const currentSession = handle.getSnapshot().sessions[0];
    handle.updateSessions(
      [
        {
          ...currentSession,
          settings: { ...currentSession.settings, votingMode: 'Anonymous' },
          participants: [
            {
              kind: 'Anonymous',
              id: 'anonymous-presence',
              alias: 'Participant 1',
              joinedAt: fixtureDocument.createdAt,
              presence: {
                connection: 'Connected',
                lastSeenAt: fixtureDocument.updatedAt
              }
            }
          ],
          rounds: currentSession.rounds.map((round) =>
            round.id === currentSession.activeRoundId
              ? {
                  ...round,
                  votes: [
                    {
                      participantId: 'anonymous-presence',
                      value: '5',
                      castAt: fixtureDocument.updatedAt
                    }
                  ]
                }
              : round
          )
        }
      ],
      lobby.id,
      fixtureDocument.updatedAt
    );
    const treeOn = jest.spyOn(Tree, 'on').mockReturnValue(jest.fn());
    const unsubscribePresence = handle.subscribe(jest.fn());
    const disconnectedAttendee = {
      getConnectionStatus: () => 'Disconnected',
      getConnectionId: () => 'connection-1',
      attendeeId: 'attendee-1'
    };
    mockPresenceBindings.set(disconnectedAttendee, {
      sessionId: lobby.id,
      participantId: 'anonymous-presence',
      mode: 'Anonymous'
    });
    mockPresenceAttendees.add(disconnectedAttendee);

    mockPresenceListeners.get('attendeeDisconnected')?.(disconnectedAttendee);

    expect(handle.getSnapshot().sessions[0].participants).toHaveLength(0);
    expect(handle.getSnapshot().sessions[0].rounds[1].votes).toHaveLength(0);
    const anonymousRemovedSession = handle.getSnapshot().sessions[0];
    handle.updateSessions(
      [
        {
          ...anonymousRemovedSession,
          settings: { ...anonymousRemovedSession.settings, votingMode: 'Named' },
          participants: [
            {
              kind: 'Named',
              id: 'named-presence',
              user: fixtureUser,
              joinedAt: fixtureDocument.createdAt,
              presence: {
                connection: 'Connected',
                lastSeenAt: fixtureDocument.updatedAt
              }
            }
          ]
        }
      ],
      lobby.id,
      fixtureDocument.updatedAt
    );
    const disconnectedNamedAttendee = {
      getConnectionStatus: () => 'Disconnected',
      getConnectionId: () => 'connection-2',
      attendeeId: 'attendee-2'
    };
    mockPresenceBindings.set(disconnectedNamedAttendee, {
      sessionId: lobby.id,
      participantId: 'named-presence',
      mode: 'Named'
    });
    mockPresenceAttendees.add(disconnectedNamedAttendee);

    mockPresenceListeners.get('remoteUpdated')?.({
      attendee: disconnectedNamedAttendee,
      value: () => mockPresenceBindings.get(disconnectedNamedAttendee)
    });
    mockPresenceBindings.delete(disconnectedNamedAttendee);

    mockPresenceListeners.get('attendeeDisconnected')?.(disconnectedNamedAttendee);

    expect(handle.getSnapshot().sessions[0].participants).toEqual([
      expect.objectContaining({
        id: 'named-presence',
        presence: expect.objectContaining({ connection: 'Disconnected' })
      })
    ]);
    unsubscribePresence();
    treeOn.mockRestore();
    runTransaction.mockRestore();
    await expect(handle.waitForSaved()).resolves.toBeUndefined();
    await store.updateMetadata({
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        hosts: [{ ...fixtureUser, sharePointUserId: 17 }]
      }
    });
    expect(driveService.get).toHaveBeenCalledWith('drive-id', 'attached-item-id');
    expect(transport.patch).toHaveBeenCalledWith(
      expect.stringContaining('/items(12)'),
      expect.objectContaining({
        PlanningPokerTeamID: fixtureDocument.team.id,
        PlanningPokerHostsId: [17]
      })
    );
    await store.rename(fixtureDocument.team.id, 'Renamed Team');
    expect(driveService.rename).toHaveBeenCalledWith(
      'drive-id',
      'attached-item-id',
      'Renamed Team.fluid'
    );
    await expect(store.recycle('attached-item-id')).resolves.toEqual({});
    expect(driveService.recycle).toHaveBeenCalledWith('drive-id', 'attached-item-id');
    handle.dispose();
    handle.dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(services.dispose).toHaveBeenCalledTimes(1);
    expect(container.dispose).toHaveBeenCalledTimes(1);
  });

  it('waits for a loaded container to catch up before reading session state', async () => {
    const openSession = {
      id: 'session-current',
      teamId: fixtureDocument.team.id,
      status: 'Lobby' as const,
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    let root: unknown = fixtureDocument;
    let connectionState = 1;
    let canView = false;
    const view = {
      get compatibility(): { canInitialize: boolean; canView: boolean; canUpgrade: boolean } {
        return { canInitialize: false, canView, canUpgrade: true };
      },
      get root(): unknown {
        return root;
      },
      initialize: jest.fn(),
      upgradeSchema: jest.fn(() => {
        canView = true;
      }),
      dispose: jest.fn()
    };
    const listeners = new Map<string, () => void>();
    const container = {
      initialObjects: { appTree: { viewWith: jest.fn(() => view) } },
      get connectionState(): number {
        return connectionState;
      },
      isDirty: false,
      connect: jest.fn(),
      on: jest.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
      off: jest.fn((event: string) => {
        listeners.delete(event);
      }),
      dispose: jest.fn()
    };
    const services = { dispose: jest.fn() };
    mockGetContainer.mockResolvedValueOnce({ container, services });
    const store = new OdspTeamDocumentStore(
      storage,
      createTransport(async () => ({ value: [] })),
      createDriveService(),
      tokenProvider
    );
    const loading = store.load('drive-item-id');
    await Promise.resolve();
    root = {
      ...fixtureDocument,
      sessions: [openSession],
      openSessionId: openSession.id
    };
    connectionState = 2;
    listeners.get('connected')?.();

    const handle = await loading;

    expect(handle.getSnapshot()).toMatchObject({
      openSessionId: openSession.id,
      sessions: [expect.objectContaining({ id: openSession.id })]
    });
    expect(container.off).toHaveBeenCalledWith('connected', expect.any(Function));
    expect(view.upgradeSchema).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it('normalizes recycle access denial and unknown failures', async () => {
    const transport = createTransport(async () => ({ value: [] }));
    const driveService = createDriveService();
    const store = new OdspTeamDocumentStore(storage, transport, driveService, tokenProvider);
    driveService.recycle.mockRejectedValueOnce({ statusCode: 403 });

    await expect(store.recycle('item-id')).rejects.toMatchObject({ code: 'access-denied' });

    driveService.recycle.mockRejectedValueOnce(new Error('sensitive Graph failure'));
    await expect(store.recycle('item-id')).rejects.toMatchObject({ code: 'recycle-failure' });
  });
});
