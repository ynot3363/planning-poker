import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Dialog, DialogFooter, DialogType } from '@fluentui/react/lib/Dialog';
import { Dropdown } from '@fluentui/react/lib/Dropdown';
import type { IDropdownOption } from '@fluentui/react/lib/Dropdown';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Pivot, PivotItem } from '@fluentui/react/lib/Pivot';
import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryStatus,
  UserReference
} from '../domain/planningPokerDomain';
import type { HostedTeamSummary } from '../repository/teamRepository';
import { ContentCard, StatusState } from '../shell/ShellPrimitives';
import { StoryFormPanel } from './StoryFormPanel';
import { StoryCsvImportPanel } from './StoryCsvImportPanel';
import { createStoryCsvTemplate } from './storyCsvImport';
import {
  createInitialStoryForm,
  createStoryFormFromStory,
  isStoryInOpenRound
} from './storyManagement';
import type {
  IStoryManagementService,
  StoryFormValues,
  StoryMutationResult,
  StoryTeamSession
} from './storyManagement';
import { formatStoryTimestamp } from './storyPresentation';
import styles from './StoriesPage.module.scss';

/** Dependencies and route state for the Stories destination. */
export interface IStoriesPageProps {
  readonly currentUser: UserReference;
  readonly service: IStoryManagementService;
  readonly selectedTeamId?: string;
  readonly panelLayerHostId?: string;
  readonly onSelectTeam: (teamId?: string) => void;
  readonly onNavigateTeams: () => void;
}

type StoryLoadState = 'loading-teams' | 'select-team' | 'loading-stories' | 'ready' | 'error';
const STATUSES: readonly StoryStatus[] = ['Ready', 'Pointed', 'Archived'];

/**
 * Renders hosted-team selection and the complete Ready/Pointed/Archived story lifecycle.
 *
 * @param props - Hosted story service, route state, and navigation callbacks.
 * @returns The Stories destination.
 */
