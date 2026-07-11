import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { Dialog, DialogFooter, DialogType } from '@fluentui/react/lib/Dialog';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import type { UserReference } from '../domain/planningPokerDomain';
import type { HostedTeamSummary } from '../repository/teamRepository';
import { ContentCard, StatusState } from '../shell/ShellPrimitives';
import { TeamFormPanel } from './TeamFormPanel';
import { createInitialTeamForm } from './teamForm';
import type { TeamFormValues } from './teamForm';
import type {
  ITeamManagementService,
  TeamEditSession,
  TeamSaveResult
} from './teamManagementService';
import type { IPlanningPokerPeopleService } from './sharePointPeopleService';
import styles from './TeamsPage.module.scss';

/** Defines the authenticated dependencies for the Teams destination. */
export interface ITeamsPageProps {
  /** Current stable user selected as a default host. */
  readonly currentUser: UserReference;
  /** Team workflow service. */
  readonly service: ITeamManagementService;
  /** SharePoint people resolver for form pickers. */
  readonly peopleService: IPlanningPokerPeopleService;
  /** Shell-local Fluent UI layer host used to contain the team panel. */
  readonly panelLayerHostId?: string;
}

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Renders hosted-team discovery and owns the create/edit panel lifecycle.
 *
 * @param props - Authenticated team services and current identity.
 * @returns The complete Teams destination.
 */
