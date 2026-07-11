import * as React from 'react';
import * as ReactDom from 'react-dom';
import { act } from 'react-dom/test-utils';
import { axe } from 'jest-axe';
import 'jest-axe/extend-expect';
import { StoryCsvImportPanel } from './StoryCsvImportPanel';

let nextFileContent = '';

function renderPanel(element: React.ReactElement, container: HTMLDivElement): void {
  ReactDom.render(element, container);
}

async function chooseFile(input: HTMLInputElement, file: File, content: string): Promise<void> {
  nextFileContent = content;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 20));
}

describe('StoryCsvImportPanel', () => {
  let container: HTMLDivElement;
  let readAsText: jest.SpyInstance;

  beforeEach(() => {
    readAsText = jest.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (
      this: FileReader
    ): void {
      Object.defineProperty(this, 'result', { configurable: true, value: nextFileContent });
      this.onload?.(new ProgressEvent('load') as ProgressEvent<FileReader>);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDom.unmountComponentAtNode(container);
    container.remove();
    readAsText.mockRestore();
  });

  it('previews inert rows, reports validation, and remains accessible', async () => {
    await act(async () => {
      renderPanel(
        <StoryCsvImportPanel
          isOpen
          onImport={jest.fn()}
          onImported={jest.fn()}
          onDismiss={jest.fn()}
        />,
        container
      );
    });
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await act(async () => {
      await chooseFile(
        input as HTMLInputElement,
        new File(
          ['Title,Description,Link\n,"<script>alert(1)</script>",javascript:alert(1)'],
          'stories.csv',
          { type: 'text/csv' }
        ),
        'Title,Description,Link\n,"<script>alert(1)</script>",javascript:alert(1)'
      );
    });

    expect(document.body.textContent).toContain('Invalid: 1');
    expect(document.body.textContent).toContain('<script>alert(1)</script>');
    expect(document.body.querySelector('script')).toBeNull();
    const confirm = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Import 0 stories')
    );
    expect(confirm?.disabled).toBe(true);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('confirms an all-valid preview and recovers from a save failure', async () => {
    const onImport = jest
      .fn()
      .mockResolvedValueOnce({
        isSaved: false,
        fieldErrors: {},
        message: 'Connection unavailable.'
      })
      .mockResolvedValueOnce({ isSaved: true });
    const onImported = jest.fn();
    await act(async () => {
      renderPanel(
        <StoryCsvImportPanel
          isOpen
          onImport={onImport}
          onImported={onImported}
          onDismiss={jest.fn()}
        />,
        container
      );
    });
    const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
    await act(async () => {
      await chooseFile(
        input as HTMLInputElement,
        new File(['Title,Description,Link\nFirst,Details,'], 'stories.csv', {
          type: 'text/csv'
        }),
        'Title,Description,Link\nFirst,Details,'
      );
    });
    const confirm = (): HTMLButtonElement | undefined =>
      Array.from(document.body.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Import 1 stories')
      );
    await act(async () => {
      confirm()?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Connection unavailable.');
    expect(onImported).not.toHaveBeenCalled();
    await act(async () => {
      confirm()?.click();
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });
    expect(onImported).toHaveBeenCalledWith(1);
  });
});
