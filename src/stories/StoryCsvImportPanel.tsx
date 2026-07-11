import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import type { StoryFormValues, StoryMutationResult } from './storyManagement';
import { parseStoryCsv, validateStoryCsvFile } from './storyCsvImport';
import type { StoryCsvPreview } from './storyCsvImport';
import styles from './StoryCsvImportPanel.module.scss';

/** Properties for the local-only CSV upload and preview workflow. */
export interface IStoryCsvImportPanelProps {
  readonly isOpen: boolean;
  readonly panelLayerHostId?: string;
  readonly onImport: (rows: readonly StoryFormValues[]) => Promise<StoryMutationResult>;
  readonly onImported: (count: number) => void;
  readonly onDismiss: () => void;
}

/**
 * Renders defensive file selection, validation preview, and atomic confirmation.
 *
 * @param props - Local file workflow callbacks and shell layer context.
 * @returns The accessible CSV import panel.
 */
export function StoryCsvImportPanel(props: IStoryCsvImportPanelProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const readerRef = React.useRef<FileReader>();
  const [preview, setPreview] = React.useState<StoryCsvPreview>();
  const [fileErrors, setFileErrors] = React.useState<readonly string[]>([]);
  const [isReading, setIsReading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string>();

  const reset = React.useCallback((): void => {
    if (readerRef.current?.readyState === FileReader.LOADING) {
      readerRef.current.abort();
    }
    readerRef.current = undefined;
    setPreview(undefined);
    setFileErrors([]);
    setMessage(undefined);
    setIsReading(false);
    setIsSaving(false);
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  }, []);

  React.useEffect(() => {
    if (props.isOpen) {
      reset();
    }
    return reset;
  }, [props.isOpen, reset]);

  const selectFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    setPreview(undefined);
    setMessage(undefined);
    if (file === undefined) {
      setFileErrors([]);
      return;
    }
    const errors = validateStoryCsvFile(file);
    setFileErrors(errors);
    if (errors.length > 0) {
      event.currentTarget.value = '';
      return;
    }
    setIsReading(true);
    const reader = new FileReader();
    readerRef.current = reader;
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? parseStoryCsv(reader.result) : undefined;
      if (result === undefined) {
        setFileErrors(['The CSV file could not be read as UTF-8 text.']);
      } else {
        setPreview(result);
        setFileErrors(result.fileErrors);
      }
      readerRef.current = undefined;
      setIsReading(false);
    };
    reader.onerror = () => {
      setFileErrors(['The CSV file could not be read. Choose it again and retry.']);
      readerRef.current = undefined;
      setIsReading(false);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const confirmImport = async (): Promise<void> => {
    if (preview === undefined || preview.invalidCount > 0 || preview.fileErrors.length > 0) {
      return;
    }
    setIsSaving(true);
    setMessage(undefined);
    const result = await props.onImport(preview.rows.map((row) => row.values));
    if (result.isSaved) {
      const count = preview.rows.length;
      reset();
      props.onImported(count);
    } else {
      setMessage(result.message ?? 'No stories were imported. Try again.');
      setIsSaving(false);
    }
  };

  const canImport =
    preview !== undefined &&
    preview.rows.length > 0 &&
    preview.invalidCount === 0 &&
    preview.fileErrors.length === 0 &&
    !isReading &&
    !isSaving;

  return (
    <Panel
      isOpen={props.isOpen}
      type={PanelType.medium}
      headerText="Import stories from CSV"
      closeButtonAriaLabel="Close story import"
      isBlocking
      isFooterAtBottom
      layerProps={
        props.panelLayerHostId === undefined ? undefined : { hostId: props.panelLayerHostId }
      }
      onDismiss={isSaving ? undefined : props.onDismiss}
      onRenderFooterContent={() => (
        <div className={styles.footer}>
          <PrimaryButton disabled={!canImport} onClick={confirmImport}>
            {isSaving ? 'Importing...' : `Import ${preview?.validCount ?? 0} stories`}
          </PrimaryButton>
          <DefaultButton disabled={isSaving} onClick={props.onDismiss}>
            Cancel
          </DefaultButton>
        </div>
      )}
    >
      <div className={styles.body}>
        <p>
          Choose a UTF-8 .csv file up to 5 MB and 1,000 data rows. Uploaded content stays in this
          browser and is treated as plain text.
        </p>
        <label className={styles.fileLabel} htmlFor="planning-poker-story-csv">
          CSV file
        </label>
        <input
          ref={inputRef}
          id="planning-poker-story-csv"
          type="file"
          accept=".csv,text/csv"
          disabled={isReading || isSaving}
          onChange={selectFile}
        />
        {isReading && <p role="status">Reading and validating CSV...</p>}
        {fileErrors.length > 0 && (
          <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
            <ul>
              {fileErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </MessageBar>
        )}
        {message !== undefined && (
          <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
            {message}
          </MessageBar>
        )}
        {preview !== undefined && preview.fileErrors.length === 0 && (
          <React.Fragment>
            <div className={styles.summary} role="status" aria-live="polite">
              <span>Valid: {preview.validCount}</span>
              <span>Invalid: {preview.invalidCount}</span>
              <span>Warnings: {preview.warningCount}</span>
            </div>
            <div className={styles.tableRegion} role="region" aria-label="CSV story preview">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Title</th>
                    <th scope="col">Description</th>
                    <th scope="col">Link</th>
                    <th scope="col">Validation</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const feedback = [
                      row.errors.title,
                      row.errors.link,
                      row.errors.row,
                      ...row.warnings
                    ].filter((value): value is string => value !== undefined);
                    return (
                      <tr key={row.rowNumber}>
                        <th scope="row">{row.rowNumber}</th>
                        <td>{row.values.title}</td>
                        <td>{row.values.description}</td>
                        <td>{row.values.link}</td>
                        <td>{feedback.length === 0 ? 'Valid' : feedback.join(' ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </React.Fragment>
        )}
      </div>
    </Panel>
  );
}
