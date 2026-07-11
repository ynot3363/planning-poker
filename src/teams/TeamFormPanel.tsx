import * as React from 'react';
import { DefaultButton, IconButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { ChoiceGroup } from '@fluentui/react/lib/ChoiceGroup';
import type { IChoiceGroupOption } from '@fluentui/react/lib/ChoiceGroup';
import { Dropdown } from '@fluentui/react/lib/Dropdown';
import type { IDropdownOption } from '@fluentui/react/lib/Dropdown';
import { Label } from '@fluentui/react/lib/Label';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Panel, PanelType } from '@fluentui/react/lib/Panel';
import type { IPersonaProps } from '@fluentui/react/lib/Persona';
import { NormalPeoplePicker } from '@fluentui/react/lib/Pickers';
import { SpinButton } from '@fluentui/react/lib/SpinButton';
import { TextField } from '@fluentui/react/lib/TextField';
import { Toggle } from '@fluentui/react/lib/Toggle';
import type { UserReference } from '../domain/planningPokerDomain';
import type { HostedTeamSummary } from '../repository/teamRepository';
import { createTeamSettings, validateTeamForm } from './teamForm';
import type { TeamFormErrors, TeamFormValues } from './teamForm';
import type { TeamSaveResult } from './teamManagementService';
import type { IPlanningPokerPeopleService } from './sharePointPeopleService';
import styles from './TeamFormPanel.module.scss';

interface IUserPersona extends IPersonaProps {
  readonly user: UserReference;
}

/** Defines the controlled team create/edit panel. */
export interface ITeamFormPanelProps {
  /** Whether the panel is visible. */
  readonly isOpen: boolean;
  /** Whether the draft edits an existing team. */
  readonly isEditing: boolean;
  /** Initial draft values supplied when the panel opens. */
  readonly initialValues: TeamFormValues;
  /** Current summaries used for title uniqueness. */
  readonly existingTeams: readonly HostedTeamSummary[];
  /** SharePoint people resolver used by host and member pickers. */
  readonly peopleService: IPlanningPokerPeopleService;
  /** Saves a validated team draft. */
  readonly onSave: (values: TeamFormValues) => Promise<TeamSaveResult>;
  /** Cancels editing and releases any loaded document. */
  readonly onDismiss: () => void;
  /** Optional shell-local Fluent UI layer host for the panel portal. */
  readonly panelLayerHostId?: string;
}

const SCALE_OPTIONS: readonly IDropdownOption[] = [
  { key: 'Fibonacci', text: 'Fibonacci' },
  { key: 'TShirt', text: 'T-shirt sizes' },
  { key: 'Custom', text: 'Custom' }
];

const VOTING_OPTIONS: readonly IChoiceGroupOption[] = [
  {
    key: 'Named',
    text: 'Named',
    ariaLabel: 'Named voting. Participant identities are visible after reveal.'
  },
  {
    key: 'Anonymous',
    text: 'Anonymous',
    ariaLabel: 'Anonymous voting. Generated participant aliases are shown instead of identities.'
  }
];

/**
 * Renders an accessible team create/edit panel with people and settings controls.
 *
 * @param props - Draft state dependencies and persistence callbacks.
 * @returns The team form panel.
 */
