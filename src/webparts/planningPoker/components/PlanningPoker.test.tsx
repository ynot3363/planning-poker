import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import type { IPlanningPokerStorageConfiguration } from '../../../storage/storageTypes';
import PlanningPoker from './PlanningPoker';

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

  it('renders the configured success state with a heading', () => {
    act(() => {
      renderPlanningPoker(
        <PlanningPoker
          storageConfiguration={configuration}
          storageService={{
            canProvision: async () => false,
            provision: async () => configuration
          }}
          onStorageConfigured={jest.fn()}
        />,
        container
      );
    });

    expect(container.querySelector('main h2')?.textContent).toBe('Planning Poker');
    expect(container.textContent).toContain('Storage is configured');
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
        />,
        container
      );
      await Promise.resolve();
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
});
