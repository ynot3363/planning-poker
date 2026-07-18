import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryVotingRound,
  VotingSession
} from '../domain/planningPokerDomain';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
import {
  applyStoryCreate,
  applyStoryDelete,
  applyStoryEdit,
  applyStoryImport,
  applyStoryTransition
} from '../repository/intentCommands';
import { TeamRepository } from '../repository/teamRepository';
import type { ITeamDocumentStore, TeamDocumentHandle } from '../repository/teamRepository';
import {
  StoryManagementService,
  isStoryInOpenRound,
  normalizeStoryLink,
  selectVotingEligibleStories
} from './storyManagement';

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

const readyStory: PointingStory = {
  id: 'story-ready',
  title: 'Ready story',
  description: 'Ready description',
  status: 'Ready',
  estimateHistory: [],
  createdAt: '2026-07-10T00:00:00.000Z',
  createdBy: fixtureUser,
  updatedAt: '2026-07-10T00:00:00.000Z',
  updatedBy: fixtureUser
};

const pointedStory: PointingStory = {
  ...readyStory,
  id: 'story-pointed',
  title: 'Pointed story',
  status: 'Pointed',
  currentEstimate: '5',
  estimateHistory: [
    {
      sessionId: 'session-old',
      roundId: 'round-old',
      value: '5',
      finalizedAt: '2026-07-10T01:00:00.000Z',
      finalizedBy: fixtureUser
    }
  ]
};

