import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Label } from '@fluentui/react/lib/Label';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import { TextField } from '@fluentui/react/lib/TextField';
import type { PointingStory, UserReference } from '../domain/planningPokerDomain';
import { validateStoryForm } from './storyManagement';
import type { StoryFormErrors, StoryFormValues, StoryMutationResult } from './storyManagement';
import { formatStoryTimestamp } from './storyPresentation';
import styles from './StoryFormPanel.module.scss';

/** Controlled properties for the story create/edit panel. */
export interface IStoryFormPanelProps {
  readonly isOpen: boolean;
  readonly story?: PointingStory;
  readonly currentUser: UserReference;
  readonly initialValues: StoryFormValues;
  readonly panelLayerHostId?: string;
  readonly onSave: (values: StoryFormValues) => Promise<StoryMutationResult>;
  readonly onDismiss: () => void;
}

/**
 * Renders safe editable story content and read-only system audit values.
 *
 * @param props - Controlled story draft and persistence callbacks.
 * @returns The story editor panel.
 */
export function StoryFormPanel(props: IStoryFormPanelProps): React.ReactElement {
  const [values, setValues] = React.useState(props.initialValues);
  const [errors, setErrors] = React.useState<StoryFormErrors>({});
  const [message, setMessage] = React.useState<string>();
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (props.isOpen) {
      setValues(props.initialValues);
      setErrors({});
      setMessage(undefined);
      setIsSaving(false);
    }
  }, [props.initialValues, props.isOpen]);

  const save = async (): Promise<void> => {
    const fieldErrors = validateStoryForm(values);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setMessage('Review the highlighted story fields before saving.');
      return;
    }
    setIsSaving(true);
    setErrors({});
    setMessage(undefined);
    const result = await props.onSave(values);
    if (!result.isSaved) {
      setErrors(result.fieldErrors);
      setMessage(result.message ?? 'Review the highlighted story fields before saving.');
      setIsSaving(false);
    }
  };

  return (
    <Panel
      isOpen={props.isOpen}
      type={PanelType.smallFixedFar}
      headerText={props.story === undefined ? 'Add story' : 'Edit story'}
      closeButtonAriaLabel="Close story editor"
      isBlocking
      isFooterAtBottom
      layerProps={
        props.panelLayerHostId === undefined ? undefined : { hostId: props.panelLayerHostId }
      }
      onDismiss={isSaving ? undefined : props.onDismiss}
      onRenderFooterContent={() => (
        <div className={styles.footer}>
          <PrimaryButton disabled={isSaving} onClick={save}>
            {isSaving ? 'Saving...' : 'Save story'}
          </PrimaryButton>
          <DefaultButton disabled={isSaving} onClick={props.onDismiss}>
            Cancel
          </DefaultButton>
        </div>
      )}
    >
      <div className={styles.body}>
        {message !== undefined && (
          <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
            {message}
          </MessageBar>
        )}
        <TextField
          label="Title"
          required
          disabled={isSaving}
          value={values.title}
          errorMessage={errors.title}
          onChange={(_event, value) => setValues({ ...values, title: value ?? '' })}
        />
        <TextField
          label="Description"
          multiline
          rows={6}
          disabled={isSaving}
          value={values.description}
          onChange={(_event, value) => setValues({ ...values, description: value ?? '' })}
        />
        <TextField
          label="Link"
          type="url"
          disabled={isSaving}
          value={values.link}
          errorMessage={errors.link}
          description="Use an HTTPS URL or a SharePoint-relative path beginning with /."
          onChange={(_event, value) => setValues({ ...values, link: value ?? '' })}
        />
        <div className={styles.audit} aria-label="Story audit information">
          <Label>Added by</Label>
          <span>{props.story?.createdBy.displayName ?? props.currentUser.displayName}</span>
          <Label>Added on</Label>
          <span>
            {props.story === undefined
              ? 'Set when saved'
              : formatStoryTimestamp(props.story.createdAt)}
          </span>
        </div>
      </div>
    </Panel>
  );
}
