import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';
import type { TeamFormValues } from './teamForm';
import type {
  ITeamManagementService,
  TeamDeleteRequest,
  TeamDeleteResult,
  TeamEditSession,
  TeamSaveResult
} from './teamManagementService';
import type { IPlanningPokerPeopleService } from './sharePointPeopleService';
import { TeamsPage } from './TeamsPage';

const peopleService: IPlanningPokerPeopleService = {
  search: async () => [],
  resolve: async () => fixtureUser
};

function createHandle(): TeamDocumentHandle {
  return {
    teamId: fixtureDocument.team.id,
    driveItemId: 'item-id',
    getSnapshot: () => fixtureDocument,
    getConnectionState: () => 'Connected',
    updateTeam: jest.fn(),
    updateStories: jest.fn(),
    updateSessions: jest.fn(),
    prepareVotingSession: jest.fn((session) => session.id),
    joinVotingSession: jest.fn(() => undefined),
    selectVotingStory: jest.fn(() => 'invalid-session'),
    castVotingVote: jest.fn(() => 'invalid-session'),
    updateVotingTimer: jest.fn(() => 'invalid-session'),
    setVotingParticipantConnection: jest.fn(),
    waitForSaved: async () => undefined,
    subscribe: () => jest.fn(),
    dispose: jest.fn()
  };
}

function createService(
  teams: readonly HostedTeamSummary[] = []
): jest.Mocked<ITeamManagementService> {
  const handle = createHandle();
  const session: TeamEditSession = {
    team: fixtureDocument.team,
    values: {
      teamId: fixtureDocument.team.id,
      title: fixtureDocument.team.title,
      description: fixtureDocument.team.description,
      hosts: fixtureDocument.team.hosts,
      configuredMembers: [],
      isActive: true,
      scaleKind: 'Fibonacci',
      customScaleValues: [],
      timerEnabled: true,
      timerDurationMinutes: 5,
      votingMode: 'Named'
    },
    handle
  };
  return {
    listTeams: jest.fn(async () => teams),
    openTeam: jest.fn(async (_summary: HostedTeamSummary) => session),
    createTeam: jest.fn(
      async (
        _values: TeamFormValues,
        _existingTeams: readonly HostedTeamSummary[]
      ): Promise<TeamSaveResult> => ({ isSaved: true })
    ),
    updateTeam: jest.fn(
      async (
        _session: TeamEditSession,
        _values: TeamFormValues,
        _existingTeams: readonly HostedTeamSummary[]
      ): Promise<TeamSaveResult> => ({ isSaved: true })
    ),
    setTeamActive: jest.fn(
      async (_team: HostedTeamSummary, _isActive: boolean): Promise<TeamSaveResult> => ({
        isSaved: true
      })
    ),
    deleteTeam: jest.fn(
      async (request: TeamDeleteRequest): Promise<TeamDeleteResult> =>
        request.isConfirmed ? { code: 'success' } : { code: 'confirmation-cancelled' }
    ),
    closeTeam: jest.fn()
  };
}

