import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryVotingRound,
  VotingSession
} from '../domain/planningPokerDomain';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';
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
  let current = document;
  const listeners = new Set<() => void>();
  const handle: TeamDocumentHandle = {
    teamId: document.team.id,
    driveItemId: 'item-id',
    getSnapshot: () => current,
    updateTeam: (team) => {
      current = { ...current, team, updatedAt: team.updatedAt };
      listeners.forEach((listener) => listener());
    },
    updateStories: (stories, updatedAt) => {
      current = { ...current, stories, updatedAt };
      listeners.forEach((listener) => listener());
    },
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
    create: jest.fn(async () => handle),
    load: jest.fn(async () => handle),
    rename: jest.fn(async () => undefined),
    recycle: jest.fn(async () => ({})),
    updateMetadata: jest.fn(async () => undefined)
  };
  return {
    service: new StoryManagementService(
      new TeamRepository(storage, store),
      fixtureUser,
      () => 'story-new',
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
});
