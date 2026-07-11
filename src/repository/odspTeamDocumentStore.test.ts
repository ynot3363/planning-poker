const mockCreateContainer = jest.fn();
jest.mock('@fluidframework/odsp-client/beta', () => ({
  OdspClient: class OdspClient {
    public createContainer(...args: unknown[]): Promise<unknown> {
      return mockCreateContainer(...args) as Promise<unknown>;
    }
  }
}));

import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
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
    rename: jest.fn(async (_driveId: string, _driveItemId: string, _fileName: string) => undefined)
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
            PlanningPokerHosts: [{ Id: 17 }]
          },
          {
            Id: 13,
            Title: 'Other Team',
            File: { Name: 'Other Team.fluid' },
            PlanningPokerTeamID: 'other-team',
            PlanningPokerIsActive: true,
            PlanningPokerHosts: [{ Id: 99 }]
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
    handle.dispose();
    handle.dispose();
    expect(view.dispose).toHaveBeenCalledTimes(1);
    expect(services.dispose).toHaveBeenCalledTimes(1);
    expect(container.dispose).toHaveBeenCalledTimes(1);
  });
});
