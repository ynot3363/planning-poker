import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { VotingTimerPanel } from './VotingTimerPanel';

/**
 * Pairs test rendering with the suite-owned unmount boundary.
 *
 * @param element - Timer element under test.
 * @param container - Test DOM host.
 */
function renderTimer(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('VotingTimerPanel', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
    jest.useRealTimers();
  });

  it('renders enabled host start controls and disables a redundant reset', () => {
    const onStart = jest.fn();
    act(() => {
      renderTimer(
        <VotingTimerPanel
          timer={{ configuredDurationSeconds: 60, status: 'Ready', remainingSeconds: 60 }}
          isHost
          disabled={false}
          onStart={onStart}
          onStop={jest.fn()}
          onReset={jest.fn()}
        />,
        container
      );
    });
    const buttons = Array.from(container.querySelectorAll('button'));
    const start = buttons.find((button) => button.textContent === 'Start');
    const reset = buttons.find((button) => button.textContent === 'Reset');

    act(() => start?.click());

    expect(container.querySelector('[aria-label="60 seconds remaining"]')).not.toBeNull();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(reset?.disabled).toBe(true);
  });

  it('ticks read-only participant time and announces expiration without adding commands', () => {
    act(() => {
      renderTimer(
        <VotingTimerPanel
          timer={{
            configuredDurationSeconds: 5,
            status: 'Running',
            remainingSeconds: 5,
            startedAt: '2026-07-11T12:00:00.000Z'
          }}
          isHost={false}
          disabled={false}
          onStart={jest.fn()}
          onStop={jest.fn()}
          onReset={jest.fn()}
        />,
        container
      );
    });

    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(container.querySelector('[role="status"]')).toBeNull();
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    expect(container.querySelector('[aria-label="0 seconds remaining"]')).not.toBeNull();
    expect(container.textContent).toContain('Time expired. Voting remains open.');
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      'Voting remains open'
    );
  });

  it('disables host commands while collaboration actions are unavailable', () => {
    act(() => {
      renderTimer(
        <VotingTimerPanel
          timer={{
            configuredDurationSeconds: 60,
            status: 'Running',
            remainingSeconds: 60,
            startedAt: '2026-07-11T12:00:00.000Z'
          }}
          isHost
          disabled
          onStart={jest.fn()}
          onStop={jest.fn()}
          onReset={jest.fn()}
        />,
        container
      );
    });

    expect(
      Array.from(container.querySelectorAll('button')).every((button) => button.disabled)
    ).toBe(true);
  });
});
