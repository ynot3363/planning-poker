import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { PlanningPokerDocumentRoot, PlanningPokerTeam } from '../domain/planningPokerDomain';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
import {
  TeamRepository,
  TeamRepositoryError,
  isHostedBy,
  projectTeamMetadata,
  validateTeamTitle
} from './teamRepository';
import type { ITeamDocumentStore, TeamDocumentHandle } from './teamRepository';

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

function createHandle(document: PlanningPokerDocumentRoot = fixtureDocument): TeamDocumentHandle {
  let snapshot = document;
  return {
    teamId: document.team.id,
    driveItemId: 'item-id',
    getSnapshot: jest.fn(() => snapshot),
    getConnectionState: () => 'Connected',
    updateTeam: jest.fn((team: PlanningPokerTeam) => {
      snapshot = { ...snapshot, team, updatedAt: team.updatedAt };
    }),
    updateStories: jest.fn((stories, updatedAt) => {
      snapshot = { ...snapshot, stories, updatedAt };
    }),
    updateSessions: jest.fn((sessions, openSessionId, updatedAt) => {
      snapshot = { ...snapshot, sessions, openSessionId, updatedAt };
    }),
    prepareVotingSession: jest.fn((session, updatedAt) => {
      snapshot = {
        ...snapshot,
        sessions: [...snapshot.sessions, session],
        openSessionId: session.id,
        updatedAt
      };
      return session.id;
    }),
    joinVotingSession: jest.fn(() => undefined),
    setVotingParticipantConnection: jest.fn(),
    waitForSaved: jest.fn(async () => undefined),
    subscribe: jest.fn(() => jest.fn()),
    dispose: jest.fn()
  };
}