export function StoriesPage(props: IStoriesPageProps): React.ReactElement {
  const [teams, setTeams] = React.useState<readonly HostedTeamSummary[]>([]);
  const [session, setSession] = React.useState<StoryTeamSession>();
  const [document, setDocument] = React.useState<PlanningPokerDocumentRoot>();
  const [loadState, setLoadState] = React.useState<StoryLoadState>('loading-teams');
  const [status, setStatus] = React.useState<StoryStatus>('Ready');
  const [editorStory, setEditorStory] = React.useState<PointingStory>();
  const [editorValues, setEditorValues] = React.useState(() => createInitialStoryForm());
  const [isEditorOpen, setIsEditorOpen] = React.useState(false);
  const [isImportOpen, setIsImportOpen] = React.useState(false);
  const [archiveTarget, setArchiveTarget] = React.useState<PointingStory>();
  const [deleteTarget, setDeleteTarget] = React.useState<PointingStory>();
  const [message, setMessage] = React.useState<string>();
  const [successMessage, setSuccessMessage] = React.useState<string>();
  const [busyStoryId, setBusyStoryId] = React.useState<string>();
  const defaultedTeamId = React.useRef<string>();
  const addStoryButtonRef = React.useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = React.useRef<HTMLButtonElement>();

  React.useEffect(() => {
    let isCurrent = true;
    setLoadState('loading-teams');
    props.service.listTeams().then(
      (items) => {
        if (isCurrent) {
          setTeams(items);
          setLoadState(items.length === 0 ? 'select-team' : 'loading-stories');
        }
      },
      () => {
        if (isCurrent) {
          setLoadState('error');
        }
      }
    );
    return () => {
      isCurrent = false;
    };
  }, [props.service]);

  const selectedTeamId = props.selectedTeamId ?? teams[0]?.teamId;

  React.useEffect(() => {
    if (props.selectedTeamId !== undefined) {
      defaultedTeamId.current = undefined;
      return;
    }
    const firstTeamId = teams[0]?.teamId;
    if (firstTeamId !== undefined && defaultedTeamId.current !== firstTeamId) {
      defaultedTeamId.current = firstTeamId;
      props.onSelectTeam(firstTeamId);
    }
  }, [props.onSelectTeam, props.selectedTeamId, teams]);

  React.useEffect(() => {
    const selected = teams.find((team) => team.teamId === selectedTeamId);
    if (selected === undefined) {
      setSession(undefined);
      setDocument(undefined);
      if (teams.length > 0) {
        setLoadState('select-team');
      }
      return undefined;
    }
    let isCurrent = true;
    let opened: StoryTeamSession | undefined;
    let unsubscribe: (() => void) | undefined;
    setLoadState('loading-stories');
    props.service.openTeam(selected).then(
      (nextSession) => {
        if (!isCurrent) {
          props.service.closeTeam(nextSession);
          return;
        }
        opened = nextSession;
        setSession(nextSession);
        setDocument(nextSession.getDocument());
        unsubscribe = props.service.subscribe(nextSession, setDocument);
        setLoadState('ready');
      },
      () => {
        if (isCurrent) {
          setLoadState('error');
        }
      }
    );
    return () => {
      isCurrent = false;
      unsubscribe?.();
      if (opened !== undefined) {
        props.service.closeTeam(opened);
      }
    };
  }, [props.service, selectedTeamId, teams]);

  const openAdd = (): void => {
    setEditorStory(undefined);
    setEditorValues(createInitialStoryForm());
    setMessage(undefined);
    setSuccessMessage(undefined);
    setIsEditorOpen(true);
  };
  const openEdit = (story: PointingStory): void => {
    setEditorStory(story);
    setEditorValues(createStoryFormFromStory(story));
    setMessage(undefined);
    setSuccessMessage(undefined);
    setIsEditorOpen(true);
  };
  const dismissEditor = (): void => {
    setIsEditorOpen(false);
    setEditorStory(undefined);
  };
  const saveStory = async (values: StoryFormValues): Promise<StoryMutationResult> => {
    if (session === undefined) {
      return {
        isSaved: false,
        fieldErrors: {},
        code: 'save-failure',
        message: 'Select a hosted team before saving a story.'
      };
    }
    const result =
      editorStory === undefined
        ? await props.service.createStory(session, values)
        : await props.service.editStory(session, editorStory.id, values);
    if (result.isSaved) {
      setDocument(session.getDocument());
      dismissEditor();
    }
    return result;
  };

  const runStatusCommand = async (
    story: PointingStory,
    command: 'archive' | 'restore' | 'repoint'
  ): Promise<void> => {
    if (session === undefined) {
      return;
    }
    setBusyStoryId(story.id);
    setMessage(undefined);
    const result =
      command === 'archive'
        ? await props.service.archiveStory(session, story.id)
        : command === 'restore'
          ? await props.service.restoreStory(session, story.id)
          : await props.service.repointStory(session, story.id);
    if (result.isSaved) {
      setDocument(session.getDocument());
      setArchiveTarget(undefined);
    } else {
      setMessage(result.message ?? 'The story could not be changed. Try again.');
    }
    setBusyStoryId(undefined);
  };

  const openDeleteConfirmation = (story: PointingStory, trigger: HTMLButtonElement): void => {
    deleteTriggerRef.current = trigger;
    setMessage(undefined);
    setSuccessMessage(undefined);
    setDeleteTarget(story);
  };

  const cancelDelete = (): void => {
    setDeleteTarget(undefined);
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  };

  const confirmDelete = async (): Promise<void> => {
    if (session === undefined || deleteTarget === undefined) {
      return;
    }
    setBusyStoryId(deleteTarget.id);
    setMessage(undefined);
    const result = await props.service.deleteStory(session, deleteTarget.id);
    if (result.isSaved) {
      const deletedTitle = deleteTarget.title;
      setDocument(session.getDocument());
      setDeleteTarget(undefined);
      setSuccessMessage(`${deletedTitle} was deleted.`);
      window.setTimeout(() => addStoryButtonRef.current?.focus(), 0);
    } else {
      setMessage(result.message ?? 'The story could not be deleted. Try again.');
    }
    setBusyStoryId(undefined);
  };

  const importStories = (values: readonly StoryFormValues[]): Promise<StoryMutationResult> => {
    if (session === undefined) {
      return Promise.resolve({
        isSaved: false,
        fieldErrors: {},
        code: 'save-failure',
        message: 'Select a hosted team before importing stories.'
      });
    }
    return props.service.importStories(session, values);
  };

  const downloadTemplate = (): void => {
    const url = URL.createObjectURL(
      new Blob([createStoryCsvTemplate()], { type: 'text/csv;charset=utf-8' })
    );
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = 'planning-poker-story-import-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const teamOptions: IDropdownOption[] = teams.map((team) => ({
    key: team.teamId,
    text: team.title
  }));
  const stories = document?.stories ?? [];
  const visibleStories = stories.filter((story) => story.status === status);

  if (loadState === 'loading-teams') {
    return (
      <StatusState kind="loading" title="Loading hosted teams" description="Preparing stories." />
    );
  }
  if (loadState === 'error') {
    return (
      <StatusState
        kind="error"
        title="Stories could not be loaded"
        description="Check the collaboration connection and select the team again."
      />
    );
  }
  if (teams.length === 0) {
    return (
      <StatusState
        kind="empty"
        title="Create a team before adding stories"
        description="Stories belong to a hosted team. Create a team first, then return here."
        action={<PrimaryButton onClick={props.onNavigateTeams}>Go to Teams</PrimaryButton>}
      />
    );
  }

  return (
    <section aria-label="Team stories">
      <div className={styles.commandRow}>
        <Dropdown
          className={styles.teamSelector}
          label="Hosted team"
          placeholder="Select a team"
          selectedKey={selectedTeamId}
          options={teamOptions}
          onChange={(_event, option) =>
            props.onSelectTeam(option === undefined ? undefined : String(option.key))
          }
        />
        <div className={styles.commandActions}>
          <DefaultButton
            iconProps={{ iconName: 'Download' }}
            disabled={session === undefined || loadState !== 'ready'}
            onClick={downloadTemplate}
          >
            Download template
          </DefaultButton>
          <DefaultButton
            iconProps={{ iconName: 'Upload' }}
            disabled={session === undefined || loadState !== 'ready'}
            onClick={() => setIsImportOpen(true)}
          >
            Upload CSV
          </DefaultButton>
          <PrimaryButton
            elementRef={addStoryButtonRef}
            iconProps={{ iconName: 'Add' }}
            disabled={session === undefined || loadState !== 'ready'}
            onClick={openAdd}
          >
            Add story
          </PrimaryButton>
        </div>
      </div>
      {message !== undefined && (
        <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
          {message}
        </MessageBar>
      )}
      {successMessage !== undefined && (
        <MessageBar messageBarType={MessageBarType.success} delayedRender={false}>
          {successMessage}
        </MessageBar>
      )}
      {loadState === 'select-team' && (
        <StatusState
          kind="empty"
          title="Select a hosted team"
          description="Choose a team to manage its Ready, Pointed, and Archived stories."
        />
      )}
      {loadState === 'loading-stories' && (
        <StatusState
          kind="loading"
          title="Loading stories"
          description="Opening the team catalog."
        />
      )}
      {loadState === 'ready' && document !== undefined && (
        <React.Fragment>
          <Pivot
            selectedKey={status}
            aria-label="Story status"
            onLinkClick={(item) => {
              if (item !== undefined) {
                setStatus(item.props.itemKey as StoryStatus);
              }
            }}
          >
            {STATUSES.map((storyStatus) => (
              <PivotItem
                key={storyStatus}
                itemKey={storyStatus}
                headerText={`${storyStatus} (${stories.filter((story) => story.status === storyStatus).length})`}
              />
            ))}
          </Pivot>
          {visibleStories.length === 0 ? (
            <ContentCard>
              <StatusState
                kind="empty"
                title={`No ${status.toLocaleLowerCase()} stories`}
                description={
                  status === 'Ready'
                    ? 'Add a story to prepare it for a future voting session.'
                    : `Stories moved to ${status} will appear here.`
                }
              />
            </ContentCard>
          ) : (
            <ul className={styles.storyList}>
              {visibleStories.map((story) => {
                const isBlocked = isStoryInOpenRound(document, story.id);
                return (
                  <li key={story.id}>
                    <ContentCard label={story.title}>
                      <article className={styles.storyCard}>
                        <div className={styles.storyHeading}>
                          <h2>{story.title}</h2>
                          <span className={styles.statusBadge}>{story.status}</span>
                        </div>
                        {story.description.length > 0 && <p>{story.description}</p>}
                        {story.link !== undefined && (
                          <a href={story.link} target="_blank" rel="noopener noreferrer">
                            Open story link
                          </a>
                        )}
                        {story.status === 'Pointed' && (
                          <p className={styles.estimate}>
                            Estimate: {story.currentEstimate ?? '—'}
                          </p>
                        )}
                        <p className={styles.audit}>
                          Added by {story.createdBy.displayName} on{' '}
                          {formatStoryTimestamp(story.createdAt)}
                        </p>
                        {isBlocked && (
                          <MessageBar messageBarType={MessageBarType.warning} delayedRender={false}>
                            This story is in an open voting round and cannot be changed yet.
                          </MessageBar>
                        )}
                        <div className={styles.storyActions}>
                          <DefaultButton
                            disabled={isBlocked || busyStoryId === story.id}
                            onClick={() => openEdit(story)}
                          >
                            Edit
                          </DefaultButton>
                          {(story.status === 'Ready' || story.status === 'Pointed') && (
                            <DefaultButton
                              disabled={isBlocked || busyStoryId === story.id}
                              onClick={() => setArchiveTarget(story)}
                            >
                              Archive
                            </DefaultButton>
                          )}
                          {story.status === 'Archived' && (
                            <DefaultButton
                              disabled={isBlocked || busyStoryId === story.id}
                              onClick={async () => runStatusCommand(story, 'restore')}
                            >
                              Restore to Ready
                            </DefaultButton>
                          )}
                          {story.status === 'Pointed' && (
                            <DefaultButton
                              disabled={isBlocked || busyStoryId === story.id}
                              onClick={async () => runStatusCommand(story, 'repoint')}
                            >
                              Re-point
                            </DefaultButton>
                          )}
                          <DefaultButton
                            className={styles.deleteAction}
                            disabled={isBlocked || busyStoryId === story.id}
                            onClick={(event) =>
                              openDeleteConfirmation(story, event.currentTarget as HTMLButtonElement)
                            }
                          >
                            Delete
                          </DefaultButton>
                        </div>
                      </article>
                    </ContentCard>
                  </li>
                );
              })}
            </ul>
          )}
        </React.Fragment>
      )}
      <StoryFormPanel
        isOpen={isEditorOpen}
        story={editorStory}
        currentUser={props.currentUser}
        initialValues={editorValues}
        panelLayerHostId={props.panelLayerHostId}
        onSave={saveStory}
        onDismiss={dismissEditor}
      />
      <StoryCsvImportPanel
        isOpen={isImportOpen}
        panelLayerHostId={props.panelLayerHostId}
        onImport={importStories}
        onImported={(count) => {
          if (session !== undefined) {
            setDocument(session.getDocument());
          }
          setStatus('Ready');
          setIsImportOpen(false);
          setMessage(undefined);
          setSuccessMessage(`${count} ${count === 1 ? 'story was' : 'stories were'} imported.`);
        }}
        onDismiss={() => setIsImportOpen(false)}
      />
      {archiveTarget !== undefined && (
        <Dialog
          hidden={false}
          dialogContentProps={{
            type: DialogType.normal,
            title: `Archive ${archiveTarget.title}?`,
            subText:
              'The story leaves the Ready and Pointed backlog but keeps its content and complete estimate history.'
          }}
          modalProps={{ isBlocking: true }}
          onDismiss={() => setArchiveTarget(undefined)}
        >
          <DialogFooter>
            <PrimaryButton
              disabled={busyStoryId === archiveTarget.id}
              onClick={async () => runStatusCommand(archiveTarget, 'archive')}
            >
              Archive story
            </PrimaryButton>
            <DefaultButton
              disabled={busyStoryId === archiveTarget.id}
              onClick={() => setArchiveTarget(undefined)}
            >
              Cancel
            </DefaultButton>
          </DialogFooter>
        </Dialog>
      )}
      {deleteTarget !== undefined && (
        <Dialog
          hidden={false}
          dialogContentProps={{
            type: DialogType.normal,
            title: `Delete ${deleteTarget.title}?`,
            closeButtonAriaLabel: 'Close delete confirmation',
            subText:
              'This permanently removes the story, its current estimate, and its complete estimate history. Archive the story instead if that history should be retained.'
          }}
          modalProps={{ isBlocking: true }}
          onDismiss={busyStoryId === deleteTarget.id ? undefined : cancelDelete}
        >
          <DialogFooter>
            <PrimaryButton
              className={styles.confirmDeleteAction}
              disabled={busyStoryId === deleteTarget.id}
              onClick={confirmDelete}
            >
              {busyStoryId === deleteTarget.id ? 'Deleting...' : 'Delete story'}
            </PrimaryButton>
            <DefaultButton disabled={busyStoryId === deleteTarget.id} onClick={cancelDelete}>
              Cancel
            </DefaultButton>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}
