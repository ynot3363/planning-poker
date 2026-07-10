import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
import {
  TeamRepository,
  TeamRepositoryError,
  isHostedBy,
  validateTeamTitle
} from './teamRepository';
import type { ITeamDocumentStore } from './teamRepository';

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

function createStore(): ITeamDocumentStore {
  return {
    list: jest.fn(async () => []),
    listHostedBy: jest.fn(async () => []),
    create: jest.fn(async () => {
      throw new Error('Not used by this test.');
    }),
    load: jest.fn(async () => {
      throw new Error('Not used by this test.');
    }),
    rename: jest.fn(async () => undefined)
  };
}

describe('TeamRepository', () => {
  it('validates SharePoint file-name constraints', () => {
    expect(validateTeamTitle('')).toBe('Enter a team title.');
    expect(validateTeamTitle('CON')).toBe('The title uses a reserved file name.');
    expect(validateTeamTitle('Team/One')).toBe('The title is not a valid SharePoint file name.');
    expect(validateTeamTitle('Team One')).toBeUndefined();
  });

  it('treats host metadata as an application role, not inferred text', () => {
    expect(isHostedBy(fixtureDocument.team, fixtureUser)).toBe(true);
    expect(isHostedBy(fixtureDocument.team, { ...fixtureUser, objectId: 'different-user' })).toBe(
      false
    );
  });

  it('requires configured storage before protected store operations', async () => {
    const repository = new TeamRepository(undefined, createStore());

    await expect(repository.loadTeamDocument('item-id')).rejects.toMatchObject({
      name: 'TeamRepositoryError',
      code: 'not-configured'
    } satisfies Partial<TeamRepositoryError>);
  });

  it('delegates hosted-team discovery with the current user', async () => {
    const store = createStore();
    const repository = new TeamRepository(storage, store);

    await repository.listHostedTeams(fixtureUser);

    expect(store.listHostedBy).toHaveBeenCalledWith(fixtureUser);
  });

  it('rejects duplicate titles and validates renames', async () => {
    const store = createStore();
    jest
      .mocked(store.list)
      .mockResolvedValue([
        { teamId: 'existing', driveItemId: 'item', title: 'example team', isActive: true }
      ]);
    const repository = new TeamRepository(storage, store);

    await expect(repository.createTeamDocument(fixtureDocument.team)).rejects.toMatchObject({
      code: 'duplicate-title'
    });
    await expect(repository.renameTeamDocument('team-id', 'bad/name')).rejects.toMatchObject({
      code: 'invalid-title'
    });
    await repository.renameTeamDocument('team-id', 'Renamed Team');
    expect(store.rename).toHaveBeenCalledWith('team-id', 'Renamed Team');
  });
});
