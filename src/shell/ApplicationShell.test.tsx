jest.mock('@microsoft/sp-loader', () => ({
  SPComponentLoader: {
    loadComponentById: jest.fn(() => new Promise(() => undefined))
  }
}));
jest.mock('@microsoft/sp-core-library', () => ({
  Log: { error: jest.fn() }
}));

import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import type { ServiceScope } from '@microsoft/sp-core-library';
import { ApplicationShell } from './ApplicationShell';
import type { IApplicationShellProps } from './ApplicationShell';
import type { IPlanningPokerRoute } from './planningPokerRoute';

const teamsRoute: IPlanningPokerRoute = { view: 'Teams', focusedVoting: false };
const serviceScope = {} as ServiceScope;

function createProps(overrides: Partial<IApplicationShellProps> = {}): IApplicationShellProps {
  return {
    route: teamsRoute,
    isNavigationCollapsed: false,
    configurationStatus: 'configured',
    currentUser: {
      displayName: 'Ada Lovelace',
      upn: 'ada@example.com',
      imageUrl: 'https://example.sharepoint.com/userphoto.jpg'
    },
    serviceScope,
    onNavigate: jest.fn(),
    onToggleNavigation: jest.fn(),
    ...overrides
  };
}

function renderShell(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('ApplicationShell', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('renders labeled navigation with a visible current destination', () => {
    act(() => {
      renderShell(<ApplicationShell {...createProps()} />, container);
    });

    const navigation = container.querySelector('nav[aria-label="Planning Poker"]');
    expect(navigation).not.toBeNull();
    expect(navigation?.querySelectorAll('button')).toHaveLength(4);
    expect(navigation?.querySelector('[aria-current="page"]')?.textContent).toContain('Teams');
    expect(navigation?.querySelector('[data-icon-name="Group"]')).not.toBeNull();
    expect(navigation?.querySelector('[data-icon-name="TeamsLogo"]')).toBeNull();
    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.querySelector('[aria-label="Signed in as Ada Lovelace"]')).not.toBeNull();
  });

  it('renders icon-only labeled navigation and forwards destination selection', () => {
    const onNavigate = jest.fn();
    act(() => {
      renderShell(
        <ApplicationShell {...createProps({ isNavigationCollapsed: true, onNavigate })} />,
        container
      );
    });

    expect(container.querySelector('button[aria-label="Expand navigation"]')).not.toBeNull();
    const about = container.querySelector('button[aria-label="About"]') as HTMLButtonElement;
    act(() => about.click());
    expect(onNavigate).toHaveBeenCalledWith({ view: 'About', focusedVoting: false });
  });

  it('hides navigation in focused voting and provides an accessible exit', () => {
    const onNavigate = jest.fn();
    act(() => {
      renderShell(
        <ApplicationShell
          {...createProps({
            route: {
              view: 'Voting',
              teamId: 'team-1',
              sessionId: 'session-1',
              focusedVoting: true
            },
            onNavigate
          })}
        />,
        container
      );
    });

    expect(container.querySelector('nav')).toBeNull();
    const leave = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Leave session')
    );
    expect(leave).toBeDefined();
    act(() => leave?.click());
    expect(onNavigate).toHaveBeenCalledWith({ view: 'Voting', focusedVoting: false });
  });

  it('announces safe route fallback guidance and focuses main after navigation', () => {
    act(() => {
      renderShell(
        <ApplicationShell {...createProps({ routeNotice: 'incomplete-voting-link' })} />,
        container
      );
    });
    expect(container.textContent).toContain('voting link is incomplete');

    act(() => {
      renderShell(
        <ApplicationShell {...createProps({ route: { view: 'Stories', focusedVoting: false } })} />,
        container
      );
    });
    expect(document.activeElement).toBe(container.querySelector('main'));
  });

  it('covers required About guidance and has no automated accessibility violations', async () => {
    await act(async () => {
      renderShell(
        <ApplicationShell
          {...createProps({
            route: { view: 'About', focusedVoting: false },
            theme: { isInverted: true }
          })}
        />,
        container
      );
    });

    expect(container.textContent).toContain('Named and anonymous voting');
    expect(container.textContent).toContain('Results and exports');
    expect(container.textContent).toContain('Host and participant capabilities');
    expect(container.textContent).not.toContain('Getting started');
    expect(container.textContent).not.toContain('hidden Planning Poker data library');
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('dark');
    expect(await axe(container)).toHaveNoViolations();
  });
});