function renderPage(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('TeamsPage', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('loads an empty state and opens a new-team panel with the current host', async () => {
    const service = createService();
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Create your first team');
    expect(container.querySelector('[data-icon-name="Add"]')).not.toBeNull();
    expect(container.textContent).not.toContain('security boundary');
    expect(await axe(container)).toHaveNoViolations();
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('New team'))
        ?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('New team');
    expect(document.body.textContent).toContain(fixtureUser.displayName);
  });

  it('shows a load failure and retries hosted-team discovery', async () => {
    const service = createService();
    service.listTeams.mockRejectedValueOnce(new Error('sensitive transport failure'));
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Teams could not be loaded');
    expect(container.textContent).not.toContain('sensitive transport failure');
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Retry'))
        ?.click();
      await Promise.resolve();
    });

    expect(service.listTeams).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Create your first team');
  });

  it('renders inactive hosted teams and opens their edit session', async () => {
    const summary: HostedTeamSummary = {
      teamId: fixtureDocument.team.id,
      driveItemId: 'item-id',
      title: 'Archived Delivery Team',
      isActive: false
    };
    const service = createService([summary]);
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Inactive');
    expect(container.textContent).toContain('unavailable for new voting sessions');
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Edit team'))
        ?.click();
      await Promise.resolve();
    });
    expect(service.openTeam).toHaveBeenCalledWith(summary);
    expect(document.body.textContent).toContain('Edit team');
    expect(document.body.textContent).toContain('Timer duration in minutes');
    expect(document.body.textContent).not.toContain('Timer duration in seconds');
  });

  it('shows repair guidance when Fluid host verification fails', async () => {
    const summary: HostedTeamSummary = {
      teamId: 'team-id',
      driveItemId: 'item-id',
      title: 'Team',
      isActive: true
    };
    const service = createService([summary]);
    service.openTeam.mockRejectedValue(new Error('metadata mismatch'));
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Edit team'))
        ?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain('ask another host to repair access');
  });

  it('submits valid new-team values and refreshes the hosted list', async () => {
    const service = createService();
    let capturedValues: TeamFormValues | undefined;
    service.createTeam.mockImplementation(async (values) => {
      capturedValues = values;
      return { isSaved: true };
    });
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('New team'))
        ?.click();
      await Promise.resolve();
    });
    const titleInput = document.body.querySelector<HTMLInputElement>('input[required]');
    expect(titleInput).not.toBeNull();
    await act(async () => {
      if (titleInput !== null) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )?.set;
        valueSetter?.call(titleInput, 'Delivery Team');
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Save team'))
        ?.click();
      await Promise.resolve();
    });

    expect(capturedValues?.title).toBe('Delivery Team');
    expect(service.listTeams).toHaveBeenCalledTimes(2);
  });

  it('activates and deactivates a hosted team without recycling it', async () => {
    const summary: HostedTeamSummary = {
      teamId: fixtureDocument.team.id,
      driveItemId: 'item-id',
      title: fixtureDocument.team.title,
      isActive: true
    };
    const service = createService([summary]);
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });

    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Deactivate'))
        ?.click();
      await Promise.resolve();
    });

    expect(service.setTeamActive).toHaveBeenCalledWith(summary, false);
    expect(service.deleteTeam).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Inactive');
    expect(container.textContent).toContain('Activate');
  });

  it('names the team in the delete confirmation and cancels without deletion', async () => {
    const summary: HostedTeamSummary = {
      teamId: fixtureDocument.team.id,
      driveItemId: 'item-id',
      title: 'Delivery Team',
      isActive: true
    };
    const service = createService([summary]);
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });
    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete')
    );
    await act(async () => {
      deleteButton?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('Delete Delivery Team?');
    expect(document.body.textContent).toContain('Stories, votes, and session history');
    expect(await axe(document.body)).toHaveNoViolations();

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Cancel')
        ?.click();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(service.deleteTeam).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Delivery Team');
    expect(document.body.textContent).not.toContain('Delete Delivery Team?');
    expect(document.activeElement).toBe(deleteButton);
  });

  it('removes a successfully deleted team and moves focus to New team', async () => {
    const summary: HostedTeamSummary = {
      teamId: fixtureDocument.team.id,
      driveItemId: 'item-id',
      title: 'Delivery Team',
      isActive: true
    };
    const service = createService([summary]);
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Delete'))
        ?.click();
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Delete team')
        ?.click();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(service.deleteTeam).toHaveBeenCalledWith({ team: summary, isConfirmed: true });
    expect(container.textContent).not.toContain('Delivery Team');
    expect(container.textContent).toContain('Create your first team');
    expect(document.activeElement?.textContent).toContain('New team');
  });

  it('retains the team and offers retry when recycling fails', async () => {
    const summary: HostedTeamSummary = {
      teamId: fixtureDocument.team.id,
      driveItemId: 'item-id',
      title: 'Delivery Team',
      isActive: true
    };
    const service = createService([summary]);
    service.deleteTeam
      .mockResolvedValueOnce({
        code: 'recycle-failure',
        message: 'The team could not be moved to the SharePoint recycle bin. Try again.'
      })
      .mockResolvedValueOnce({ code: 'success' });
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Delete'))
        ?.click();
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Delete team')
        ?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Delivery Team');
    expect(document.body.textContent).toContain('Try again');

    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Delete team')
        ?.click();
      await Promise.resolve();
    });
    expect(service.deleteTeam).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Delivery Team');
  });

  it('keeps the team and explains that an open session blocks deletion', async () => {
    const summary: HostedTeamSummary = {
      teamId: fixtureDocument.team.id,
      driveItemId: 'item-id',
      title: 'Delivery Team',
      isActive: true
    };
    const service = createService([summary]);
    service.deleteTeam.mockResolvedValue({
      code: 'open-session',
      message: "End the team's open voting session before deleting it."
    });
    await act(async () => {
      renderPage(
        <TeamsPage currentUser={fixtureUser} service={service} peopleService={peopleService} />,
        container
      );
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Delete'))
        ?.click();
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(document.body.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === 'Delete team')
        ?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('open voting session');
    expect(document.body.textContent).toContain('Delete Delivery Team?');
    expect(container.textContent).toContain('Delivery Team');
  });
});
