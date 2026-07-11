import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryVotingRound,
  VotingSession
} from '../domain/planningPokerDomain';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';
import type {
  IStoryManagementService,
  StoryFormValues,
  StoryMutationResult,
  StoryTeamSession
} from './storyManagement';
import { formatStoryTimestamp } from './storyPresentation';
import { StoriesPage } from './StoriesPage';

const summary: HostedTeamSummary = {
  teamId: fixtureDocument.team.id,
  driveItemId: 'item-id',
  title: fixtureDocument.team.title,
  isActive: true
};

const readyStory: PointingStory = {
  id: 'story-ready',
  title: 'Ready backlog item',
  description: 'A long enough description for the Ready card.',
  link: 'https://example.com/work/ready',
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
  title: 'Pointed backlog item',
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

const archivedStory: PointingStory = {
  ...readyStory,
  id: 'story-archived',
  title: 'Archived backlog item',
  status: 'Archived'
};

function createService(
  teams: readonly HostedTeamSummary[] = [summary],
  initialDocument: PlanningPokerDocumentRoot = {
    ...fixtureDocument,
    stories: [readyStory, pointedStory, archivedStory]
  }
): {
  readonly service: jest.Mocked<IStoryManagementService>;
  readonly session: StoryTeamSession;
  getDocument(): PlanningPokerDocumentRoot;
} {
  let document = initialDocument;
  const listeners = new Set<(value: PlanningPokerDocumentRoot) => void>();
  const publish = (): void => listeners.forEach((listener) => listener(document));
  const handle: TeamDocumentHandle = {
    teamId: document.team.id,
    driveItemId: summary.driveItemId,
    getSnapshot: () => document,
    updateTeam: jest.fn(),
    updateStories: (stories, updatedAt) => {
      document = { ...document, stories, updatedAt };
      publish();
    },
    waitForSaved: jest.fn(async () => undefined),
    subscribe: jest.fn(() => jest.fn()),
    dispose: jest.fn()
  };
  const session: StoryTeamSession = {
    team: summary,
    handle,
    getDocument: () => document
  };
  const success = async (): Promise<StoryMutationResult> => ({ isSaved: true });
  const changeStatus = async (
    storyId: string,
    status: PointingStory['status']
  ): Promise<StoryMutationResult> => {
    document = {
      ...document,
      stories: document.stories.map((story) =>
        story.id === storyId ? { ...story, status } : story
      )
    };
    publish();
    return { isSaved: true };
  };
  const service: jest.Mocked<IStoryManagementService> = {
    listTeams: jest.fn(async () => teams),
    openTeam: jest.fn(async (_team: HostedTeamSummary) => session),
    closeTeam: jest.fn(),
    subscribe: jest.fn((_session, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    createStory: jest.fn(async (_session: StoryTeamSession, _values: StoryFormValues) => success()),
    importStories: jest.fn(
      async (_session: StoryTeamSession, _values: readonly StoryFormValues[]) => success()
    ),
    editStory: jest.fn(
      async (_session: StoryTeamSession, _storyId: string, _values: StoryFormValues) => success()
    ),
    archiveStory: jest.fn(async (_session, storyId) => changeStatus(storyId, 'Archived')),
    restoreStory: jest.fn(async (_session, storyId) => changeStatus(storyId, 'Ready')),
    repointStory: jest.fn(async (_session, storyId) => changeStatus(storyId, 'Ready')),
    deleteStory: jest.fn(async (_session, storyId): Promise<StoryMutationResult> => {
      document = { ...document, stories: document.stories.filter((story) => story.id !== storyId) };
      publish();
      return { isSaved: true };
    })
  };
  return { service, session, getDocument: () => document };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderPage(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('StoriesPage', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('guides users without hosted teams back to Teams', async () => {
    const { service } = createService([]);
    const onNavigateTeams = jest.fn();
    await act(async () => {
      renderPage(
        <StoriesPage
          currentUser={fixtureUser}
          service={service}
          onSelectTeam={jest.fn()}
          onNavigateTeams={onNavigateTeams}
        />,
        container
      );
      await settle();
    });

    expect(container.textContent).toContain('Create a team before adding stories');
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Go to Teams'))
        ?.click();
    });
    expect(onNavigateTeams).toHaveBeenCalledTimes(1);
  });

  it('defaults to the first hosted team and shows counted status pivots and safe content', async () => {
    const { service } = createService();
    const onSelectTeam = jest.fn();
    await act(async () => {
      renderPage(
        <StoriesPage
          currentUser={fixtureUser}
          service={service}
          onSelectTeam={onSelectTeam}
          onNavigateTeams={jest.fn()}
        />,
        container
      );
      await settle();
    });
    expect(onSelectTeam).toHaveBeenCalledWith(summary.teamId);
    expect(service.openTeam).toHaveBeenCalledWith(summary);
    expect(
      Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Add story')
      )?.disabled
    ).toBe(false);

    expect(container.textContent).toContain('Ready (1)');
    expect(container.textContent).toContain('Pointed (1)');
    expect(container.textContent).toContain('Archived (1)');
    expect(container.textContent).toContain('Ready backlog item');
    expect(container.textContent).toContain(formatStoryTimestamp(readyStory.createdAt));
    const createObjectUrl = jest.fn(() => 'blob:story-template');
    const revokeObjectUrl = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const anchorClick = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Download template'))
        ?.click();
    });
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:story-template');
    anchorClick.mockRestore();
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="https://example.com/work/ready"]'
    );
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('validates Add Story and exposes read-only audit context', async () => {
    const { service } = createService();
    await act(async () => {
      renderPage(
        <StoriesPage
          currentUser={fixtureUser}
          service={service}
          selectedTeamId={summary.teamId}
          onSelectTeam={jest.fn()}
          onNavigateTeams={jest.fn()}
        />,
        container
      );
      await settle();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Add story'))
        ?.click();
      await settle();
    });
    expect(document.body.textContent).toContain('Added by');
    expect(document.body.textContent).toContain(fixtureUser.displayName);
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Save story'))
        ?.click();
      await settle();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain('Enter a story title');
    expect(service.createStory).not.toHaveBeenCalled();

    const titleInput = document.body.querySelector<HTMLInputElement>('input[required]');
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(titleInput, 'New backlog item');
      titleInput?.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Save story'))
        ?.click();
      await settle();
    });
    expect(service.createStory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'New backlog item' })
    );
  });

  it('archives with confirmation and exposes restore and re-point commands', async () => {
    const harness = createService();
    await act(async () => {
      renderPage(
        <StoriesPage
          currentUser={fixtureUser}
          service={harness.service}
          selectedTeamId={summary.teamId}
          onSelectTeam={jest.fn()}
          onNavigateTeams={jest.fn()}
        />,
        container
      );
      await settle();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Edit')
        ?.click();
      await settle();
    });
    expect(document.body.textContent).toContain('Edit story');
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Save story'))
        ?.click();
      await settle();
    });
    expect(harness.service.editStory).toHaveBeenCalledWith(
      harness.session,
      readyStory.id,
      expect.objectContaining({ title: readyStory.title })
    );
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Archive')
        ?.click();
      await settle();
    });
    expect(document.body.textContent).toContain('Archive Ready backlog item?');
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Archive story')
        ?.click();
      await settle();
    });
    expect(harness.service.archiveStory).toHaveBeenCalledWith(harness.session, readyStory.id);

    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Pointed (1)'))
        ?.click();
    });
    expect(container.textContent).toContain('Estimate: 5');
    expect(container.textContent).toContain('Re-point');
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Re-point'))
        ?.click();
      await settle();
    });
    expect(harness.service.repointStory).toHaveBeenCalledWith(harness.session, pointedStory.id);
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Archived (2)'))
        ?.click();
    });
    expect(container.textContent).toContain('Restore to Ready');
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Restore to Ready'))
        ?.click();
      await settle();
    });
    expect(harness.service.restoreStory).toHaveBeenCalledWith(harness.session, expect.any(String));
  });

  it('disables story commands while the story is in an open round', async () => {
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
    const votingSession: VotingSession = {
      id: 'session-active',
      teamId: fixtureDocument.team.id,
      status: 'Active',
      settings: fixtureDocument.team.settings,
      participants: [],
      rounds: [round],
      activeRoundId: round.id,
      finalizedRoundIds: [],
      createdAt: readyStory.createdAt,
      createdBy: fixtureUser,
      updatedAt: readyStory.updatedAt,
      updatedBy: fixtureUser
    };
    const { service } = createService([summary], {
      ...fixtureDocument,
      stories: [readyStory],
      sessions: [votingSession],
      openSessionId: votingSession.id
    });
    await act(async () => {
      renderPage(
        <StoriesPage
          currentUser={fixtureUser}
          service={service}
          selectedTeamId={summary.teamId}
          onSelectTeam={jest.fn()}
          onNavigateTeams={jest.fn()}
        />,
        container
      );
      await settle();
    });
    expect(container.textContent).toContain('open voting round');
    const edit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Edit'
    );
    const archive = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Archive'
    );
    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete'
    );
    expect(edit?.disabled).toBe(true);
    expect(archive?.disabled).toBe(true);
    expect(deleteButton?.disabled).toBe(true);
  });

  it('requires confirmation before permanently deleting a story', async () => {
    const harness = createService();
    await act(async () => {
      renderPage(
        <StoriesPage
          currentUser={fixtureUser}
          service={harness.service}
          selectedTeamId={summary.teamId}
          onSelectTeam={jest.fn()}
          onNavigateTeams={jest.fn()}
        />,
        container
      );
      await settle();
    });
    const deleteButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Delete'
    );
    act(() => deleteButton?.click());
    expect(document.body.textContent).toContain('Delete Ready backlog item?');
    expect(document.body.textContent).toContain('complete estimate history');
    expect(harness.service.deleteStory).not.toHaveBeenCalled();

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Delete story')
        ?.click();
      await settle();
    });
    expect(harness.service.deleteStory).toHaveBeenCalledWith(harness.session, readyStory.id);
    expect(
      Array.from(container.querySelectorAll('h2')).some(
        (heading) => heading.textContent === 'Ready backlog item'
      )
    ).toBe(false);
    expect(container.textContent).toContain('Ready backlog item was deleted.');
  });
});