export function TeamFormPanel(props: ITeamFormPanelProps): React.ReactElement {
  const nextCustomValueKey = React.useRef(0);
  const [values, setValues] = React.useState(props.initialValues);
  const [customValueKeys, setCustomValueKeys] = React.useState<readonly string[]>(() =>
    props.initialValues.customScaleValues.map(() => `custom-scale-${nextCustomValueKey.current++}`)
  );
  const [errors, setErrors] = React.useState<TeamFormErrors>({});
  const [message, setMessage] = React.useState<string>();
  const [isSaving, setIsSaving] = React.useState(false);
  const [peopleError, setPeopleError] = React.useState<string>();

  React.useEffect(() => {
    if (props.isOpen) {
      setValues(props.initialValues);
      setCustomValueKeys(
        props.initialValues.customScaleValues.map(
          () => `custom-scale-${nextCustomValueKey.current++}`
        )
      );
      setErrors({});
      setMessage(undefined);
      setPeopleError(undefined);
      setIsSaving(false);
    }
  }, [props.initialValues, props.isOpen]);

  const updateValues = (next: Partial<TeamFormValues>): void => {
    setValues((current) => ({ ...current, ...next }));
  };

  const resolvePeople = async (
    query: string,
    selectedItems?: IPersonaProps[]
  ): Promise<IPersonaProps[]> => {
    try {
      const selected = new Set((selectedItems ?? []).map((item) => String(item.key)));
      const people = await props.peopleService.search(query);
      setPeopleError(undefined);
      return people.filter((person) => !selected.has(person.objectId)).map(toPersona);
    } catch {
      setPeopleError('People could not be resolved. Check the SharePoint connection and retry.');
      return [];
    }
  };

  const handleSave = async (): Promise<void> => {
    const fieldErrors = validateTeamForm(values, props.existingTeams);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      setMessage('Review the highlighted fields before saving.');
      return;
    }
    setIsSaving(true);
    setErrors({});
    setMessage(undefined);
    const result = await props.onSave(values);
    if (!result.isSaved) {
      setErrors(result.fieldErrors);
      setMessage(result.message ?? 'Review the highlighted fields before saving.');
      setIsSaving(false);
    }
  };

  const updateCustomValue = (index: number, value: string): void => {
    const customScaleValues = [...values.customScaleValues];
    customScaleValues[index] = value;
    updateValues({ customScaleValues });
  };

  const moveCustomValue = (index: number, direction: -1 | 1): void => {
    const destination = index + direction;
    if (destination < 0 || destination >= values.customScaleValues.length) {
      return;
    }
    const customScaleValues = [...values.customScaleValues];
    const keys = [...customValueKeys];
    const value = customScaleValues[index];
    customScaleValues[index] = customScaleValues[destination];
    customScaleValues[destination] = value;
    const key = keys[index];
    keys[index] = keys[destination];
    keys[destination] = key;
    setCustomValueKeys(keys);
    updateValues({ customScaleValues });
  };

  const removeCustomValue = (index: number): void => {
    setCustomValueKeys(customValueKeys.filter((_key, keyIndex) => keyIndex !== index));
    updateValues({
      customScaleValues: values.customScaleValues.filter(
        (_value, valueIndex) => valueIndex !== index
      )
    });
  };

  const settings = createTeamSettings(values);
  return (
    <Panel
      isOpen={props.isOpen}
      type={PanelType.smallFixedFar}
      headerText={props.isEditing ? 'Edit team' : 'New team'}
      closeButtonAriaLabel="Close team editor"
      isBlocking
      isFooterAtBottom
      layerProps={
        props.panelLayerHostId === undefined ? undefined : { hostId: props.panelLayerHostId }
      }
      onDismiss={isSaving ? undefined : props.onDismiss}
      onRenderFooterContent={() => (
        <div className={styles.footer}>
          <PrimaryButton disabled={isSaving} onClick={handleSave}>
            {isSaving ? 'Saving...' : 'Save team'}
          </PrimaryButton>
          <DefaultButton disabled={isSaving} onClick={props.onDismiss}>
            Cancel
          </DefaultButton>
        </div>
      )}
    >
      <div className={styles.panelBody}>
        {message !== undefined && (
          <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
            {message}
          </MessageBar>
        )}
        <fieldset className={styles.section} disabled={isSaving}>
          <legend>Team details</legend>
          <TextField
            label="Title"
            required
            value={values.title}
            errorMessage={errors.title}
            onChange={(_event, value) => updateValues({ title: value ?? '' })}
          />
          <TextField
            label="Description"
            multiline
            rows={3}
            value={values.description}
            onChange={(_event, value) => updateValues({ description: value ?? '' })}
          />
          <Toggle
            label="Team activity"
            checked={values.isActive}
            onText="Active"
            offText="Inactive"
            onChange={(_event, checked) => updateValues({ isActive: checked === true })}
          />
        </fieldset>

        <fieldset className={styles.section} disabled={isSaving}>
          <legend>People</legend>
          <div>
            <Label required>Hosts</Label>
            <NormalPeoplePicker
              selectedItems={values.hosts.map(toPersona)}
              onResolveSuggestions={resolvePeople}
              getTextFromItem={(item) => item.text ?? ''}
              inputProps={{ 'aria-label': 'Search and select team hosts' }}
              pickerSuggestionsProps={{
                suggestionsHeaderText: 'Suggested people',
                noResultsFoundText: 'No people found'
              }}
              onChange={(items) => {
                const hosts = fromPersonas(items);
                if (hosts.length === 0) {
                  setErrors((current) => ({ ...current, hosts: 'Select at least one host.' }));
                  return;
                }
                updateValues({ hosts });
                setErrors((current) => ({ ...current, hosts: undefined }));
              }}
            />
            {errors.hosts !== undefined && (
              <div className={styles.pickerError} role="alert">
                {errors.hosts}
              </div>
            )}
          </div>
          <div>
            <Label>Configured members</Label>
            <NormalPeoplePicker
              selectedItems={values.configuredMembers.map(toPersona)}
              onResolveSuggestions={resolvePeople}
              getTextFromItem={(item) => item.text ?? ''}
              inputProps={{ 'aria-label': 'Search and select configured team members' }}
              pickerSuggestionsProps={{
                suggestionsHeaderText: 'Suggested people',
                noResultsFoundText: 'No people found'
              }}
              onChange={(items) => updateValues({ configuredMembers: fromPersonas(items) })}
            />
            {errors.configuredMembers !== undefined && (
              <div className={styles.pickerError} role="alert">
                {errors.configuredMembers}
              </div>
            )}
          </div>
          {peopleError !== undefined && (
            <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
              {peopleError}
            </MessageBar>
          )}
        </fieldset>

        <fieldset className={styles.section} disabled={isSaving}>
          <legend>Voting defaults</legend>
          <Dropdown
            label="Point scale"
            selectedKey={values.scaleKind}
            options={[...SCALE_OPTIONS]}
            onChange={(_event, option) => {
              if (option !== undefined) {
                updateValues({ scaleKind: option.key as TeamFormValues['scaleKind'] });
              }
            }}
          />
          {values.scaleKind === 'Custom' ? (
            <React.Fragment>
              <ul className={styles.customScaleList} aria-label="Custom scale values">
                {values.customScaleValues.map((value, index) => (
                  <li className={styles.customScaleItem} key={customValueKeys[index]}>
                    <TextField
                      className={styles.customScaleField}
                      label={`Custom value ${index + 1}`}
                      value={value}
                      onChange={(_event, nextValue) => updateCustomValue(index, nextValue ?? '')}
                    />
                    <IconButton
                      iconProps={{ iconName: 'ChevronUp' }}
                      ariaLabel={`Move custom value ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveCustomValue(index, -1)}
                    />
                    <IconButton
                      iconProps={{ iconName: 'ChevronDown' }}
                      ariaLabel={`Move custom value ${index + 1} down`}
                      disabled={index === values.customScaleValues.length - 1}
                      onClick={() => moveCustomValue(index, 1)}
                    />
                    <IconButton
                      iconProps={{ iconName: 'Delete' }}
                      ariaLabel={`Remove custom value ${index + 1}`}
                      onClick={() => removeCustomValue(index)}
                    />
                  </li>
                ))}
              </ul>
              <DefaultButton
                iconProps={{ iconName: 'Add' }}
                disabled={values.customScaleValues.length >= 20}
                onClick={() => {
                  setCustomValueKeys([
                    ...customValueKeys,
                    `custom-scale-${nextCustomValueKey.current++}`
                  ]);
                  updateValues({ customScaleValues: [...values.customScaleValues, ''] });
                }}
              >
                Add scale value
              </DefaultButton>
            </React.Fragment>
          ) : (
            <p className={styles.scalePreview}>Values: {settings.scaleValues.join(', ')}</p>
          )}
          {errors.scaleValues !== undefined && (
            <div className={styles.pickerError} role="alert">
              {errors.scaleValues}
            </div>
          )}
          <Toggle
            label="Voting timer"
            checked={values.timerEnabled}
            onText="Enabled"
            offText="Disabled"
            onChange={(_event, checked) =>
              updateValues({
                timerEnabled: checked === true,
                timerDurationMinutes:
                  checked === true ? (values.timerDurationMinutes ?? 5) : undefined
              })
            }
          />
          {values.timerEnabled && (
            <SpinButton
              label="Timer duration in minutes"
              min={1}
              max={60}
              step={1}
              value={String(values.timerDurationMinutes ?? '')}
              onChange={(_event, value) =>
                updateValues({
                  timerDurationMinutes: value === undefined ? undefined : Number(value)
                })
              }
            />
          )}
          {errors.timerDurationMinutes !== undefined && (
            <div className={styles.pickerError} role="alert">
              {errors.timerDurationMinutes}
            </div>
          )}
          <ChoiceGroup
            label="Vote visibility"
            selectedKey={values.votingMode}
            options={[...VOTING_OPTIONS]}
            onChange={(_event, option) => {
              if (option !== undefined) {
                updateValues({ votingMode: option.key as TeamFormValues['votingMode'] });
              }
            }}
          />
          <p className={styles.scalePreview}>
            {values.votingMode === 'Named'
              ? 'Participant identities are visible with votes after reveal.'
              : 'Generated participant aliases are shown instead of identities.'}
          </p>
        </fieldset>
      </div>
    </Panel>
  );
}

/**
 * @param user - The stable user reference represented by the picker item.
 * @returns A picker persona that retains its stable user reference.
 */
function toPersona(user: UserReference): IUserPersona {
  return {
    key: user.objectId,
    text: user.displayName,
    secondaryText: user.loginName,
    user
  };
}

/**
 * @param items - The selected Fluent UI picker personas.
 * @returns Stable user references retained by selected picker personas.
 */
function fromPersonas(items?: readonly IPersonaProps[]): readonly UserReference[] {
  return (items ?? [])
    .filter((item): item is IUserPersona => 'user' in item)
    .map((item) => item.user);
}
