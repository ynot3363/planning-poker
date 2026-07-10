jest.mock('@microsoft/sp-loader', () => ({
  SPComponentLoader: {
    loadComponentById: jest.fn()
  }
}));
jest.mock('@microsoft/sp-core-library', () => ({
  Log: { error: jest.fn() }
}));

import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { Log } from '@microsoft/sp-core-library';
import type { ServiceScope } from '@microsoft/sp-core-library';
import { SPComponentLoader } from '@microsoft/sp-loader';
import { LIVE_PERSONA_COMPONENT_ID, LivePersona } from './LivePersona';

interface ITestLivePersonaCardProps {
  readonly children: React.ReactNode;
  readonly upn: string;
  readonly serviceScope: ServiceScope;
}

type LivePersonaModule = {
  readonly LivePersonaCard: React.ComponentType<ITestLivePersonaCardProps>;
};

const loadComponentById = SPComponentLoader.loadComponentById as unknown as jest.MockedFunction<
  (id: string) => Promise<LivePersonaModule>
>;

function renderLivePersona(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('LivePersona', () => {
  let container: HTMLDivElement;
  let serviceScope: ServiceScope;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    serviceScope = {} as ServiceScope;
    loadComponentById.mockReset();
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
    jest.restoreAllMocks();
  });

  it('wraps the visible Persona with the Microsoft 365 live card', async () => {
    loadComponentById.mockResolvedValue({
      LivePersonaCard: (props) => (
        <div data-live-persona={props.upn} data-has-scope={props.serviceScope === serviceScope}>
          {props.children}
        </div>
      )
    });

    await act(async () => {
      renderLivePersona(
        <LivePersona
          displayName="Ada Lovelace"
          upn="ada@example.com"
          imageUrl="https://example.sharepoint.com/userphoto.jpg"
          serviceScope={serviceScope}
        />,
        container
      );
      await Promise.resolve();
    });

    expect(loadComponentById).toHaveBeenCalledWith(LIVE_PERSONA_COMPONENT_ID);
    expect(container.querySelector('[data-live-persona="ada@example.com"]')).not.toBeNull();
    expect(container.querySelector('[data-has-scope="true"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Signed in as Ada Lovelace"]')).not.toBeNull();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.sharepoint.com/userphoto.jpg'
    );
  });

  it('keeps the Persona fallback when the internal component is unavailable', async () => {
    const logError = jest.spyOn(Log, 'error').mockImplementation(() => undefined);
    loadComponentById.mockRejectedValue(new Error('component unavailable'));

    await act(async () => {
      renderLivePersona(
        <LivePersona
          displayName="Grace Hopper"
          upn="grace@example.com"
          serviceScope={serviceScope}
          hideDetails
        />,
        container
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="Signed in as Grace Hopper"]')).not.toBeNull();
    expect(container.querySelector('[data-live-persona]')).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      'PlanningPoker.LivePersona',
      expect.any(Error),
      serviceScope
    );
  });

  it('does not request the live card without a usable user principal name', () => {
    act(() => {
      renderLivePersona(
        <LivePersona displayName="Site User" upn="" serviceScope={serviceScope} />,
        container
      );
    });

    expect(loadComponentById).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Site User');
  });
});