function createHarness(document: PlanningPokerDocumentRoot = fixtureDocument): {
  readonly service: StoryManagementService;
  readonly store: ITeamDocumentStore;
  readonly handle: TeamDocumentHandle;
  getDocument(): PlanningPokerDocumentRoot;
} {
  const current = JSON.parse(JSON.stringify(document)) as PlanningPokerDocumentRoot;
  const listeners = new Set<() => void>();
  const publish = (): void => listeners.forEach((listener) => listener());
  const handle: TeamDocumentHandle = {
    teamId: document.team.id,
    driveItemId: 'item-id',
    getSnapshot: () => current,
    getConnectionState: () => 'Connected',
    editTeam: jest.fn(() => ({ status: 'applied' })),
    setTeamActive: jest.fn(() => ({ status: 'applied' })),
    createStory: jest.fn((command) => {
      const result = applyStoryCreate(current, command);
      if (result.status === 'applied') {
        publish();
      }
      return result;
    }),
    importStories: jest.fn((command) => {
      const result = applyStoryImport(current, command);
      if (result.status === 'applied') {
        publish();
      }
      return result;
    }),
    editStory: jest.fn((command) => {
      const result = applyStoryEdit(current, command);
      if (result.status === 'applied') {
        publish();
      }
      return result;
    }),
    transitionStory: jest.fn((command) => {
      const result = applyStoryTransition(current, command);
      if (result.status === 'applied') {
        publish();
      }
      return result;
    }),
    deleteStory: jest.fn((command) => {
      const result = applyStoryDelete(current, command);
      if (result.status === 'applied') {
        publish();
      }
      return result;
    }),
    prepareVotingSession: jest.fn((session) => session.id),
    startVotingSession: jest.fn(() => ({ status: 'applied' })),
    joinVotingSession: jest.fn(() => undefined),
    selectVotingStory: jest.fn(() => 'invalid-session'),
    castVotingVote: jest.fn(() => 'invalid-session'),
    updateVotingTimer: jest.fn(() => 'invalid-session'),
    revealVotingRound: jest.fn(() => 'invalid-session'),
    undoVotingRoundReveal: jest.fn(() => 'invalid-session'),
    finalizeVotingRound: jest.fn(() => 'invalid-session'),
    endVotingSession: jest.fn(() => 'invalid-session'),
    setVotingParticipantConnection: jest.fn(),
    waitForSaved: jest.fn(async () => undefined),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: jest.fn()
  };
  const summary = {
    teamId: document.team.id,
    driveItemId: handle.driveItemId,
    title: document.team.title,
    isActive: document.team.isActive
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
  let nextStoryId = 0;
  return {
    service: new StoryManagementService(
      new TeamRepository(storage, store),
      fixtureUser,
      () => {
        nextStoryId++;
        return nextStoryId === 1 ? 'story-new' : `story-new-${nextStoryId}`;
      },
      () => '2026-07-10T03:00:00.000Z'
    ),
    store,
    handle,
    getDocument: () => current
  };
}

describe('story management', () => {
  it('normalizes only blank, SharePoint-relative, and HTTPS links', () => {
    expect(normalizeStoryLink('')).toEqual({});
    expect(normalizeStoryLink(' /sites/team/work/1 ')).toEqual({ link: '/sites/team/work/1' });
    expect(normalizeStoryLink('https://example.com/work/1')).toEqual({
      link: 'https://example.com/work/1'
    });
    expect(normalizeStoryLink(['javascript', 'alert(1)'].join(':'))).toHaveProperty('error');
    expect(normalizeStoryLink('//evil.example/path')).toHaveProperty('error');
    expect(normalizeStoryLink('http://example.com')).toHaveProperty('error');
  });

  it('creates a Ready story with system audit and durable metadata refresh', async () => {
    const harness = createHarness();
    const team = (await harness.service.listTeams())[0];
    const session = await harness.service.openTeam(team);

    await expect(
      harness.service.createStory(session, {
        title: ' New story ',
        description: ' Details ',
        link: '/sites/team/work/1'
      })
    ).resolves.toEqual({ isSaved: true });

    expect(harness.getDocument().stories).toEqual([
      expect.objectContaining({
        id: 'story-new',
        title: 'New story',
        description: 'Details',
        link: '/sites/team/work/1',
        status: 'Ready',
        estimateHistory: [],
        createdAt: '2026-07-10T03:00:00.000Z',
        createdBy: fixtureUser
      })
    ]);
    expect(session.handle.waitForSaved).toHaveBeenCalledTimes(1);
    expect(harness.store.updateMetadata).toHaveBeenCalledTimes(1);
  });

  it('edits content while preserving audit creation, status, and estimates', async () => {
    const document = { ...fixtureDocument, stories: [pointedStory] };
    const harness = createHarness(document);
    const session = await harness.service.openTeam((await harness.service.listTeams())[0]);

    await harness.service.editStory(session, pointedStory.id, {
      title: 'Edited pointed story',
      description: 'Edited details',
      link: 'https://example.com/story'
    });

    expect(harness.getDocument().stories[0]).toEqual(
      expect.objectContaining({
        title: 'Edited pointed story',
        status: 'Pointed',
        currentEstimate: '5',
        estimateHistory: pointedStory.estimateHistory,
        createdAt: pointedStory.createdAt,
        createdBy: pointedStory.createdBy
      })
    );
  });

  it('archives, restores, and re-points without erasing estimate history', async () => {
    const document = { ...fixtureDocument, stories: [readyStory, pointedStory] };
    const harness = createHarness(document);
    const session = await harness.service.openTeam((await harness.service.listTeams())[0]);

    await expect(harness.service.archiveStory(session, readyStory.id)).resolves.toEqual({
      isSaved: true
    });
    expect(harness.getDocument().stories[0].status).toBe('Archived');
    await expect(harness.service.restoreStory(session, readyStory.id)).resolves.toEqual({
      isSaved: true
    });
    expect(harness.getDocument().stories[0].status).toBe('Ready');
    await expect(harness.service.repointStory(session, pointedStory.id)).resolves.toEqual({
      isSaved: true
    });
    expect(harness.getDocument().stories[1]).toMatchObject({
      status: 'Ready',
      currentEstimate: '5',
      estimateHistory: pointedStory.estimateHistory
    });
  });

  it('permanently deletes a story in one durable transaction', async () => {
    const harness = createHarness({ ...fixtureDocument, stories: [readyStory, pointedStory] });
    const session = await harness.service.openTeam((await harness.service.listTeams())[0]);

    await expect(harness.service.deleteStory(session, pointedStory.id)).resolves.toEqual({
      isSaved: true
    });

    expect(harness.getDocument().stories).toEqual([readyStory]);
    expect(session.handle.deleteStory).toHaveBeenCalledTimes(1);
    expect(session.handle.waitForSaved).toHaveBeenCalledTimes(1);
    await expect(harness.service.deleteStory(session, 'missing-story')).resolves.toEqual({
      isSaved: true
    });
  });

  it('returns only Ready stories to voting consumers', () => {
    const archived = { ...readyStory, id: 'story-archived', status: 'Archived' as const };
    expect(selectVotingEligibleStories([readyStory, pointedStory, archived])).toEqual([readyStory]);
  });

  it('blocks every mutation of a story in an unfinished open round', async () => {
    const round: StoryVotingRound = {
      id: 'round-active',
      storyId: readyStory.id,
      storySnapshot: {
        storyId: readyStory.id,
        title: readyStory.title,
        description: readyStory.description
      },
      status: 'Voting',
      votes: [],
      timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
    };
    const sessionRecord: VotingSession = {
      id: 'session-active',
      teamId: fixtureDocument.team.id,
      status: 'Active',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [round],
      activeRoundId: round.id,
      finalizedRoundIds: [],
      createdAt: '2026-07-10T02:00:00.000Z',
      createdBy: fixtureUser,
      updatedAt: '2026-07-10T02:00:00.000Z',
      updatedBy: fixtureUser
    };
    const document = {
      ...fixtureDocument,
      stories: [readyStory],
      sessions: [sessionRecord],
      openSessionId: sessionRecord.id
    };
    expect(isStoryInOpenRound(document, readyStory.id)).toBe(true);
    const harness = createHarness(document);
    const session = await harness.service.openTeam((await harness.service.listTeams())[0]);

    await expect(
      harness.service.editStory(session, readyStory.id, {
        title: 'Blocked edit',
        description: '',
        link: ''
      })
    ).resolves.toMatchObject({ isSaved: false, code: 'active-round' });
    await expect(harness.service.archiveStory(session, readyStory.id)).resolves.toMatchObject({
      isSaved: false,
      code: 'active-round'
    });
    await expect(harness.service.deleteStory(session, readyStory.id)).resolves.toMatchObject({
      isSaved: false,
      code: 'active-round'
    });
    expect(session.handle.waitForSaved).not.toHaveBeenCalled();
  });

  it('publishes synchronized snapshots to another open client session', async () => {
    const harness = createHarness({ ...fixtureDocument, stories: [readyStory] });
    const team = (await harness.service.listTeams())[0];
    const first = await harness.service.openTeam(team);
    const second = await harness.service.openTeam(team);
    const listener = jest.fn();
    const unsubscribe = harness.service.subscribe(second, listener);

    await harness.service.archiveStory(first, readyStory.id);

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ stories: [expect.objectContaining({ status: 'Archived' })] })
    );
    unsubscribe();
  });

  it('imports every valid row with common audit fields in one transaction', async () => {
    const harness = createHarness();
    const session = await harness.service.openTeam((await harness.service.listTeams())[0]);

    await expect(
      harness.service.importStories(session, [
        { title: 'First', description: 'One', link: '' },
        { title: 'Second', description: 'Two', link: '/sites/team/two' }
      ])
    ).resolves.toEqual({ isSaved: true });

    expect(session.handle.importStories).toHaveBeenCalledTimes(1);
    expect(session.handle.waitForSaved).toHaveBeenCalledTimes(1);
    expect(harness.store.updateMetadata).toHaveBeenCalledTimes(1);
    expect(harness.getDocument().stories).toEqual([
      expect.objectContaining({
        title: 'First',
        status: 'Ready',
        createdAt: '2026-07-10T03:00:00.000Z'
      }),
      expect.objectContaining({
        title: 'Second',
        status: 'Ready',
        createdAt: '2026-07-10T03:00:00.000Z'
      })
    ]);
  });

  it('does not mutate the document when any imported row or ID generation fails', async () => {
    const invalidHarness = createHarness();
    const invalidSession = await invalidHarness.service.openTeam(
      (await invalidHarness.service.listTeams())[0]
    );
    await expect(
      invalidHarness.service.importStories(invalidSession, [
        { title: '', description: '', link: '' }
      ])
    ).resolves.toMatchObject({ isSaved: false });
    expect(invalidSession.handle.importStories).not.toHaveBeenCalled();

    const failingHarness = createHarness();
    const failingService = new StoryManagementService(
      new TeamRepository(storage, failingHarness.store),
      fixtureUser,
      () => {
        throw new Error('ID unavailable');
      },
      () => '2026-07-10T03:00:00.000Z'
    );
    const failingSession = await failingService.openTeam((await failingService.listTeams())[0]);
    await expect(
      failingService.importStories(failingSession, [{ title: 'Valid', description: '', link: '' }])
    ).resolves.toMatchObject({ isSaved: false });
    expect(failingSession.handle.importStories).not.toHaveBeenCalled();

    const mutationHarness = createHarness();
    const mutationSession = await mutationHarness.service.openTeam(
      (await mutationHarness.service.listTeams())[0]
    );
    (mutationSession.handle.importStories as jest.Mock).mockImplementation(() => {
      throw new Error('transaction failed');
    });
    await expect(
      mutationHarness.service.importStories(mutationSession, [
        { title: 'Valid', description: '', link: '' }
      ])
    ).resolves.toMatchObject({ isSaved: false });
    expect(mutationHarness.getDocument().stories).toEqual([]);
  });
});
