import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { DefaultButton } from '@fluentui/react/lib/Button';
import {
  CommandArea,
  ContentCard,
  DestructiveConfirmation,
  PageHeading,
  StatusState
} from './ShellPrimitives';

function renderPrimitives(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

describe('ShellPrimitives', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
  });

  it('composes headings, command areas, cards, and status states', () => {
    act(() => {
      renderPrimitives(
        <React.Fragment>
          <PageHeading
            id="example-heading"
            title="Example"
            description="Supporting guidance"
            actions={<DefaultButton onClick={jest.fn()}>Supporting action</DefaultButton>}
          />
          <CommandArea label="Example commands">
            <DefaultButton onClick={jest.fn()}>Command</DefaultButton>
          </CommandArea>
          <ContentCard label="Example card" tone="success">
            Card content
          </ContentCard>
          <StatusState kind="loading" title="Loading teams" description="Please wait." />
          <StatusState kind="error" title="Unable to load" description="Try again." />
        </React.Fragment>,
        container
      );
    });

    expect(container.querySelector('#example-heading')?.textContent).toBe('Example');
    expect(container.querySelector('[aria-label="Example commands"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Example card"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load');
  });

  it('requires explicit confirmation for destructive actions', () => {
    const onConfirm = jest.fn();
    const onDismiss = jest.fn();
    act(() => {
      renderPrimitives(
        <DestructiveConfirmation
          isOpen
          title="Delete team?"
          message="This sends the team to the recycle bin."
          confirmLabel="Delete team"
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />,
        container
      );
    });

    const buttons = Array.from(document.body.querySelectorAll('button'));
    act(() => buttons.find((button) => button.textContent?.includes('Delete team'))?.click());
    act(() => buttons.find((button) => button.textContent?.includes('Cancel'))?.click());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
