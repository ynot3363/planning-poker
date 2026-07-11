import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type { PlanningPokerDocumentRoot, VotingSession } from '../domain/planningPokerDomain';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';
import type { IVotingSessionService, VotingSessionContext } from './sessionManagement';
import { VotingPage } from './VotingPage';

const team: HostedTeamSummary = {
  teamId: fixtureDocument.team.id,
  driveItemId: 'drive-item-id',
  title: fixtureDocument.team.title,
  isActive: true
};

const session: VotingSession = {
  id: 'session-1',
  teamId: team.teamId,
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

function createService(isHost: boolean): jest.Mocked<IVotingSessionService> {
  let document: PlanningPokerDocumentRoot = {
    ...fixtureDocument,
    sessions: [session],
    openSessionId: session.id
  };
  const handle: TeamDocumentHandle = {
    teamId: team.teamId,
    driveItemId: team.driveItemId,
    getSnapshot: () => document,
    getConnectionState: () => 'Connected',
    updateTeam: jest.fn(),
    updateStories: jest.fn(),
    updateSessions: jest.fn(),
    prepareVotingSession: jest.fn((candidate) => candidate.id),
    waitForSaved: jest.fn(async () => undefined),
    subscribe: jest.fn(() => jest.fn()),
    dispose: jest.fn()
  };
  const context: VotingSessionContext = {
    team,
    handle,
    isHost,
    isConfiguredMember: !isHost,
    getDocument: () => document,
    getSession: () => document.sessions[0],
    getConnectionState: () => 'Connected'
  };
  return {
    listHostedTeams: jest.fn(async () => [team]),
    prepareSession: jest.fn(async (_team: HostedTeamSummary) => context),
    joinSession: jest.fn(async (_teamId: string, _sessionId: string) => context),
    startVoting: jest.fn(async (_context: VotingSessionContext) => {
      document = {
        ...document,
        sessions: [{ ...session, status: 'Active' }]
      };
      return document.sessions[0];
    }),
    subscribe: jest.fn((_context: VotingSessionContext, _listener: () => void) => jest.fn()),
    closeSession: jest.fn((_context: VotingSessionContext) => undefined)
  };
}

/**
 * Pairs test rendering with the suite-owned unmount boundary.
 *
 * @param element - Voting element under test.
 * @param container - Test DOM host.
 */
function renderVoting(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('VotingPage', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('prepares a hosted team and opens its focused route', async () => {
    const service = createService(true);
    const onOpenSession = jest.fn();
    await act(async () => {
      renderVoting(<VotingPage service={service} onOpenSession={onOpenSession} />, container);
    });

    const prepare = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Prepare voting')
    );
    await act(async () => prepare?.click());

    expect(service.prepareSession).toHaveBeenCalledWith(team);
    expect(onOpenSession).toHaveBeenCalledWith(team.teamId, session.id);
  });

  it('opens the existing session identified by team discovery metadata', async () => {
    const service = createService(true);
    service.listHostedTeams.mockResolvedValue([{ ...team, activeSessionId: session.id }]);
    const onOpenSession = jest.fn();
    await act(async () => {
      renderVoting(<VotingPage service={service} onOpenSession={onOpenSession} />, container);
    });
    const open = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open session')
    );

    act(() => open?.click());

    expect(onOpenSession).toHaveBeenCalledWith(team.teamId, session.id);
    expect(service.prepareSession).not.toHaveBeenCalled();
  });

  it('shows participant Lobby context without host controls and has no accessibility violations', async () => {
    const service = createService(false);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    expect(container.textContent).toContain('Voting has not started.');
    expect(container.textContent).toContain('Configured member');
    expect(container.textContent).not.toContain('Start voting');
    expect(container.textContent).toContain('Copy link');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lets a host start the Lobby and announces the synchronized Active state', async () => {
    const service = createService(true);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });
    const start = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Start voting')
    );

    await act(async () => start?.click());

    expect(service.startVoting).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Voting is active.');
    expect(container.textContent).not.toContain('Start voting');
  });

  it('copies the always-visible session link through an explicit clipboard action', async () => {
    const service = createService(false);
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    try {
      await act(async () => {
        renderVoting(
          <VotingPage
            service={service}
            teamId={team.teamId}
            sessionId={session.id}
            onOpenSession={jest.fn()}
          />,
          container
        );
      });
      const copy = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Copy link')
      );

      await act(async () => copy?.click());

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('planningPokerSession'));
      expect(container.textContent).toContain('Copied');
    } finally {
      Object.defineProperty(
        window.navigator,
        'clipboard',
        clipboardDescriptor ?? { configurable: true, value: undefined }
      );
    }
  });
});
