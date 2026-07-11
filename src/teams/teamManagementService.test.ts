import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
import { TeamRepository } from '../repository/teamRepository';
import type { ITeamDocumentStore, TeamDocumentHandle } from '../repository/teamRepository';
import { createInitialTeamForm } from './teamForm';
import { TeamManagementService } from './teamManagementService';

const storage: IPlanningPokerStorageConfiguration = {
  libraryTitle: 'PlanningPokerAppData',
  listId: 'list-id',
  driveId: 'drive-id',
  serverRelativeUrl: '/sites/team/PlanningPokerAppData',
  webAbsoluteUrl: 'https://example.sharepoint.com/sites/team',
  provisioningVersion: '1.0.0',
  schemaVersion: '1.0.0',
  fieldMap: {},
  lastValidatedAt: '2026-07-10T00:00:00.000Z'
};

function createHandle(): TeamDocumentHandle {
  let snapshot = fixtureDocument;
  return {
    teamId: fixtureDocument.team.id,
    driveItemId: 'item-id',
    getSnapshot: () => snapshot,
    updateTeam: (team) => {
      snapshot = { ...snapshot, team, updatedAt: team.updatedAt };
    },
    waitForSaved: async () => undefined,
    subscribe: () => jest.fn(),
    dispose: jest.fn()
  };
}

function createService(handle: TeamDocumentHandle = createHandle()): {
  readonly service: TeamManagementService;
  readonly store: ITeamDocumentStore;
} {
  const store: ITeamDocumentStore = {
    list: jest.fn(async () => []),
    listHostedBy: jest.fn(async () => [
      {
        teamId: fixtureDocument.team.id,
        driveItemId: handle.driveItemId,
        title: fixtureDocument.team.title,
        isActive: true
      }
    ]),
    create: jest.fn(async () => handle),
    load: jest.fn(async () => handle),
    rename: jest.fn(async () => undefined),
    updateMetadata: jest.fn(async () => undefined)
  };
  return {
    service: new TeamManagementService(
      new TeamRepository(storage, store),
      fixtureUser,
      () => 'new-team-id',
      () => '2026-07-10T03:00:00.000Z'
    ),
    store
  };
}

describe('TeamManagementService', () => {
  it('lists hosted summaries and verifies Fluid hosts before editing', async () => {
    const { service } = createService();
    const summaries = await service.listTeams();
    const session = await service.openTeam(summaries[0]);

    expect(session.team).toBe(fixtureDocument.team);
    expect(session.values.title).toBe('Example Team');
    service.closeTeam(session);
    expect(session.handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('rejects a metadata-only host match and disposes the handle', async () => {
    const handle = createHandle();
    const snapshot = handle.getSnapshot();
    jest.spyOn(handle, 'getSnapshot').mockReturnValue({
      ...snapshot,
      team: { ...snapshot.team, hosts: [{ ...fixtureUser, objectId: 'another-user' }] }
    });
    const { service } = createService(handle);
    const summary = (await service.listTeams())[0];

    await expect(service.openTeam(summary)).rejects.toMatchObject({ code: 'host-mismatch' });
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('returns field errors before attempting an invalid create', async () => {
    const { service, store } = createService();
    const result = await service.createTeam(createInitialTeamForm(fixtureUser), []);

    expect(result).toEqual({
      isSaved: false,
      fieldErrors: { title: 'Enter a team title.' }
    });
    expect(store.create).not.toHaveBeenCalled();
  });

  it('creates a valid team and releases its handle after durable save', async () => {
    const handle = createHandle();
    const { service, store } = createService(handle);
    const result = await service.createTeam(
      { ...createInitialTeamForm(fixtureUser), title: 'Delivery Team' },
      []
    );

    expect(result).toEqual({ isSaved: true });
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-team-id', title: 'Delivery Team' }),
      'Delivery Team.fluid'
    );
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });
});
