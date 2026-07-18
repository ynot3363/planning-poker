const mockCreateContainer = jest.fn();
const mockGetContainer = jest.fn();
const mockPresenceListeners = new Map<string, (value: unknown) => void>();
const mockPresenceBindings = new Map<object, unknown>();
const mockPresenceAttendees = new Set<object>();
let mockLocalPresenceBinding: {
  sessionId: string;
  participantId: string;
  mode: 'Named' | 'Anonymous' | 'None';
} = { sessionId: '', participantId: '', mode: 'None' };
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
            get local(): typeof mockLocalPresenceBinding {
              return mockLocalPresenceBinding;
            },
            set local(value: typeof mockLocalPresenceBinding) {
              mockLocalPresenceBinding = value;
            },
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

import { SchemaFactory, Tree, TreeViewConfiguration } from '@fluidframework/tree';
import { createIndependentTreeBeta } from '@fluidframework/tree/beta';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { PlanningPokerDocumentRoot, VotingSession } from '../domain/planningPokerDomain';
import { validateDocumentInvariants } from '../domain/planningPokerValidation';
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
const legacyFactory = new SchemaFactory('planning-poker');
const legacyStringList = legacyFactory.array(legacyFactory.string);
const LegacyUserReferenceSchema = legacyFactory.object('UserReference', {
  objectId: legacyFactory.string,
  displayName: legacyFactory.string,
  loginName: legacyFactory.string,
  sharePointUserId: legacyFactory.optional(legacyFactory.number)
});
const LegacyTeamSettingsSchema = legacyFactory.object('TeamSettings', {
  scaleKind: legacyFactory.string,
  scaleValues: legacyStringList,
  timerEnabled: legacyFactory.boolean,
  timerDurationSeconds: legacyFactory.optional(legacyFactory.number),
  votingMode: legacyFactory.string
});
const LegacyTeamSchema = legacyFactory.object('PlanningPokerTeam', {
  id: legacyFactory.string,
  title: legacyFactory.string,
  description: legacyFactory.string,
  isActive: legacyFactory.boolean,
  hosts: legacyFactory.array(LegacyUserReferenceSchema),
  configuredMembers: legacyFactory.array(LegacyUserReferenceSchema),
  settings: LegacyTeamSettingsSchema,
  createdAt: legacyFactory.string,
  createdBy: LegacyUserReferenceSchema,
  updatedAt: legacyFactory.string,
  updatedBy: LegacyUserReferenceSchema
});
const LegacyEstimateHistoryEntrySchema = legacyFactory.object('EstimateHistoryEntry', {
  sessionId: legacyFactory.string,
  roundId: legacyFactory.string,
  value: legacyFactory.string,
  finalizedAt: legacyFactory.string,
  finalizedBy: LegacyUserReferenceSchema
});
const LegacyStorySchema = legacyFactory.object('PointingStory', {
  id: legacyFactory.string,
  title: legacyFactory.string,
  description: legacyFactory.string,
  link: legacyFactory.optional(legacyFactory.string),
  status: legacyFactory.string,
  currentEstimate: legacyFactory.optional(legacyFactory.string),
  estimateHistory: legacyFactory.array(LegacyEstimateHistoryEntrySchema),
  createdAt: legacyFactory.string,
  createdBy: LegacyUserReferenceSchema,
  updatedAt: legacyFactory.string,
  updatedBy: LegacyUserReferenceSchema
});
const LegacyPresenceSchema = legacyFactory.object('ParticipantPresence', {
  connection: legacyFactory.string,
  lastSeenAt: legacyFactory.string
});
const LegacyNamedParticipantSchema = legacyFactory.object('NamedSessionParticipant', {
  kind: legacyFactory.string,
  id: legacyFactory.string,
  user: LegacyUserReferenceSchema,
  joinedAt: legacyFactory.string,
  presence: LegacyPresenceSchema
});
const LegacyAnonymousParticipantSchema = legacyFactory.object('AnonymousSessionParticipant', {
  kind: legacyFactory.string,
  id: legacyFactory.string,
  alias: legacyFactory.string,
  joinedAt: legacyFactory.string,
  presence: LegacyPresenceSchema
});
const LegacyStorySnapshotSchema = legacyFactory.object('StorySnapshot', {
  storyId: legacyFactory.string,
  title: legacyFactory.string,
  description: legacyFactory.string,
  link: legacyFactory.optional(legacyFactory.string)
});
const LegacyVoteSchema = legacyFactory.object('VoteRecord', {
  participantId: legacyFactory.string,
  value: legacyFactory.string,
  castAt: legacyFactory.string
});
const LegacyTimerSchema = legacyFactory.object('VotingTimer', {
  configuredDurationSeconds: legacyFactory.number,
  status: legacyFactory.string,
  remainingSeconds: legacyFactory.number,
  startedAt: legacyFactory.optional(legacyFactory.string),
  stoppedAt: legacyFactory.optional(legacyFactory.string),
  resetAt: legacyFactory.optional(legacyFactory.string)
});
const LegacyRoundSchema = legacyFactory.object('StoryVotingRound', {
  id: legacyFactory.string,
  storyId: legacyFactory.string,
  storySnapshot: LegacyStorySnapshotSchema,
  status: legacyFactory.string,
  votes: legacyFactory.array(LegacyVoteSchema),
  timer: LegacyTimerSchema,
  revealedAt: legacyFactory.optional(legacyFactory.string),
  revealedBy: legacyFactory.optional(LegacyUserReferenceSchema),
  assignedValue: legacyFactory.optional(legacyFactory.string),
  finalizedAt: legacyFactory.optional(legacyFactory.string),
  finalizedBy: legacyFactory.optional(LegacyUserReferenceSchema)
});
const LegacySessionSchema = legacyFactory.object('VotingSession', {
  id: legacyFactory.string,
  teamId: legacyFactory.string,
  status: legacyFactory.string,
  settings: LegacyTeamSettingsSchema,
  participants: legacyFactory.array([
    LegacyNamedParticipantSchema,
    LegacyAnonymousParticipantSchema
  ]),
  rounds: legacyFactory.array(LegacyRoundSchema),
  activeRoundId: legacyFactory.optional(legacyFactory.string),
  finalizedRoundIds: legacyStringList,
  endedAt: legacyFactory.optional(legacyFactory.string),
  endedBy: legacyFactory.optional(LegacyUserReferenceSchema),
  createdAt: legacyFactory.string,
  createdBy: legacyFactory.optional(LegacyUserReferenceSchema),
  updatedAt: legacyFactory.string,
  updatedBy: legacyFactory.optional(LegacyUserReferenceSchema)
});
const LegacyDocumentSchema = legacyFactory.object('PlanningPokerDocumentRoot', {
  schemaVersion: legacyFactory.string,
  team: LegacyTeamSchema,
  stories: legacyFactory.array(LegacyStorySchema),
  sessions: legacyFactory.array(LegacySessionSchema),
  openSessionId: legacyFactory.optional(legacyFactory.string),
  createdAt: legacyFactory.string,
  updatedAt: legacyFactory.string
});

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
    mockLocalPresenceBinding = { sessionId: '', participantId: '', mode: 'None' };
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
        PlanningPokerSchemaVersion: '1.1.0',
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
    const setTestSessions = (
      sessions: readonly VotingSession[],
      openSessionId: string | undefined,
      updatedAt: string
    ): void => {
      const document = root as {
        sessions: readonly VotingSession[];
        openSessionId?: string;
        updatedAt: string;
      };
      document.sessions = sessions;
      document.openSessionId = openSessionId;
      document.updatedAt = updatedAt;
    };
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
    expect(
      handle.joinVotingSession(
        lobby.id,
        {
          kind: 'Named',
          participantId: 'participant-2',
          user: {
            ...fixtureUser,
            objectId: '00000000-0000-0000-0000-000000000002',
            displayName: 'Second Voter',
            loginName: 'second@example.com'
          }
        },
        fixtureDocument.updatedAt
      )
    ).toMatchObject({ id: 'participant-2', kind: 'Named' });
    expect(
      handle.setVotingParticipantConnection(
        lobby.id,
        'participant-2',
        'Disconnected',
        '2026-07-10T00:00:10.000Z'
      )
    ).toBe('updated');
    expect(
      handle.setVotingParticipantConnection(
        lobby.id,
        'participant-2',
        'Disconnected',
        '2026-07-10T00:00:11.000Z'
      )
    ).toBe('unchanged');
    expect(
      handle.setVotingParticipantConnection(
        lobby.id,
        'participant-2',
        'Connected',
        '2026-07-10T00:00:12.000Z'
      )
    ).toBe('updated');
    expect(
      handle.setVotingParticipantConnection(
        'stale-session',
        'participant-2',
        'Disconnected',
        '2026-07-10T00:00:13.000Z'
      )
    ).toBe('invalid-session');
    const openLobbySnapshot = handle.getSnapshot().sessions[0];
    setTestSessions(
      [openLobbySnapshot, { ...openLobbySnapshot, id: 'non-open-lobby' }],
      lobby.id,
      fixtureDocument.updatedAt
    );
    expect(
      handle.setVotingParticipantConnection(
        'non-open-lobby',
        'participant-2',
        'Disconnected',
        '2026-07-10T00:00:14.000Z'
      )
    ).toBe('invalid-session');
    setTestSessions([openLobbySnapshot], lobby.id, fixtureDocument.updatedAt);
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
    expect(
      handle.importStories({
        stories: [readyStory, { ...readyStory, id: 'story-2', title: 'Replacement story' }],
        currentUser: fixtureUser,
        updatedAt: fixtureDocument.updatedAt
      })
    ).toEqual({ status: 'applied' });
    expect(handle.startVotingSession(lobby.id, fixtureUser, fixtureDocument.updatedAt)).toEqual({
      status: 'applied'
    });
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
        operationId: 'vote-1',
        participantId: 'participant-1',
        value: '3',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('cast');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'vote-1',
        participantId: 'participant-1',
        value: '3',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('already-cast');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'vote-1',
        participantId: 'participant-1',
        value: '5',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('reconciled-conflict');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'vote-2',
        supersedesOperationId: 'vote-1',
        participantId: 'participant-1',
        value: '5',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('cast');
    expect(handle.getSnapshot().sessions[0].rounds[1].votes).toEqual([
      expect.objectContaining({ participantId: 'participant-1', value: '5' })
    ]);
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'vote-stale-parent',
        supersedesOperationId: 'vote-1',
        participantId: 'participant-1',
        value: '8',
        castAt: fixtureDocument.updatedAt
      })
    ).toBe('reconciled-conflict');
    expect(
      handle.castVotingVote(lobby.id, 'round-1', {
        operationId: 'vote-invalid-round',
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
      handle.updateVotingTimer(
        lobby.id,
        'round-2',
        'start',
        fixtureUser,
        '2026-07-10T00:01:05.000Z'
      )
    ).toBe('invalid-command');
    expect(
      handle.revealVotingRound(
        lobby.id,
        'round-2',
        {
          ...fixtureUser,
          objectId: 'not-a-host',
          displayName: 'Participant User',
          loginName: 'participant@example.com'
        },
        '2026-07-10T00:01:54.000Z'
      )
    ).toBe('host-required');
    expect(
      handle.updateVotingTimer(lobby.id, 'round-2', 'stop', fixtureUser, '2026-07-10T00:01:30.000Z')
    ).toBe('updated');
    expect(handle.getSnapshot().sessions[0].rounds[1].timer).toMatchObject({
      status: 'Stopped',
      remainingSeconds: 270
    });
    expect(
      handle.updateVotingTimer(lobby.id, 'round-2', 'stop', fixtureUser, '2026-07-10T00:01:31.000Z')
    ).toBe('invalid-command');
    expect(
      handle.updateVotingTimer(
        lobby.id,
        'round-2',
        'start',
        fixtureUser,
        '2026-07-10T00:01:40.000Z'
      )
    ).toBe('updated');
    expect(handle.getSnapshot().sessions[0].rounds[1].timer).toMatchObject({
      status: 'Running',
      remainingSeconds: 270,
      startedAt: '2026-07-10T00:01:40.000Z'
    });
    expect(
      handle.updateVotingTimer(lobby.id, 'round-2', 'stop', fixtureUser, '2026-07-10T00:01:50.000Z')
    ).toBe('updated');
    expect(handle.getSnapshot().sessions[0].rounds[1].timer).toMatchObject({
      status: 'Stopped',
      remainingSeconds: 260
    });
    expect(
      handle.updateVotingTimer(
        lobby.id,
        'round-2',
        'reset',
        fixtureUser,
        '2026-07-10T00:01:52.000Z'
      )
    ).toBe('updated');
    expect(
      handle.updateVotingTimer(
        lobby.id,
        'round-2',
        'reset',
        fixtureUser,
        '2026-07-10T00:01:53.000Z'
      )
    ).toBe('invalid-command');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'vote-participant-2',
        participantId: 'participant-2',
        value: '3',
        castAt: '2026-07-10T00:02:00.000Z'
      })
    ).toBe('cast');
    expect(handle.getSnapshot().sessions[0].rounds[1]).toMatchObject({
      status: 'Revealed',
      revealReason: 'Automatic',
      revealedVotedCount: 2,
      revealedMissingCount: 0,
      timer: { status: 'Stopped' }
    });
    expect(
      handle.joinVotingSession(
        lobby.id,
        {
          kind: 'Named',
          participantId: 'participant-late',
          user: {
            ...fixtureUser,
            objectId: '00000000-0000-0000-0000-000000000003',
            displayName: 'Late Participant',
            loginName: 'late@example.com'
          }
        },
        '2026-07-10T00:02:00.250Z'
      )
    ).toMatchObject({ id: 'participant-late' });
    expect(handle.getSnapshot().sessions[0].rounds[1].status).toBe('Revealed');
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'vote-after-reveal',
        participantId: 'participant-late',
        value: '8',
        castAt: '2026-07-10T00:02:00.500Z'
      })
    ).toBe('invalid-round');
    expect(
      handle.revealVotingRound(lobby.id, 'round-2', fixtureUser, '2026-07-10T00:02:01.000Z')
    ).toBe('already-revealed');
    expect(
      handle.finalizeVotingRound(
        lobby.id,
        'round-2',
        '100',
        fixtureUser,
        '2026-07-10T00:02:02.000Z',
        'finalize-invalid'
      )
    ).toBe('invalid-estimate');
    expect(
      handle.finalizeVotingRound(
        lobby.id,
        'round-2',
        '5',
        fixtureUser,
        '2026-07-10T00:02:03.000Z',
        'finalize-1'
      )
    ).toBe('finalized');
    expect(handle.getSnapshot().stories[1]).toMatchObject({
      status: 'Pointed',
      currentEstimate: '5',
      estimateHistory: [expect.objectContaining({ sessionId: lobby.id, roundId: 'round-2' })]
    });
    expect(
      handle.finalizeVotingRound(
        lobby.id,
        'round-2',
        '5',
        fixtureUser,
        '2026-07-10T00:02:04.000Z',
        'finalize-1'
      )
    ).toBe('already-finalized');
    const finalizedSession = handle.getSnapshot().sessions[0];
    setTestSessions(
      [
        {
          ...finalizedSession,
          activeRoundId: 'round-2',
          finalizedRoundIds: [],
          rounds: finalizedSession.rounds.map((round) =>
            round.id === 'round-2' ? { ...round, status: 'Voting' as const } : round
          )
        }
      ],
      lobby.id,
      '2026-07-10T00:02:05.000Z'
    );
    const currentSession = handle.getSnapshot().sessions[0];
    setTestSessions(
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
    expect(handle.getSnapshot().sessions[0].rounds[1].status).toBe('Voting');
    const anonymousRemovedSession = handle.getSnapshot().sessions[0];
    setTestSessions(
      [
        {
          ...anonymousRemovedSession,
          settings: { ...anonymousRemovedSession.settings, votingMode: 'Named' },
          participants: [
            {
              kind: 'Named',
              id: 'named-voter',
              user: { ...fixtureUser, objectId: 'named-voter-user' },
              joinedAt: fixtureDocument.createdAt,
              presence: {
                connection: 'Connected',
                lastSeenAt: fixtureDocument.updatedAt
              }
            },
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
          ],
          rounds: anonymousRemovedSession.rounds.map((round) =>
            round.id === anonymousRemovedSession.activeRoundId
              ? {
                  ...round,
                  votes: [
                    {
                      operationId: 'named-voter-vote',
                      participantId: 'named-voter',
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

    expect(handle.getSnapshot().sessions[0].participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'named-voter' }),
        expect.objectContaining({
          id: 'named-presence',
          presence: expect.objectContaining({ connection: 'Disconnected' })
        })
      ])
    );
    expect(handle.getSnapshot().sessions[0].rounds[1]).toMatchObject({
      status: 'Revealed',
      revealReason: 'Automatic',
      revealedVotedCount: 1,
      revealedMissingCount: 0
    });
    expect(handle.getSnapshot().sessions[0].rounds[1].revealedBy).toBeUndefined();
    expect(
      handle.endVotingSession(
        lobby.id,
        { ...fixtureUser, objectId: 'not-host' },
        '2026-07-10T00:03:00.000Z'
      )
    ).toBe('host-required');
    expect(handle.endVotingSession(lobby.id, fixtureUser, '2026-07-10T00:03:00.000Z')).toBe(
      'ended'
    );
    expect(mockLocalPresenceBinding).toEqual({ sessionId: '', participantId: '', mode: 'None' });
    const endedSnapshot = handle.getSnapshot();
    expect(endedSnapshot.openSessionId).toBeUndefined();
    expect(endedSnapshot.sessions[0]).toMatchObject({
      status: 'Ended',
      endedAt: '2026-07-10T00:03:00.000Z'
    });
    expect(endedSnapshot.sessions[0].activeRoundId).toBeUndefined();
    expect(endedSnapshot.sessions[0].rounds).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'round-2', status: 'Cancelled' })])
    );
    mockLocalPresenceBinding = {
      sessionId: lobby.id,
      participantId: 'named-voter',
      mode: 'Named'
    };
    expect(handle.endVotingSession(lobby.id, fixtureUser, '2026-07-10T00:03:01.000Z')).toBe(
      'already-ended'
    );
    expect(mockLocalPresenceBinding).toEqual({ sessionId: '', participantId: '', mode: 'None' });
    expect(
      handle.setVotingParticipantConnection(
        lobby.id,
        'named-voter',
        'Disconnected',
        '2026-07-10T00:03:02.000Z'
      )
    ).toBe('session-ended');
    expect(
      handle.joinVotingSession(
        lobby.id,
        { kind: 'Named', participantId: 'post-end', user: fixtureUser },
        '2026-07-10T00:03:02.000Z'
      )
    ).toBeUndefined();
    expect(
      handle.castVotingVote(lobby.id, 'round-2', {
        operationId: 'post-end-vote',
        participantId: 'named-voter',
        value: '5',
        castAt: '2026-07-10T00:03:02.000Z'
      })
    ).toBe('invalid-session');
    expect(
      handle.selectVotingStory(
        lobby.id,
        'story-2',
        'post-end-round',
        fixtureUser,
        false,
        '2026-07-10T00:03:02.000Z'
      )
    ).toBe('invalid-session');
    expect(
      handle.finalizeVotingRound(
        lobby.id,
        'round-2',
        '8',
        fixtureUser,
        '2026-07-10T00:03:02.500Z',
        'post-end-correction',
        'post-end-finalize'
      )
    ).toBe('invalid-session');
    expect(
      handle.updateVotingTimer(
        lobby.id,
        'round-2',
        'start',
        fixtureUser,
        '2026-07-10T00:03:02.000Z'
      )
    ).toBe('invalid-session');
    expect(
      handle.revealVotingRound(lobby.id, 'round-2', fixtureUser, '2026-07-10T00:03:02.000Z')
    ).toBe('invalid-session');
    expect(
      handle.undoVotingRoundReveal(lobby.id, 'round-2', fixtureUser, '2026-07-10T00:03:02.000Z')
    ).toBe('invalid-session');
    expect(
      handle.finalizeVotingRound(
        lobby.id,
        'round-2',
        '5',
        fixtureUser,
        '2026-07-10T00:03:02.000Z',
        'post-end-finalize'
      )
    ).toBe('invalid-session');
    mockPresenceBindings.set(disconnectedNamedAttendee, {
      sessionId: lobby.id,
      participantId: 'named-presence',
      mode: 'Named'
    });
    mockPresenceListeners.get('remoteUpdated')?.({
      attendee: disconnectedNamedAttendee,
      value: () => mockPresenceBindings.get(disconnectedNamedAttendee)
    });
    mockPresenceBindings.delete(disconnectedNamedAttendee);
    mockPresenceListeners.get('attendeeDisconnected')?.(disconnectedNamedAttendee);
    expect(handle.getSnapshot()).toEqual(endedSnapshot);
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

  it('waits for a loaded container and applies a writable schema upgrade before reading state', async () => {
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
    let canView = true;
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

  it('upgrades and reveals a voting round created with the pre-results SharedTree schema', async () => {
    const timestamp = '2026-07-10T00:02:00.000Z';
    const story = {
      id: 'story-1',
      teamId: fixtureDocument.team.id,
      title: 'Real tree story',
      description: 'Exercises Fluid mutation validation.',
      status: 'Ready' as const,
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const secondStory = { ...story, id: 'story-2', title: 'Second real tree story' };
    const session: VotingSession = {
      id: 'session-1',
      teamId: fixtureDocument.team.id,
      status: 'Active',
      settings: fixtureDocument.team.settings,
      participants: [
        {
          kind: 'Named',
          id: 'participant-1',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.createdAt }
        },
        {
          kind: 'Named',
          id: 'participant-2',
          user: {
            ...fixtureUser,
            objectId: '00000000-0000-0000-0000-000000000002',
            displayName: 'Second Voter',
            loginName: 'second@example.com'
          },
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Disconnected', lastSeenAt: fixtureDocument.createdAt }
        }
      ],
      rounds: [
        {
          id: 'round-1',
          storyId: story.id,
          storySnapshot: {
            storyId: story.id,
            title: story.title,
            description: story.description
          },
          status: 'Voting',
          votes: [],
          timer: {
            configuredDurationSeconds: 300,
            status: 'Stopped',
            remainingSeconds: 120,
            stoppedAt: '2026-07-10T00:01:30.000Z'
          }
        }
      ],
      activeRoundId: 'round-1',
      finalizedRoundIds: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const tree = createIndependentTreeBeta();
    const legacyView = tree.viewWith(
      new TreeViewConfiguration({
        schema: LegacyDocumentSchema,
        enableSchemaValidation: true
      })
    );
    legacyView.initialize({
      ...fixtureDocument,
      schemaVersion: '1.0.0',
      stories: [story, secondStory],
      sessions: [session],
      openSessionId: session.id
    } as never);
    legacyView.dispose();
    const container = {
      initialObjects: {
        appTree: {
          viewWith: jest.fn((configuration: Parameters<typeof tree.viewWith>[0]) =>
            tree.viewWith(configuration)
          )
        }
      },
      connectionState: 2,
      isDirty: false,
      connect: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
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

    const handle = await store.load('drive-item-id');
    expect(handle.getSnapshot().schemaVersion).toBe('1.1.0');
    const connectedSecondAttendee = { getConnectionStatus: () => 'Connected' };
    mockPresenceAttendees.add(connectedSecondAttendee);
    mockPresenceBindings.set(connectedSecondAttendee, {
      sessionId: session.id,
      participantId: 'participant-2',
      mode: 'Named'
    });
    expect(
      handle.joinVotingSession(
        session.id,
        { kind: 'Named', participantId: 'unused-rejoin-id', user: fixtureUser },
        timestamp
      )
    ).toMatchObject({ id: 'participant-1' });

    expect(handle.revealVotingRound(session.id, 'round-1', fixtureUser, timestamp)).toBe(
      'revealed'
    );
    expect(handle.getSnapshot().sessions[0].rounds[0]).toMatchObject({
      status: 'Revealed',
      revealedAt: timestamp,
      revealedBy: fixtureUser,
      revealReason: 'Manual',
      revealedVotedCount: 0,
      revealedMissingCount: 2,
      timer: {
        configuredDurationSeconds: 300,
        status: 'Stopped',
        remainingSeconds: 120,
        stoppedAt: '2026-07-10T00:01:30.000Z'
      }
    });
    expect(
      handle.undoVotingRoundReveal(
        session.id,
        'round-1',
        { ...fixtureUser, objectId: 'not-a-host' },
        timestamp
      )
    ).toBe('host-required');
    expect(handle.undoVotingRoundReveal(session.id, 'round-1', fixtureUser, timestamp)).toBe(
      'reopened'
    );
    expect(handle.getSnapshot().sessions[0].rounds[0]).toEqual(
      expect.objectContaining({
        status: 'Voting',
        votes: [],
        timer: expect.objectContaining({ status: 'Stopped', remainingSeconds: 120 })
      })
    );
    expect(handle.getSnapshot().sessions[0].rounds[0].revealedAt).toBeUndefined();
    expect(handle.revealVotingRound(session.id, 'round-1', fixtureUser, timestamp)).toBe(
      'revealed'
    );
    expect(
      handle.finalizeVotingRound(
        session.id,
        'round-1',
        '3',
        fixtureUser,
        timestamp,
        'finalize-round-1'
      )
    ).toBe('finalized');
    expect(
      handle.selectVotingStory(
        session.id,
        secondStory.id,
        'round-2',
        fixtureUser,
        false,
        '2026-07-10T00:03:00.000Z'
      )
    ).toBe('selected');
    expect(
      handle.castVotingVote(session.id, 'round-2', {
        operationId: 'round-2-vote-1',
        participantId: 'participant-1',
        value: '5',
        castAt: '2026-07-10T00:04:00.000Z'
      })
    ).toBe('cast');
    expect(handle.getSnapshot().sessions[0].rounds[1]).toMatchObject({ status: 'Voting' });
    expect(
      handle.castVotingVote(session.id, 'round-2', {
        operationId: 'round-2-vote-2',
        participantId: 'participant-2',
        value: '3',
        castAt: '2026-07-10T00:04:30.000Z'
      })
    ).toBe('cast');
    expect(handle.getSnapshot().sessions[0].rounds[1]).toMatchObject({
      status: 'Revealed',
      revealReason: 'Automatic'
    });
    expect(handle.undoVotingRoundReveal(session.id, 'round-2', fixtureUser, timestamp)).toBe(
      'reopened'
    );
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(handle.getSnapshot().sessions[0].rounds[1]).toMatchObject({
      status: 'Voting',
      automaticRevealSuppressionKey: expect.any(String),
      timer: expect.objectContaining({ status: 'Stopped' })
    });
    expect(validateDocumentInvariants(handle.getSnapshot())).toEqual([]);
    expect(
      handle.castVotingVote(session.id, 'round-2', {
        operationId: 'round-2-vote-3',
        supersedesOperationId: 'round-2-vote-1',
        participantId: 'participant-1',
        value: '8',
        castAt: '2026-07-10T00:04:45.000Z'
      })
    ).toBe('cast');
    expect(handle.getSnapshot().sessions[0].rounds[1]).toMatchObject({
      status: 'Revealed',
      revealReason: 'Automatic'
    });
    expect(
      handle.finalizeVotingRound(
        session.id,
        'round-2',
        '5',
        fixtureUser,
        '2026-07-10T00:05:00.000Z',
        'finalize-round-2'
      )
    ).toBe('finalized');
    expect(
      handle.finalizeVotingRound(
        session.id,
        'round-2',
        '8',
        fixtureUser,
        '2026-07-10T00:06:00.000Z',
        'correct-round-2',
        'finalize-round-2'
      )
    ).toBe('finalized');
    expect(
      handle.finalizeVotingRound(
        session.id,
        'round-2',
        '13',
        fixtureUser,
        '2026-07-10T00:06:30.000Z',
        'stale-correction-round-2',
        'finalize-round-2'
      )
    ).toBe('reconciled-conflict');
    expect(handle.getSnapshot().stories).toEqual([
      expect.objectContaining({ id: story.id, currentEstimate: '3' }),
      expect.objectContaining({
        id: secondStory.id,
        currentEstimate: '8',
        estimateHistory: [
          expect.objectContaining({ value: '5' }),
          expect.objectContaining({ value: '8' })
        ]
      })
    ]);
    expect(handle.endVotingSession(session.id, fixtureUser, '2026-07-10T00:07:00.000Z')).toBe(
      'ended'
    );
    const nextSession: VotingSession = {
      id: 'session-2',
      teamId: fixtureDocument.team.id,
      status: 'Lobby',
      settings: {
        ...fixtureDocument.team.settings,
        scaleValues: [...fixtureDocument.team.settings.scaleValues]
      },
      participants: [],
      rounds: [],
      finalizedRoundIds: [],
      createdAt: '2026-07-10T00:08:00.000Z',
      createdBy: { ...fixtureUser },
      updatedAt: '2026-07-10T00:08:00.000Z',
      updatedBy: { ...fixtureUser }
    };

    expect(handle.prepareVotingSession(nextSession, nextSession.updatedAt)).toBe(nextSession.id);
    expect(handle.getSnapshot()).toMatchObject({
      openSessionId: nextSession.id,
      sessions: [
        { id: session.id, status: 'Ended' },
        { id: nextSession.id, status: 'Lobby' }
      ]
    });
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