export function TeamsPage(props: ITeamsPageProps): React.ReactElement {
  const [teams, setTeams] = React.useState<readonly HostedTeamSummary[]>([]);
  const [loadState, setLoadState] = React.useState<LoadState>('loading');
  const [loadVersion, setLoadVersion] = React.useState(0);
  const [isEditorOpen, setIsEditorOpen] = React.useState(false);
  const [initialValues, setInitialValues] = React.useState(() =>
    createInitialTeamForm(props.currentUser)
  );
  const [editSession, setEditSession] = React.useState<TeamEditSession>();
  const [editorMessage, setEditorMessage] = React.useState<string>();
  const [deleteTarget, setDeleteTarget] = React.useState<HostedTeamSummary>();
  const [deleteMessage, setDeleteMessage] = React.useState<string>();
  const [busyTeamId, setBusyTeamId] = React.useState<string>();
  const newTeamButtonRef = React.useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = React.useRef<HTMLButtonElement>();

  React.useEffect(() => {
    let isCurrent = true;
    setLoadState('loading');
    props.service.listTeams().then(
      (items) => {
        if (isCurrent) {
          setTeams(items);
          setLoadState('ready');
        }
      },
      () => {
        if (isCurrent) {
          setLoadState('error');
        }
      }
    );
    return (): void => {
      isCurrent = false;
    };
  }, [loadVersion, props.service]);

  React.useEffect(
    () => (): void => {
      if (editSession !== undefined) {
        props.service.closeTeam(editSession);
      }
    },
    [editSession, props.service]
  );

  const refresh = (): void => setLoadVersion((version) => version + 1);

  const handleNewTeam = (): void => {
    if (editSession !== undefined) {
      props.service.closeTeam(editSession);
      setEditSession(undefined);
    }
    setInitialValues(createInitialTeamForm(props.currentUser));
    setEditorMessage(undefined);
    setIsEditorOpen(true);
  };

  const handleEditTeam = async (summary: HostedTeamSummary): Promise<void> => {
    setEditorMessage(undefined);
    try {
      const session = await props.service.openTeam(summary);
      setEditSession(session);
      setInitialValues(session.values);
      setIsEditorOpen(true);
    } catch {
      setEditorMessage(
        'Team host details could not be verified. Reload the list or ask another host to repair access.'
      );
    }
  };

  const handleDismiss = (): void => {
    if (editSession !== undefined) {
      props.service.closeTeam(editSession);
      setEditSession(undefined);
    }
    setIsEditorOpen(false);
  };

  const handleSave = async (values: TeamFormValues): Promise<TeamSaveResult> => {
    const result =
      editSession === undefined
        ? await props.service.createTeam(values, teams)
        : await props.service.updateTeam(editSession, values, teams);
    if (result.isSaved) {
      handleDismiss();
      refresh();
    }
    return result;
  };

  const handleActiveState = async (team: HostedTeamSummary): Promise<void> => {
    setEditorMessage(undefined);
    setBusyTeamId(team.teamId);
    const result = await props.service.setTeamActive(team, !team.isActive);
    if (result.isSaved) {
      setTeams((current) =>
        current.map((candidate) =>
          candidate.teamId === team.teamId ? { ...candidate, isActive: !team.isActive } : candidate
        )
      );
    } else {
      setEditorMessage(result.message ?? 'The team activity could not be changed. Try again.');
    }
    setBusyTeamId(undefined);
  };

  const openDeleteConfirmation = (team: HostedTeamSummary, trigger: HTMLButtonElement): void => {
    deleteTriggerRef.current = trigger;
    setDeleteMessage(undefined);
    setDeleteTarget(team);
  };

  const cancelDelete = (): void => {
    setDeleteMessage(undefined);
    setDeleteTarget(undefined);
    window.setTimeout(() => deleteTriggerRef.current?.focus(), 0);
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === undefined) {
      return;
    }
    setBusyTeamId(deleteTarget.teamId);
    setDeleteMessage(undefined);
    const result = await props.service.deleteTeam({ team: deleteTarget, isConfirmed: true });
    if (result.code === 'success') {
      const deletedTeamId = deleteTarget.teamId;
      setTeams((current) => current.filter((team) => team.teamId !== deletedTeamId));
      setDeleteTarget(undefined);
      window.setTimeout(() => newTeamButtonRef.current?.focus(), 0);
    } else if (result.code !== 'confirmation-cancelled') {
      setDeleteMessage(result.message);
    }
    setBusyTeamId(undefined);
  };

  if (loadState === 'loading') {
    return (
      <StatusState kind="loading" title="Loading teams" description="Checking hosted teams." />
    );
  }
  if (loadState === 'error') {
    return (
      <StatusState
        kind="error"
        title="Teams could not be loaded"
        description="Check the SharePoint connection and try again."
        action={<DefaultButton onClick={refresh}>Retry</DefaultButton>}
      />
    );
  }
  return (
    <section aria-label="Hosted teams">
      <div className={styles.commandRow}>
        <PrimaryButton
          elementRef={newTeamButtonRef}
          iconProps={{ iconName: 'Add' }}
          onClick={handleNewTeam}
        >
          New team
        </PrimaryButton>
      </div>
      {editorMessage !== undefined && (
        <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
          {editorMessage}
        </MessageBar>
      )}
      {teams.length === 0 ? (
        <ContentCard>
          <StatusState
            kind="empty"
            title="Create your first team"
            description="Teams define hosts, an expected roster, point scales, timer defaults, and vote visibility."
            action={
              <PrimaryButton iconProps={{ iconName: 'Add' }} onClick={handleNewTeam}>
                New team
              </PrimaryButton>
            }
          />
        </ContentCard>
      ) : (
        <ul className={styles.teamGrid}>
          {teams.map((team) => (
            <li key={team.teamId}>
              <ContentCard label={team.title}>
                <div className={styles.teamCard}>
                  {!team.isActive && <span className={styles.inactiveLabel}>Inactive</span>}
                  <h2>{team.title}</h2>
                  <p className={styles.teamMeta}>
                    {team.isActive
                      ? 'Available for team planning and new voting sessions.'
                      : 'Still manageable, but unavailable for new voting sessions.'}
                  </p>
                  <div className={styles.cardActions}>
                    <DefaultButton
                      disabled={busyTeamId === team.teamId}
                      onClick={async () => handleEditTeam(team)}
                    >
                      Edit team
                    </DefaultButton>
                    <DefaultButton
                      disabled={busyTeamId === team.teamId}
                      onClick={async () => handleActiveState(team)}
                    >
                      {team.isActive ? 'Deactivate' : 'Activate'}
                    </DefaultButton>
                    <DefaultButton
                      className={styles.deleteAction}
                      iconProps={{ iconName: 'Delete' }}
                      disabled={busyTeamId === team.teamId}
                      onClick={(event) => {
                        if (event.currentTarget instanceof HTMLButtonElement) {
                          openDeleteConfirmation(team, event.currentTarget);
                        }
                      }}
                    >
                      Delete
                    </DefaultButton>
                  </div>
                </div>
              </ContentCard>
            </li>
          ))}
        </ul>
      )}
      <TeamFormPanel
        isOpen={isEditorOpen}
        isEditing={editSession !== undefined}
        initialValues={initialValues}
        existingTeams={teams}
        peopleService={props.peopleService}
        onSave={handleSave}
        onDismiss={handleDismiss}
        panelLayerHostId={props.panelLayerHostId}
      />
      {deleteTarget !== undefined && (
        <Dialog
          hidden={false}
          dialogContentProps={{
            type: DialogType.normal,
            title: `Delete ${deleteTarget.title}?`,
            closeButtonAriaLabel: 'Close delete confirmation',
            subText:
              'Stories, votes, and session history will leave Planning Poker. A site administrator can recover the team only from the SharePoint recycle bin while it is retained there.'
          }}
          modalProps={{
            isBlocking: true
          }}
          onDismiss={busyTeamId === deleteTarget.teamId ? undefined : cancelDelete}
        >
          {deleteMessage !== undefined && (
            <MessageBar messageBarType={MessageBarType.error} delayedRender={false}>
              {deleteMessage}
            </MessageBar>
          )}
          <DialogFooter>
            <PrimaryButton
              className={styles.confirmDeleteAction}
              disabled={busyTeamId === deleteTarget.teamId}
              onClick={confirmDelete}
            >
              {busyTeamId === deleteTarget.teamId ? 'Deleting...' : 'Delete team'}
            </PrimaryButton>
            <DefaultButton disabled={busyTeamId === deleteTarget.teamId} onClick={cancelDelete}>
              Cancel
            </DefaultButton>
          </DialogFooter>
        </Dialog>
      )}
    </section>
  );
}
