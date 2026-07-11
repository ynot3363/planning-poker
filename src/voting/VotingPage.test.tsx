jest.mock('@microsoft/sp-loader', () => ({
  SPComponentLoader: { loadComponentById: jest.fn(async () => ({})) }
}));
jest.mock('@microsoft/sp-core-library', () => ({ Log: { error: jest.fn() } }));

import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { axe } from 'jest-axe';
import type { ServiceScope } from '@microsoft/sp-core-library';
import 'jest-axe/extend-expect';
import { fixtureDocument, fixtureUser } from '../domain/planningPokerFixtures';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  VotingSession
} from '../domain/planningPokerDomain';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';
import type { IVotingSessionService, VotingSessionContext } from './sessionManagement';
import { VotingPage } from './VotingPage';

const team: HostedTeamSummary = {
  teamId: fixtureDocument.team.id,
  driveItemId: 'drive-item-id',
  title: fixtureDocument.team.title,
  isActive: true
};
const serviceScope = {} as ServiceScope;

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

function createService(
  isHost: boolean,
  sessionState: VotingSession = session,
  participantId = 'participant-current',
  stories: readonly PointingStory[] = fixtureDocument.stories
): jest.Mocked<IVotingSessionService> {
  let document: PlanningPokerDocumentRoot = {
    ...fixtureDocument,
    stories,
    sessions: [sessionState],
    openSessionId: sessionState.id
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
    joinVotingSession: jest.fn(() => undefined),
    selectVotingStory: jest.fn(() => 'selected'),
    castVotingVote: jest.fn(() => 'cast'),
    updateVotingTimer: jest.fn(() => 'updated'),
    setVotingParticipantConnection: jest.fn(),
    waitForSaved: jest.fn(async () => undefined),
    subscribe: jest.fn(() => jest.fn()),
    dispose: jest.fn()
  };
  const context: VotingSessionContext = {
    team,
    handle,
    isHost,
    isConfiguredMember: !isHost,
    participantId,
    getDocument: () => document,
    getSession: () => document.sessions[0],
    getConnectionState: () => 'Connected'
  };
  return {
    listHostedTeams: jest.fn(async () => [team]),
    listVotingTeams: jest.fn(async () => [{ ...team, relationship: 'Host' as const }]),
    prepareSession: jest.fn(async (_team: HostedTeamSummary) => context),
    joinSession: jest.fn(async (_teamId: string, _sessionId: string) => context),
    startVoting: jest.fn(async (_context: VotingSessionContext) => {
      document = {
        ...document,
        sessions: [{ ...sessionState, status: 'Active' }]
      };
      return document.sessions[0];
    }),
    selectStory: jest.fn(async (_context: VotingSessionContext, storyId: string) => {
      const story = document.stories.find((candidate) => candidate.id === storyId);
      if (story === undefined) throw new Error('Story unavailable');
      const active = document.sessions[0];
      document = {
        ...document,
        sessions: [
          {
            ...active,
            rounds: [
              ...active.rounds,
              {
                id: 'round-new',
                storyId,
                storySnapshot: {
                  storyId,
                  title: story.title,
                  description: story.description,
                  ...(story.link === undefined ? {} : { link: story.link })
                },
                status: 'Voting',
                votes: [],
                timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
              }
            ],
            activeRoundId: 'round-new'
          }
        ]
      };
      return document.sessions[0];
    }),
    replaceStory: jest.fn(async (_context, storyId) => {
      const story = document.stories.find((candidate) => candidate.id === storyId);
      if (story === undefined) throw new Error('Story unavailable');
      const active = document.sessions[0];
      const replacement = {
        id: 'round-replacement',
        storyId,
        storySnapshot: { storyId, title: story.title, description: story.description },
        status: 'Voting' as const,
        votes: [],
        timer: { configuredDurationSeconds: 300, status: 'Ready' as const, remainingSeconds: 300 }
      };
      document = {
        ...document,
        sessions: [
          {
            ...active,
            rounds: [
              ...active.rounds.map((round) =>
                round.id === active.activeRoundId
                  ? { ...round, status: 'Cancelled' as const }
                  : round
              ),
              replacement
            ],
            activeRoundId: replacement.id
          }
        ]
      };
      return document.sessions[0];
    }),
    castVote: jest.fn(async (_context, roundId, value) => {
      const active = document.sessions[0];
      document = {
        ...document,
        sessions: [
          {
            ...active,
            rounds: active.rounds.map((round) =>
              round.id === roundId
                ? {
                    ...round,
                    votes: [{ participantId, value, castAt: '2026-07-11T12:30:00.000Z' }]
                  }
                : round
            )
          }
        ]
      };
      return document.sessions[0];
    }),
    startTimer: jest.fn(async (_context, _roundId) => document.sessions[0]),
    stopTimer: jest.fn(async (_context, _roundId) => document.sessions[0]),
    resetTimer: jest.fn(async (_context, _roundId) => document.sessions[0]),
    subscribe: jest.fn((_context: VotingSessionContext, _listener: () => void) => jest.fn()),
    markDisconnected: jest.fn(),
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
      renderVoting(
        <VotingPage service={service} serviceScope={serviceScope} onOpenSession={onOpenSession} />,
        container
      );
    });

    const prepare = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Prepare voting')
    );
    await act(async () => prepare?.click());

    expect(service.prepareSession).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: team.teamId, relationship: 'Host' })
    );
    expect(onOpenSession).toHaveBeenCalledWith(team.teamId, session.id);
  });

  it('opens the existing session identified by team discovery metadata', async () => {
    const service = createService(true);
    service.listVotingTeams.mockResolvedValue([
      { ...team, activeSessionId: session.id, relationship: 'Host' }
    ]);
    const onOpenSession = jest.fn();
    await act(async () => {
      renderVoting(
        <VotingPage service={service} serviceScope={serviceScope} onOpenSession={onOpenSession} />,
        container
      );
    });
    const open = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open session')
    );

    act(() => open?.click());

    expect(onOpenSession).toHaveBeenCalledWith(team.teamId, session.id);
    expect(service.prepareSession).not.toHaveBeenCalled();
  });

  it('shows an open configured-participant session on the bookmarkable Voting page', async () => {
    const service = createService(false);
    service.listVotingTeams.mockResolvedValue([
      { ...team, activeSessionId: session.id, relationship: 'Participant' }
    ]);
    const onOpenSession = jest.fn();
    await act(async () => {
      renderVoting(
        <VotingPage service={service} serviceScope={serviceScope} onOpenSession={onOpenSession} />,
        container
      );
    });
    const open = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Open session')
    );

    act(() => open?.click());

    expect(container.textContent).toContain('Participant session is open.');
    expect(onOpenSession).toHaveBeenCalledWith(team.teamId, session.id);
  });

  it('shows participant Lobby context without host controls and has no accessibility violations', async () => {
    const service = createService(false);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    expect(container.textContent).toContain('Example Team - Named Voting Session');
    expect(container.textContent).toContain('Lobby');
    expect(container.textContent).not.toContain('Start voting session');
    expect(container.querySelector('[aria-label="Copy voting session URL"]')).not.toBeNull();
    expect(container.textContent).toContain('Copy Url');
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(service.markDisconnected).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders named participants as personas with vote status but no vote values', async () => {
    const votedUser = {
      ...fixtureUser,
      objectId: '00000000-0000-0000-0000-000000000002',
      displayName: 'Voted User',
      loginName: 'voted@example.com'
    };
    const disconnectedUser = {
      ...fixtureUser,
      objectId: '00000000-0000-0000-0000-000000000003',
      displayName: 'Disconnected User',
      loginName: 'disconnected@example.com'
    };
    const namedSession: VotingSession = {
      ...session,
      status: 'Active',
      participants: [
        {
          kind: 'Named',
          id: 'participant-current',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        },
        {
          kind: 'Named',
          id: 'participant-voted',
          user: votedUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        },
        {
          kind: 'Named',
          id: 'participant-disconnected',
          user: disconnectedUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Disconnected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ],
      rounds: [
        {
          id: 'round-participation',
          storyId: 'story-participation',
          storySnapshot: {
            storyId: 'story-participation',
            title: 'Participant grouping',
            description: 'Verify mutually exclusive participant states.'
          },
          status: 'Voting',
          votes: [
            {
              participantId: 'participant-voted',
              value: '3',
              castAt: fixtureDocument.updatedAt
            },
            {
              participantId: 'participant-disconnected',
              value: '5',
              castAt: fixtureDocument.updatedAt
            }
          ],
          timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
        }
      ],
      activeRoundId: 'round-participation'
    };
    const service = createService(true, namedSession);

    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          webAbsoluteUrl="https://example.sharepoint.com/sites/team"
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    const waitingGroup = container.querySelector('[aria-label="Not voted participants"]');
    const votedGroup = container.querySelector('[aria-label="Voted participants"]');
    const disconnectedGroup = container.querySelector('[aria-label="Disconnected participants"]');

    expect(waitingGroup?.textContent).toContain(fixtureUser.displayName);
    expect(waitingGroup?.textContent).not.toContain(votedUser.displayName);
    expect(votedGroup?.textContent).toContain(votedUser.displayName);
    expect(disconnectedGroup?.textContent).toContain(disconnectedUser.displayName);
    expect(disconnectedGroup?.textContent).toContain('Voted · Disconnected');
    expect(votedGroup?.textContent).not.toContain(disconnectedUser.displayName);
    expect(container.textContent).toContain('Not voted (1)');
    expect(container.textContent).toContain('Voted (1)');
    expect(container.textContent).toContain('Disconnected (1)');
    expect(container.textContent).toContain('You');
    expect(
      container.querySelector(`[aria-label="${fixtureUser.displayName}, session participant"]`)
    ).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      '/_layouts/15/userphoto.aspx'
    );
  });

  it('renders anonymous aggregate counts and only the current browser alias', async () => {
    const anonymousSession: VotingSession = {
      ...session,
      settings: { ...session.settings, votingMode: 'Anonymous' },
      participants: [
        {
          kind: 'Anonymous',
          id: 'anonymous-current',
          alias: 'Participant 1',
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        },
        {
          kind: 'Anonymous',
          id: 'anonymous-other',
          alias: 'Participant 2',
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ]
    };
    const service = createService(true, anonymousSession, 'anonymous-current');

    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    expect(container.textContent).toContain('You are Participant 1.');
    expect(container.textContent).toContain('2 joined · 0 voted · 2 remaining · 0 disconnected');
    expect(container.textContent).not.toContain('Participant 2');
    expect(container.querySelector('[class*="ms-Persona"]')).toBeNull();
  });

  it('lets a host start the Lobby and announces the synchronized Active state', async () => {
    const service = createService(true);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
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
    expect(container.textContent).toContain('Active');
    expect(container.textContent).not.toContain('Start voting session');
  });

  it('renders active story context and lets the joined participant select and change a vote', async () => {
    const activeSession: VotingSession = {
      ...session,
      status: 'Active',
      participants: [
        {
          kind: 'Named',
          id: 'participant-current',
          user: fixtureUser,
          joinedAt: fixtureDocument.createdAt,
          presence: { connection: 'Connected', lastSeenAt: fixtureDocument.updatedAt }
        }
      ],
      rounds: [
        {
          id: 'round-1',
          storyId: 'story-1',
          storySnapshot: {
            storyId: 'story-1',
            title: 'Estimate collaboration',
            description: 'Keep every voter synchronized.',
            link: 'https://example.sharepoint.com/sites/team/Lists/Backlog/1'
          },
          status: 'Voting',
          votes: [],
          timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
        }
      ],
      activeRoundId: 'round-1'
    };
    const sourceStory: PointingStory = {
      id: 'story-1',
      title: 'Estimate collaboration',
      description: 'Keep every voter synchronized.',
      status: 'Ready',
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const otherStory: PointingStory = {
      ...sourceStory,
      id: 'story-2',
      title: 'Review another story',
      description: 'This story is not active.'
    };
    const service = createService(false, activeSession, 'participant-current', [
      sourceStory,
      otherStory
    ]);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    const storyLink = container.querySelector('a');
    expect(container.textContent).toContain('Estimate collaboration');
    expect(container.textContent).toContain('Keep every voter synchronized.');
    expect(storyLink?.getAttribute('target')).toBe('_blank');
    expect(storyLink?.getAttribute('rel')).toBe('noopener noreferrer');
    const vote = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '5'
    );
    await act(async () => vote?.click());

    expect(service.castVote).toHaveBeenCalledWith(expect.anything(), 'round-1', '5');
    expect(container.textContent).toContain('Your current vote is 5.');
    const otherStoryCard = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(otherStory.title)
    );
    act(() => otherStoryCard?.click());
    expect(container.textContent).toContain(otherStory.description);
    expect(container.textContent).not.toContain('Choose your estimate');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lets a host select a Ready story for an active session', async () => {
    const readyStory: PointingStory = {
      id: 'story-ready',
      title: 'Ready for voting',
      description: '',
      status: 'Ready',
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const service = createService(true, { ...session, status: 'Active' }, undefined, [readyStory]);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    const storyCard = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes(readyStory.title)
    );
    act(() => storyCard?.click());
    const select = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Start story voting')
    );
    await act(async () => select?.click());

    expect(service.selectStory).toHaveBeenCalledWith(expect.anything(), readyStory.id);
    expect(container.textContent).toContain(readyStory.title);
  });

  it('shows synchronized timer controls only to the host', async () => {
    const timedSession: VotingSession = {
      ...session,
      status: 'Active',
      rounds: [
        {
          id: 'timed-round',
          storyId: 'timed-story',
          storySnapshot: { storyId: 'timed-story', title: 'Timed story', description: '' },
          status: 'Voting',
          votes: [],
          timer: { configuredDurationSeconds: 300, status: 'Ready', remainingSeconds: 300 }
        }
      ],
      activeRoundId: 'timed-round'
    };
    const story: PointingStory = {
      id: 'timed-story',
      title: 'Timed story',
      description: '',
      status: 'Ready',
      estimateHistory: [],
      createdAt: fixtureDocument.createdAt,
      createdBy: fixtureUser,
      updatedAt: fixtureDocument.updatedAt,
      updatedBy: fixtureUser
    };
    const service = createService(true, timedSession, 'participant-current', [story]);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    expect(container.textContent).toContain('5:00');
    const start = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Start'
    );
    await act(async () => start?.click());

    expect(service.startTimer).toHaveBeenCalledWith(expect.anything(), 'timed-round');
    expect(container.textContent).toContain('Reset');
  });

  it('does not render an unsafe persisted story link', async () => {
    const unsafeSession: VotingSession = {
      ...session,
      status: 'Active',
      rounds: [
        {
          id: 'round-unsafe',
          storyId: 'story-unsafe',
          storySnapshot: {
            storyId: 'story-unsafe',
            title: 'Unsafe context',
            description: '',
            link: 'http://insecure.example.com/story'
          },
          status: 'Voting',
          votes: [],
          timer: { configuredDurationSeconds: 0, status: 'Ready', remainingSeconds: 0 }
        }
      ],
      activeRoundId: 'round-unsafe'
    };
    const service = createService(false, unsafeSession);
    await act(async () => {
      renderVoting(
        <VotingPage
          service={service}
          serviceScope={serviceScope}
          teamId={team.teamId}
          sessionId={session.id}
          onOpenSession={jest.fn()}
        />,
        container
      );
    });

    expect(container.textContent).toContain('Story link unavailable.');
    expect(container.querySelector('a')).toBeNull();
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
            serviceScope={serviceScope}
            teamId={team.teamId}
            sessionId={session.id}
            onOpenSession={jest.fn()}
          />,
          container
        );
      });
      const copy = container.querySelector(
        '[aria-label="Copy voting session URL"]'
      ) as HTMLButtonElement;

      await act(async () => copy?.click());

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('planningPokerSession'));
      expect(container.textContent).toContain('URL copied');
    } finally {
      Object.defineProperty(
        window.navigator,
        'clipboard',
        clipboardDescriptor ?? { configurable: true, value: undefined }
      );
    }
  });
});
