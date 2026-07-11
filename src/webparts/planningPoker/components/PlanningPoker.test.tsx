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
import type { ServiceScope } from '@microsoft/sp-core-library';
import type { IPlanningPokerStorageConfiguration } from '../../../storage/storageTypes';
import PlanningPoker from './PlanningPoker';

const currentUser = {
  displayName: 'Ada Lovelace',
  upn: 'ada@example.com',
  imageUrl: 'https://example.sharepoint.com/userphoto.jpg'
};
const serviceScope = {} as ServiceScope;

const configuration: IPlanningPokerStorageConfiguration = {
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

function renderPlanningPoker(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('PlanningPoker', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('renders the configured application shell and preserves unrelated route parameters', () => {
    let writtenSearch = '';
    act(() => {
      renderPlanningPoker(
        <PlanningPoker
          storageConfiguration={configuration}
          storageService={{
            canProvision: async () => false,
            provision: async () => configuration
          }}
          onStorageConfigured={jest.fn()}
          isPageEditMode={false}
          currentUser={currentUser}
          serviceScope={serviceScope}
          routeAdapter={{
            getSearch: () => 'debug=true&planningPokerView=Teams',
            replaceSearch: (search) => {
              writtenSearch = search;
            }
          }}
        />,
        container
      );
    });

    expect(container.querySelector('main h1')?.textContent).toBe('Teams');
    expect(container.querySelector('nav[aria-label="Planning Poker"]')).not.toBeNull();
    act(() => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Collapse navigation"]')
        ?.click();
    });
    expect(container.querySelector('button[aria-label="Expand navigation"]')).not.toBeNull();
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Expand navigation"]')?.click();
    });
    expect(container.querySelector('button[aria-label="Collapse navigation"]')).not.toBeNull();
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('About'))
        ?.click();
    });
    expect(writtenSearch).toContain('debug=true');
    expect(writtenSearch).toContain('planningPokerView=About');
  });

  it('enters and exits focused voting while retaining the SharePoint page route', () => {
    let currentSearch =
      'debug=true&planningPokerView=Voting&planningPokerTeam=team-1&planningPokerSession=session-1';
    act(() => {
      renderPlanningPoker(
        <PlanningPoker
          storageConfiguration={configuration}
          storageService={{
            canProvision: async () => false,
            provision: async () => configuration
          }}
          onStorageConfigured={jest.fn()}
          isPageEditMode={false}
          currentUser={currentUser}
          serviceScope={serviceScope}
          routeAdapter={{
            getSearch: () => currentSearch,
            replaceSearch: (search) => {
              currentSearch = search;
            }
          }}
        />,
        container
      );
    });

    expect(container.querySelector('nav')).toBeNull();
    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Leave session'))
        ?.click();
    });
    expect(currentSearch).toContain('debug=true');
    expect(currentSearch).toContain('planningPokerView=Voting');
    expect(currentSearch).not.toContain('planningPokerTeam');
    expect(currentSearch).not.toContain('planningPokerSession');
    expect(container.querySelector('nav[aria-label="Planning Poker"]')).not.toBeNull();
  });

  it('restores the last selected Stories team when switching application views', () => {
    let currentSearch = 'planningPokerView=Stories&planningPokerTeam=team-1';
    act(() => {
      renderPlanningPoker(
        <PlanningPoker
          storageConfiguration={configuration}
          storageService={{
            canProvision: async () => false,
            provision: async () => configuration
          }}
          onStorageConfigured={jest.fn()}
          isPageEditMode={false}
          currentUser={currentUser}
          serviceScope={serviceScope}
          routeAdapter={{
            getSearch: () => currentSearch,
            replaceSearch: (search) => {
              currentSearch = search;
            }
          }}
        />,
        container
      );
    });

    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('About'))
        ?.click();
    });
    expect(currentSearch).toContain('planningPokerView=About');
    expect(currentSearch).not.toContain('planningPokerTeam');

    act(() => {
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Stories'))
        ?.click();
    });
    expect(currentSearch).toContain('planningPokerView=Stories');
    expect(currentSearch).toContain('planningPokerTeam=team-1');
  });

  it('enables explicit provisioning after the component permission check', async () => {
    const onStorageConfigured = jest.fn();
    await act(async () => {
      renderPlanningPoker(
        <PlanningPoker
          storageService={{
            canProvision: async () => true,
            provision: async () => configuration
          }}
          onStorageConfigured={onStorageConfigured}
          isPageEditMode
          currentUser={currentUser}
          serviceScope={serviceScope}
        />,
        container
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(false);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(onStorageConfigured).toHaveBeenCalledWith(configuration);
  });

  it('announces permission and provisioning failures without exposing technical errors', async () => {
    const provision = jest.fn(async (): Promise<IPlanningPokerStorageConfiguration> => {
      throw new Error('sensitive response body');
    });
    await act(async () => {
      renderPlanningPoker(
        <PlanningPoker
          storageService={{
            canProvision: async () => true,
            provision
          }}
          onStorageConfigured={jest.fn()}
          isPageEditMode
          currentUser={currentUser}
          serviceScope={serviceScope}
        />,
        container
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.querySelector('button')?.disabled).toBe(false);
    await act(async () => {
      container.querySelector('button')?.click();
      await expect(provision.mock.results[0].value).rejects.toThrow('sensitive response body');
    });

    expect(provision).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Storage could not be configured');
    expect(container.textContent).not.toContain('sensitive response body');
  });

  it('requires page edit mode before checking permissions or enabling provisioning', async () => {
    const canProvision = jest.fn(async () => true);
    await act(async () => {
      renderPlanningPoker(
        <PlanningPoker
          storageService={{
            canProvision,
            provision: async () => configuration
          }}
          onStorageConfigured={jest.fn()}
          isPageEditMode={false}
          currentUser={currentUser}
          serviceScope={serviceScope}
        />,
        container
      );
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(canProvision).not.toHaveBeenCalled();
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.textContent).toContain('Edit this SharePoint page');
    expect(container.textContent).toContain('save or publish the page');
  });
});