function createStore(handle: TeamDocumentHandle = createHandle()): ITeamDocumentStore {
  return {
    list: jest.fn(async () => []),
    listHostedBy: jest.fn(async () => []),
    create: jest.fn(async () => handle),
    load: jest.fn(async () => handle),
    rename: jest.fn(async () => undefined),
    recycle: jest.fn(async () => ({})),
    updateMetadata: jest.fn(async () => undefined)
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

  it('projects the complete SharePoint discovery contract from Fluid state', () => {
    expect(projectTeamMetadata(fixtureDocument)).toEqual({
      title: 'Example Team',
      teamId: fixtureDocument.team.id,
      hosts: [fixtureUser],
      participants: [],
      isActive: true,
      schemaVersion: '1.0.0',
      activeSessionId: undefined,
      lastActivity: fixtureDocument.updatedAt
    });
  });

  it('waits for durable creation before refreshing metadata', async () => {
    const handle = createHandle();
    const store = createStore(handle);
    const repository = new TeamRepository(storage, store);

    await expect(repository.createTeamDocument(fixtureDocument.team)).resolves.toBe(handle);

    expect(store.create).toHaveBeenCalledWith(fixtureDocument.team, 'Example Team.fluid');
    expect(handle.waitForSaved).toHaveBeenCalledTimes(1);
    expect(store.updateMetadata).toHaveBeenCalledWith(fixtureDocument);
    expect(jest.mocked(store.create).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(handle.waitForSaved).mock.invocationCallOrder[0]
    );
    expect(jest.mocked(handle.waitForSaved).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(store.updateMetadata).mock.invocationCallOrder[0]
    );
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

  it('mutates Fluid, waits for save, renames, and then refreshes metadata', async () => {
    const handle = createHandle();
    const store = createStore(handle);
    const repository = new TeamRepository(storage, store);
    const updatedTeam: PlanningPokerTeam = {
      ...fixtureDocument.team,
      title: 'Renamed Team',
      description: 'Updated description',
      updatedAt: '2026-07-10T01:00:00.000Z'
    };

    await repository.updateTeamDocument(handle, fixtureUser, updatedTeam);

    expect(handle.updateTeam).toHaveBeenCalledWith(updatedTeam);
    expect(handle.waitForSaved).toHaveBeenCalledTimes(1);
    expect(store.rename).toHaveBeenCalledWith(updatedTeam.id, 'Renamed Team');
    expect(store.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ team: updatedTeam, updatedAt: updatedTeam.updatedAt })
    );
    expect(jest.mocked(handle.updateTeam).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(handle.waitForSaved).mock.invocationCallOrder[0]
    );
    expect(jest.mocked(handle.waitForSaved).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(store.rename).mock.invocationCallOrder[0]
    );
    expect(jest.mocked(store.rename).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(store.updateMetadata).mock.invocationCallOrder[0]
    );
  });

  it('rejects a metadata-only host match before any Fluid mutation', async () => {
    const document = {
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        hosts: [{ ...fixtureUser, objectId: 'different-user' }]
      }
    };
    const handle = createHandle(document);
    const store = createStore(handle);
    const repository = new TeamRepository(storage, store);

    await expect(
      repository.updateTeamDocument(handle, fixtureUser, fixtureDocument.team)
    ).rejects.toMatchObject({ code: 'host-mismatch' });
    expect(handle.updateTeam).not.toHaveBeenCalled();
    expect(handle.waitForSaved).not.toHaveBeenCalled();
    expect(store.rename).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it('verifies Fluid host state and recycles the complete team document', async () => {
    const handle = createHandle();
    const store = createStore(handle);
    jest.mocked(store.list).mockResolvedValue([
      {
        teamId: fixtureDocument.team.id,
        driveItemId: handle.driveItemId,
        title: fixtureDocument.team.title,
        isActive: true
      }
    ]);
    jest.mocked(store.recycle).mockResolvedValue({ recycleBinItemId: 'recycle-id' });
    const repository = new TeamRepository(storage, store);

    await expect(repository.deleteTeam(fixtureDocument.team.id, fixtureUser)).resolves.toEqual({
      recycleBinItemId: 'recycle-id'
    });

    expect(store.load).toHaveBeenCalledWith(handle.driveItemId);
    expect(store.recycle).toHaveBeenCalledWith(handle.driveItemId);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('blocks deletion for a stale metadata host or any non-empty open session', async () => {
    const staleHostHandle = createHandle({
      ...fixtureDocument,
      team: {
        ...fixtureDocument.team,
        hosts: [{ ...fixtureUser, objectId: 'another-host' }]
      }
    });
    const staleHostStore = createStore(staleHostHandle);
    jest.mocked(staleHostStore.list).mockResolvedValue([
      {
        teamId: fixtureDocument.team.id,
        driveItemId: staleHostHandle.driveItemId,
        title: fixtureDocument.team.title,
        isActive: true
      }
    ]);
    await expect(
      new TeamRepository(storage, staleHostStore).deleteTeam(fixtureDocument.team.id, fixtureUser)
    ).rejects.toMatchObject({ code: 'host-mismatch' });
    expect(staleHostStore.recycle).not.toHaveBeenCalled();
    expect(staleHostHandle.dispose).toHaveBeenCalledTimes(1);

    const openSessionHandle = createHandle({ ...fixtureDocument, openSessionId: 'session-id' });
    const openSessionStore = createStore(openSessionHandle);
    jest.mocked(openSessionStore.list).mockResolvedValue([
      {
        teamId: fixtureDocument.team.id,
        driveItemId: openSessionHandle.driveItemId,
        title: fixtureDocument.team.title,
        isActive: true
      }
    ]);
    await expect(
      new TeamRepository(storage, openSessionStore).deleteTeam(fixtureDocument.team.id, fixtureUser)
    ).rejects.toMatchObject({ code: 'open-session' });
    expect(openSessionStore.recycle).not.toHaveBeenCalled();
    expect(openSessionHandle.dispose).toHaveBeenCalledTimes(1);
  });

  it('normalizes an unknown recycle failure without claiming deletion', async () => {
    const handle = createHandle();
    const store = createStore(handle);
    jest.mocked(store.list).mockResolvedValue([
      {
        teamId: fixtureDocument.team.id,
        driveItemId: handle.driveItemId,
        title: fixtureDocument.team.title,
        isActive: true
      }
    ]);
    jest.mocked(store.recycle).mockRejectedValue(new Error('sensitive transport failure'));

    await expect(
      new TeamRepository(storage, store).deleteTeam(fixtureDocument.team.id, fixtureUser)
    ).rejects.toMatchObject({ code: 'recycle-failure' });
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });
});
