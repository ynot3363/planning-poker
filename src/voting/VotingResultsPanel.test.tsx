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
import type { VotingResultsPresentation } from './results';
import { VotingResultsPanel } from './VotingResultsPanel';

const breakdown = [
  { value: '3', count: 1, percentage: 50 },
  { value: '5', count: 1, percentage: 50 }
] as const;

/**
 * Pairs result rendering with the suite-owned unmount boundary.
 *
 * @param element - Results element under test.
 * @param container - Test DOM host.
 */
function renderResults(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('VotingResultsPanel', () => {
  let container: HTMLDivElement;
  const serviceScope = {} as ServiceScope;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('renders named votes and host assignment controls accessibly', async () => {
    const results: VotingResultsPresentation = {
      mode: 'Named',
      breakdown,
      votedCount: 2,
      missingCount: 1,
      reason: 'Manual',
      rows: [
        {
          participantId: 'participant-1',
          displayName: 'Ada Lovelace',
          upn: 'ada@example.com',
          value: '3'
        },
        {
          participantId: 'participant-2',
          displayName: 'Grace Hopper',
          upn: 'grace@example.com'
        }
      ]
    };
    const onSelectEstimate = jest.fn();
    await act(async () => {
      renderResults(
        <VotingResultsPanel
          results={results}
          scaleValues={['3', '5']}
          isHost
          disabled={false}
          selectedEstimate="5"
          assignedValue={undefined}
          isChangingEstimate={false}
          serviceScope={serviceScope}
          webAbsoluteUrl="https://example.sharepoint.com/sites/team"
          onSelectEstimate={onSelectEstimate}
          onAssignEstimate={jest.fn()}
          onUndoReveal={jest.fn()}
          onStartChangingEstimate={jest.fn()}
          onCancelChangingEstimate={jest.fn()}
        />,
        container
      );
    });

    expect(container.textContent).toContain('Ada Lovelace');
    expect(container.textContent).toContain('Grace Hopper');
    expect(container.textContent).toContain('Missing');
    expect(container.querySelectorAll('table')).toHaveLength(2);
    expect(container.textContent).toContain('Assign points');
    expect(container.textContent).toContain('Undo reveal');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders anonymous aggregates without identities or participant commands', () => {
    const results: VotingResultsPresentation = {
      mode: 'Anonymous',
      breakdown,
      votedCount: 2,
      missingCount: 0,
      reason: 'Automatic'
    };
    act(() => {
      renderResults(
        <VotingResultsPanel
          results={results}
          scaleValues={['3', '5']}
          isHost={false}
          disabled={false}
          selectedEstimate={undefined}
          assignedValue={undefined}
          isChangingEstimate={false}
          serviceScope={serviceScope}
          webAbsoluteUrl={undefined}
          onSelectEstimate={jest.fn()}
          onAssignEstimate={jest.fn()}
          onUndoReveal={jest.fn()}
          onStartChangingEstimate={jest.fn()}
          onCancelChangingEstimate={jest.fn()}
        />,
        container
      );
    });

    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.textContent).toContain('Automatic reveal');
    expect(container.textContent).not.toContain('Ada');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps finalized point choices hidden until the host starts a change', () => {
    const results: VotingResultsPresentation = {
      mode: 'Anonymous',
      breakdown,
      votedCount: 2,
      missingCount: 0,
      reason: 'Automatic'
    };
    const onStartChangingEstimate = jest.fn();
    const render = (isChangingEstimate: boolean): void => {
      renderResults(
        <VotingResultsPanel
          results={results}
          scaleValues={['3', '5']}
          isHost
          disabled={false}
          selectedEstimate={isChangingEstimate ? '5' : undefined}
          assignedValue="3"
          isChangingEstimate={isChangingEstimate}
          serviceScope={serviceScope}
          webAbsoluteUrl={undefined}
          onSelectEstimate={jest.fn()}
          onAssignEstimate={jest.fn()}
          onUndoReveal={jest.fn()}
          onStartChangingEstimate={onStartChangingEstimate}
          onCancelChangingEstimate={jest.fn()}
        />,
        container
      );
    };

    act(() => render(false));

    expect(container.textContent).toContain('Final estimate: 3');
    expect(container.querySelector('[aria-label="Select 5 as final estimate"]')).toBeNull();
    const changePoints = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Change points'
    );
    act(() => changePoints?.click());
    expect(onStartChangingEstimate).toHaveBeenCalledTimes(1);

    act(() => render(true));

    expect(container.querySelector('[aria-label="Select 5 as final estimate"]')).not.toBeNull();
    expect(container.textContent).toContain('Save points');
    expect(container.textContent).toContain('Cancel');
  });
});
