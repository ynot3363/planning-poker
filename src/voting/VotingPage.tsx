import * as React from 'react';
import type { ServiceScope } from '@microsoft/sp-core-library';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Dialog, DialogFooter, DialogType } from '@fluentui/react/lib/Dialog';
import { TooltipHost } from '@fluentui/react/lib/Tooltip';
import type { PlanningPokerDocumentRoot } from '../domain/planningPokerDomain';
import type { HostedTeamSummary } from '../repository/teamRepository';
import { ContentCard, StatusState } from '../shell/ShellPrimitives';
import { LivePersona } from '../shell/LivePersona';
import { RoleGuard } from '../shell/RoleGuard';
import type {
  IVotingSessionService,
  VotingSessionContext,
  VotingTeamSummary
} from './sessionManagement';
import { createSessionShareUrl } from './sessionManagement';
import { selectEligibleVotingStories } from './sessionManagement';
import { normalizeStoryLink } from '../stories/storyManagement';
import type { NamedParticipantRow } from './participation';
import { selectCurrentVoteValue, selectParticipation } from './participation';
import { VotingTimerPanel } from './VotingTimerPanel';
import { selectVotingResults } from './results';
import { VotingResultsPanel } from './VotingResultsPanel';
import styles from './VotingPage.module.scss';

/** Dependencies for the normal and focused Voting destination. */
export interface IVotingPageProps {
  readonly service: IVotingSessionService;
  readonly teamId?: string;
  readonly sessionId?: string;
  readonly serviceScope: ServiceScope;
  readonly webAbsoluteUrl?: string;
  readonly onOpenSession: (teamId: string, sessionId: string) => void;
}

type LoadingState = 'loading' | 'ready' | 'error';
type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Renders hosted-team session preparation or a focused synchronized Lobby.
 *
 * @param props - Session service, focused route, and navigation callback.
 * @returns The Voting destination.
 */
export function VotingPage(props: IVotingPageProps): React.ReactElement {
  const isFocused = props.teamId !== undefined && props.sessionId !== undefined;
  const [loadingState, setLoadingState] = React.useState<LoadingState>('loading');
  const [teams, setTeams] = React.useState<readonly VotingTeamSummary[]>([]);
  const [context, setContext] = React.useState<VotingSessionContext>();
  const [document, setDocument] = React.useState<PlanningPokerDocumentRoot>();
  const [error, setError] = React.useState<string>();
  const [busyTeamId, setBusyTeamId] = React.useState<string>();
  const [isStarting, setIsStarting] = React.useState(false);
  const [selectedStoryId, setSelectedStoryId] = React.useState<string>();
  const [isVotingActionBusy, setIsVotingActionBusy] = React.useState(false);
  const [isReplaceConfirmationOpen, setIsReplaceConfirmationOpen] = React.useState(false);
  const [copyState, setCopyState] = React.useState<CopyState>('idle');
  const [previewStoryId, setPreviewStoryId] = React.useState<string>();
  const [selectedFinalEstimate, setSelectedFinalEstimate] = React.useState<string>();
  const [isChangingFinalEstimate, setIsChangingFinalEstimate] = React.useState(false);

  React.useEffect(() => {
    let isCurrent = true;
    let opened: VotingSessionContext | undefined;
    let unsubscribe: (() => void) | undefined;
    let handlePageHide: (() => void) | undefined;
    setLoadingState('loading');
    setError(undefined);
    if (!isFocused) {
      props.service.listVotingTeams().then(
        (value) => {
          if (isCurrent) {
            setTeams(value);
            setLoadingState('ready');
          }
        },
        () => {
          if (isCurrent) {
            setError(
              'Hosted teams could not be loaded. Check the SharePoint connection and try again.'
            );
            setLoadingState('error');
          }
        }
      );
    } else {
      props.service.joinSession(props.teamId as string, props.sessionId as string).then(
        (value) => {
          if (!isCurrent) {
            props.service.closeSession(value);
            return;
          }
          opened = value;
          handlePageHide = () => props.service.markDisconnected(value);
          window.addEventListener('pagehide', handlePageHide);
          setContext(value);
          setDocument(value.getDocument());
          unsubscribe = props.service.subscribe(value, () => {
            if (isCurrent) {
              setDocument(value.getDocument());
            }
          });
          setLoadingState('ready');
        },
        (reason: unknown) => {
          if (isCurrent) {
            setError(
              reason instanceof Error ? reason.message : 'This voting session could not be opened.'
            );
            setLoadingState('error');
          }
        }
      );
    }
    return (): void => {
      isCurrent = false;
      unsubscribe?.();
      if (handlePageHide !== undefined) {
        window.removeEventListener('pagehide', handlePageHide);
      }
      if (opened !== undefined) {
        props.service.closeSession(opened);
      }
    };
  }, [isFocused, props.service, props.sessionId, props.teamId]);

  const synchronizedSession = document?.sessions.find(
    (candidate) => candidate.id === props.sessionId
  );
  const synchronizedActiveStoryId = synchronizedSession?.rounds.find(
    (round) => round.id === synchronizedSession.activeRoundId
  )?.storyId;
  const firstStoryId = document?.stories[0]?.id;
  React.useEffect(() => {
    if (synchronizedActiveStoryId !== undefined) {
      setPreviewStoryId(synchronizedActiveStoryId);
    } else if (firstStoryId !== undefined) {
      setPreviewStoryId((current) => current ?? firstStoryId);
    }
  }, [firstStoryId, synchronizedActiveStoryId]);

  const prepare = async (team: HostedTeamSummary): Promise<void> => {
    setBusyTeamId(team.teamId);
    setError(undefined);
    try {
      const prepared = await props.service.prepareSession(team);
      const session = prepared.getSession();
      props.service.closeSession(prepared);
      props.onOpenSession(team.teamId, session.id);
    } catch (reason: unknown) {
      setError(
        reason instanceof Error ? reason.message : 'The voting Lobby could not be prepared.'
      );
      setBusyTeamId(undefined);
    }
  };

  const startVoting = async (): Promise<void> => {
    if (context === undefined) {
      return;
    }
    setIsStarting(true);
    setError(undefined);
    try {
      await props.service.startVoting(context);
      setDocument(context.getDocument());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Voting could not be started.');
    } finally {
      setIsStarting(false);
    }
  };

  const copySessionLink = async (sessionShareUrl: string): Promise<void> => {
    const clipboard = (
      window.navigator as Navigator & {
        clipboard?: { writeText(value: string): Promise<void> };
      }
    ).clipboard;
    if (clipboard === undefined) {
      setCopyState('failed');
      return;
    }
    try {
      await clipboard.writeText(sessionShareUrl);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const chooseStory = async (replaceActive: boolean): Promise<void> => {
    const storyId = selectedStoryId ?? previewStoryId;
    if (context === undefined || storyId === undefined) {
      return;
    }
    setIsVotingActionBusy(true);
    setError(undefined);
    try {
      if (replaceActive) {
        await props.service.replaceStory(context, storyId);
      } else {
        await props.service.selectStory(context, storyId);
      }
      setSelectedStoryId(undefined);
      setPreviewStoryId(storyId);
      setIsReplaceConfirmationOpen(false);
      setDocument(context.getDocument());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The active story could not be changed.');
    } finally {
      setIsVotingActionBusy(false);
    }
  };

  const runTimerAction = async (
    action: 'startTimer' | 'stopTimer' | 'resetTimer',
    roundId: string
  ): Promise<void> => {
    if (context === undefined) {
      return;
    }
    setIsVotingActionBusy(true);
    setError(undefined);
    try {
      await props.service[action](context, roundId);
      setDocument(context.getDocument());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The timer could not be updated.');
    } finally {
      setIsVotingActionBusy(false);
    }
  };

  const revealResults = async (roundId: string): Promise<void> => {
    if (context === undefined) {
      return;
    }
    setIsVotingActionBusy(true);
    setError(undefined);
    try {
      await props.service.revealResults(context, roundId);
      setDocument(context.getDocument());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Voting results could not be revealed.');
    } finally {
      setIsVotingActionBusy(false);
    }
  };

  const undoReveal = async (roundId: string): Promise<void> => {
    if (context === undefined) {
      return;
    }
    setIsVotingActionBusy(true);
    setError(undefined);
    try {
      await props.service.undoReveal(context, roundId);
      setSelectedFinalEstimate(undefined);
      setDocument(context.getDocument());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The reveal could not be undone.');
    } finally {
      setIsVotingActionBusy(false);
    }
  };

  const finalizeEstimate = async (roundId: string): Promise<void> => {
    if (context === undefined || selectedFinalEstimate === undefined) {
      return;
    }
    setIsVotingActionBusy(true);
    setError(undefined);
    try {
      await props.service.finalizeEstimate(context, roundId, selectedFinalEstimate);
      setDocument(context.getDocument());
      setIsChangingFinalEstimate(false);
      setSelectedFinalEstimate(undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'The final estimate could not be saved.');
    } finally {
      setIsVotingActionBusy(false);
    }
  };

  const castVote = async (roundId: string, value: string): Promise<void> => {
    if (context === undefined) {
      return;
    }
    setIsVotingActionBusy(true);
    setError(undefined);
    try {
      await props.service.castVote(context, roundId, value);
      setDocument(context.getDocument());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Your vote could not be saved.');
    } finally {
      setIsVotingActionBusy(false);
    }
  };

  if (loadingState === 'loading') {
    return (
      <StatusState
        kind="loading"
        title="Loading voting"
        description="Connecting to synchronized session data."
      />
    );
  }
  if (loadingState === 'error') {
    return (
      <StatusState
        kind="error"
        title="Voting session unavailable"
        description={error ?? 'The voting session could not be opened.'}
      />
    );
  }
  if (!isFocused) {
    return (
      <>
        {error !== undefined && (
          <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>
        )}
        {teams.length === 0 ? (
          <StatusState
            kind="empty"
            title="No voting sessions"
            description="No hosted teams or open participant sessions are available."
          />
        ) : (
          <ul className={styles.teamList} aria-label="Hosted teams and open voting sessions">
            {teams.map((team) => (
              <li key={team.teamId}>
                <ContentCard label={team.title}>
                  <div className={styles.teamCard}>
                    <h2>{team.title}</h2>
                    <p>
                      {team.activeSessionId === undefined
                        ? 'No session is open.'
                        : `${team.relationship === 'Host' ? 'Hosted' : 'Participant'} session is open.`}
                    </p>
                    <div className={styles.actions}>
                      {team.activeSessionId === undefined && team.relationship === 'Host' ? (
                        <PrimaryButton
                          disabled={busyTeamId !== undefined}
                          onClick={() => prepare(team).catch(() => undefined)}
                        >
                          {busyTeamId === team.teamId ? 'Preparing...' : 'Prepare voting'}
                        </PrimaryButton>
                      ) : (
                        <PrimaryButton
                          onClick={() =>
                            props.onOpenSession(team.teamId, team.activeSessionId as string)
                          }
                        >
                          Open session
                        </PrimaryButton>
                      )}
                    </div>
                  </div>
                </ContentCard>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  const session = document?.sessions.find((candidate) => candidate.id === props.sessionId);
  if (context === undefined || document === undefined || session === undefined) {
    return (
      <StatusState
        kind="error"
        title="Voting session unavailable"
        description="This voting session is no longer available."
      />
    );
  }
  const sessionShareUrl = createSessionShareUrl(
    window.location.href,
    context.team.teamId,
    session.id
  );
  const participation = selectParticipation(session, context.participantId);
  const activeRound = session.rounds.find((round) => round.id === session.activeRoundId);
  const eligibleStories = selectEligibleVotingStories(document, session);
  const currentVote = selectCurrentVoteValue(session, context.participantId);
  const canReplaceStory = activeRound?.status === 'Voting' && activeRound.votes.length === 0;
  const actionsUnavailable = isVotingActionBusy || context.getConnectionState() === 'Disconnected';
  const previewedSourceStory = document.stories.find((story) => story.id === previewStoryId);
  const displayedRound =
    activeRound?.storyId === previewStoryId
      ? activeRound
      : [...session.rounds]
          .reverse()
          .find(
            (round) =>
              round.storyId === previewStoryId &&
              (round.status === 'Revealed' || round.status === 'Finalized')
          );
  const isPreviewingActiveStory = displayedRound?.storyId === previewStoryId;
  const roundStatusLabel =
    displayedRound?.status === 'Voting'
      ? 'Active voting'
      : displayedRound?.status === 'Revealed'
        ? 'Results revealed'
        : displayedRound?.status === 'Finalized'
          ? 'Finalized'
          : undefined;
  const previewedStory =
    isPreviewingActiveStory && displayedRound !== undefined
      ? {
          title: displayedRound.storySnapshot.title,
          description: displayedRound.storySnapshot.description,
          link: displayedRound.storySnapshot.link,
          status: `${previewedSourceStory?.status ?? 'Ready'}${roundStatusLabel === undefined ? '' : ` · ${roundStatusLabel}`}`
        }
      : previewedSourceStory;
  const votingResults =
    displayedRound === undefined ? undefined : selectVotingResults(session, displayedRound);
  const safeStoryLink =
    previewedStory?.link === undefined ? undefined : normalizeStoryLink(previewedStory.link).link;
  const canSelectPreviewedStory =
    previewedSourceStory !== undefined &&
    eligibleStories.some((story) => story.id === previewedSourceStory.id);
  const namedParticipantGroups =
    participation.mode === 'Named'
      ? {
          waiting: participation.rows.filter(
            (participant) => participant.connection !== 'Disconnected' && !participant.hasVoted
          ),
          voted: participation.rows.filter(
            (participant) => participant.connection !== 'Disconnected' && participant.hasVoted
          ),
          disconnected: participation.rows.filter(
            (participant) => participant.connection === 'Disconnected'
          )
        }
      : undefined;
  return (
    <div className={styles.focusedSession}>
      <header className={styles.sessionHeader}>
        <div>
          <h2>
            {context.team.title} - {session.settings.votingMode} Voting Session
          </h2>
          <span className={styles.statusBadge} role="status" aria-live="polite">
            {session.status}
          </span>
        </div>
        <div className={styles.copyAction}>
          <TooltipHost content={sessionShareUrl} calloutProps={{ gapSpace: 8 }}>
            <DefaultButton
              iconProps={{ iconName: copyState === 'copied' ? 'CheckMark' : 'Copy' }}
              aria-label="Copy voting session URL"
              title="Copy voting session URL"
              onClick={() => copySessionLink(sessionShareUrl).catch(() => undefined)}
            >
              Copy Url
            </DefaultButton>
          </TooltipHost>
          <span className={styles.copyStatus} role="status" aria-live="polite">
            {copyState === 'copied' ? 'URL copied' : copyState === 'failed' ? 'Copy failed' : ''}
          </span>
        </div>
      </header>
      <div className={styles.sessionCard}>
        {error !== undefined && (
          <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>
        )}
        {context.getConnectionState() === 'Disconnected' && (
          <MessageBar messageBarType={MessageBarType.warning}>
            Reconnecting to collaboration services. Changes are unavailable while disconnected.
          </MessageBar>
        )}
        <div className={styles.focusedGrid}>
          <aside className={styles.storyColumn} aria-labelledby="session-stories-heading">
            <h3 id="session-stories-heading">Stories</h3>
            {document.stories.length === 0 ? (
              <p>No stories are available.</p>
            ) : (
              <ul className={styles.storyList}>
                {document.stories.map((story) => {
                  const isActive = story.id === activeRound?.storyId;
                  const isPreviewed = story.id === previewStoryId;
                  return (
                    <li key={story.id}>
                      <button
                        type="button"
                        className={`${styles.storyCard} ${isActive ? styles.activeStoryCard : ''}`}
                        aria-pressed={isPreviewed}
                        onClick={() => {
                          setPreviewStoryId(story.id);
                          setSelectedStoryId(story.id);
                          setSelectedFinalEstimate(undefined);
                          setIsChangingFinalEstimate(false);
                        }}
                      >
                        <span className={styles.storyCardHeader}>
                          <span className={styles.storyCardTitle}>{story.title}</span>
                          <span
                            className={`${styles.storyCardStatus} ${getStoryStatusTone(story.status, isActive)}`}
                          >
                            {story.status}
                            {isActive
                              ? ` · ${activeRound?.status === 'Voting' ? 'Active voting' : 'Results revealed'}`
                              : ''}
                          </span>
                        </span>
                        <span className={styles.storyCardDescription}>{story.description}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
          <main className={styles.votingColumn}>
            {previewedStory === undefined ? (
              <StatusState
                kind="empty"
                title="Select a story"
                description="Choose a story from the list to review its details."
              />
            ) : (
              <section className={styles.storyDetails} aria-labelledby="story-details-heading">
                <p className={styles.eyebrow}>
                  {isPreviewingActiveStory ? 'Active story' : 'Story details'}
                </p>
                <div className={styles.activeStoryHeader}>
                  <h3 id="story-details-heading">{previewedStory.title}</h3>
                  <span
                    className={`${styles.statusBadge} ${getStoryStatusTone(
                      previewedStory.status,
                      isPreviewingActiveStory
                    )}`}
                  >
                    {previewedStory.status}
                  </span>
                </div>
                {previewedStory.description.length > 0 && <p>{previewedStory.description}</p>}
                {previewedStory.link !== undefined &&
                  (safeStoryLink === undefined ? (
                    <p>Story link unavailable.</p>
                  ) : (
                    <a href={safeStoryLink} target="_blank" rel="noopener noreferrer">
                      Open story context
                    </a>
                  ))}
                <RoleGuard
                  allowed={
                    context.isHost &&
                    session.status === 'Active' &&
                    canSelectPreviewedStory &&
                    !isPreviewingActiveStory
                  }
                >
                  <PrimaryButton
                    disabled={actionsUnavailable || (activeRound !== undefined && !canReplaceStory)}
                    onClick={() => {
                      if (activeRound === undefined) {
                        chooseStory(false).catch(() => undefined);
                      } else {
                        setIsReplaceConfirmationOpen(true);
                      }
                    }}
                  >
                    {activeRound === undefined ? 'Start story voting' : 'Replace active story'}
                  </PrimaryButton>
                </RoleGuard>
                {isPreviewingActiveStory && displayedRound?.status === 'Voting' && (
                  <div className={styles.votingDetails}>
                    <fieldset className={styles.voteFieldset} disabled={actionsUnavailable}>
                      <legend>Choose your estimate</legend>
                      <div className={styles.voteScale}>
                        {session.settings.scaleValues.map((value) => (
                          <DefaultButton
                            key={value}
                            className={currentVote === value ? styles.selectedVote : undefined}
                            aria-pressed={currentVote === value}
                            disabled={
                              displayedRound.status !== 'Voting' ||
                              context.participantId === undefined
                            }
                            onClick={() =>
                              castVote(displayedRound.id, value).catch(() => undefined)
                            }
                          >
                            {value}
                          </DefaultButton>
                        ))}
                      </div>
                    </fieldset>
                    <p
                      className={styles.voteStatus}
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {currentVote === undefined
                        ? 'No vote selected yet.'
                        : `Your current vote is ${currentVote}. You can change it until reveal.`}
                    </p>
                    <RoleGuard allowed={context.isHost && displayedRound.votes.length > 0}>
                      <PrimaryButton
                        disabled={actionsUnavailable}
                        onClick={() => revealResults(displayedRound.id).catch(() => undefined)}
                      >
                        Reveal Results
                      </PrimaryButton>
                    </RoleGuard>
                  </div>
                )}
                {votingResults !== undefined && displayedRound !== undefined && (
                  <VotingResultsPanel
                    results={votingResults}
                    scaleValues={session.settings.scaleValues}
                    isHost={context.isHost}
                    disabled={actionsUnavailable}
                    selectedEstimate={selectedFinalEstimate}
                    assignedValue={displayedRound.assignedValue}
                    isChangingEstimate={isChangingFinalEstimate}
                    serviceScope={props.serviceScope}
                    webAbsoluteUrl={props.webAbsoluteUrl}
                    onSelectEstimate={setSelectedFinalEstimate}
                    onAssignEstimate={() =>
                      finalizeEstimate(displayedRound.id).catch(() => undefined)
                    }
                    onUndoReveal={() => undoReveal(displayedRound.id).catch(() => undefined)}
                    onStartChangingEstimate={() => {
                      setSelectedFinalEstimate(undefined);
                      setIsChangingFinalEstimate(true);
                    }}
                    onCancelChangingEstimate={() => {
                      setSelectedFinalEstimate(undefined);
                      setIsChangingFinalEstimate(false);
                    }}
                  />
                )}
              </section>
            )}
            {session.status === 'Lobby' && (
              <RoleGuard allowed={context.isHost}>
                <PrimaryButton
                  disabled={isStarting}
                  onClick={() => startVoting().catch(() => undefined)}
                >
                  {isStarting ? 'Starting...' : 'Start voting session'}
                </PrimaryButton>
              </RoleGuard>
            )}
            {session.status === 'Active' &&
              activeRound === undefined &&
              displayedRound === undefined &&
              !context.isHost && <p role="status">Waiting for the host to select a story.</p>}
          </main>
          <aside className={styles.sessionColumn}>
            {session.settings.timerEnabled && activeRound !== undefined && (
              <VotingTimerPanel
                timer={activeRound.timer}
                isHost={context.isHost && activeRound.status === 'Voting'}
                disabled={actionsUnavailable}
                onStart={() => runTimerAction('startTimer', activeRound.id).catch(() => undefined)}
                onStop={() => runTimerAction('stopTimer', activeRound.id).catch(() => undefined)}
                onReset={() => runTimerAction('resetTimer', activeRound.id).catch(() => undefined)}
              />
            )}
            {session.settings.timerEnabled &&
              activeRound === undefined &&
              displayedRound === undefined && (
                <section className={styles.timerPanel} aria-labelledby="voting-timer-heading">
                  <h3 id="voting-timer-heading">Timer</h3>
                  <p>Ready when a story becomes active.</p>
                </section>
              )}
            <section
              className={styles.participation}
              aria-labelledby="session-participation-heading"
            >
              <h3 id="session-participation-heading">Participants</h3>
              <p className={styles.participationCounts} aria-live="polite" aria-atomic="true">
                {participation.counts.joined} joined · {participation.counts.voted} voted ·{' '}
                {participation.counts.remaining} remaining · {participation.counts.disconnected}{' '}
                disconnected
              </p>
              {participation.mode === 'Named' ? (
                participation.rows.length === 0 ? (
                  <p>No participants have joined yet.</p>
                ) : (
                  <div className={styles.participantGroups}>
                    <NamedParticipantGroup
                      heading="Not voted"
                      rows={namedParticipantGroups?.waiting ?? []}
                      serviceScope={props.serviceScope}
                      webAbsoluteUrl={props.webAbsoluteUrl}
                    />
                    <NamedParticipantGroup
                      heading="Voted"
                      rows={namedParticipantGroups?.voted ?? []}
                      serviceScope={props.serviceScope}
                      webAbsoluteUrl={props.webAbsoluteUrl}
                    />
                    <NamedParticipantGroup
                      heading="Disconnected"
                      rows={namedParticipantGroups?.disconnected ?? []}
                      serviceScope={props.serviceScope}
                      webAbsoluteUrl={props.webAbsoluteUrl}
                    />
                  </div>
                )
              ) : (
                <p>
                  {participation.currentAlias !== undefined
                    ? `You are ${participation.currentAlias}. `
                    : ''}
                  Participant identities are hidden.
                </p>
              )}
            </section>
          </aside>
        </div>
        {isReplaceConfirmationOpen && selectedStoryId !== undefined && (
          <Dialog
            hidden={false}
            dialogContentProps={{
              type: DialogType.normal,
              title: 'Replace the active story?',
              closeButtonAriaLabel: 'Close story replacement confirmation',
              subText:
                'The current unvoted round will be cancelled and the selected Ready story will become active.'
            }}
            modalProps={{ isBlocking: true }}
            onDismiss={isVotingActionBusy ? undefined : () => setIsReplaceConfirmationOpen(false)}
          >
            <DialogFooter>
              <PrimaryButton
                disabled={isVotingActionBusy}
                onClick={() => chooseStory(true).catch(() => undefined)}
              >
                {isVotingActionBusy ? 'Replacing...' : 'Replace story'}
              </PrimaryButton>
              <DefaultButton
                disabled={isVotingActionBusy}
                onClick={() => setIsReplaceConfirmationOpen(false)}
              >
                Cancel
              </DefaultButton>
            </DialogFooter>
          </Dialog>
        )}
      </div>
    </div>
  );
}

interface INamedParticipantGroupProps {
  readonly heading: string;
  readonly rows: readonly NamedParticipantRow[];
  readonly serviceScope: ServiceScope;
  readonly webAbsoluteUrl: string | undefined;
}

/**
 * Renders one mutually exclusive named-participant state group.
 *
 * @param props - Group heading, participant rows, and persona context.
 * @returns A consistently labeled participant group.
 */
function NamedParticipantGroup(props: INamedParticipantGroupProps): React.ReactElement {
  return (
    <section className={styles.participantGroup} aria-label={`${props.heading} participants`}>
      <h4>
        {props.heading} <span>({props.rows.length})</span>
      </h4>
      {props.rows.length === 0 ? (
        <p className={styles.emptyParticipantGroup}>None</p>
      ) : (
        <ul className={styles.participantList}>
          {props.rows.map((participant) => (
            <li key={participant.participantId}>
              <div>
                <LivePersona
                  displayName={participant.displayName}
                  upn={participant.upn}
                  imageUrl={createUserPhotoUrl(props.webAbsoluteUrl, participant.upn)}
                  serviceScope={props.serviceScope}
                  ariaLabel={`${participant.displayName}, session participant`}
                />
                <span className={styles.participantStatus}>
                  {participant.hasVoted ? 'Voted' : 'Not voted'} · {participant.connection}
                </span>
              </div>
              {participant.isCurrent && <span className={styles.currentBadge}>You</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Selects a visual tone for a story status without changing its visible label.
 *
 * @param status - Story status text shown in the pill.
 * @param isActive - Whether this story is the active voting round.
 * @returns The CSS class for the status tone.
 */
function getStoryStatusTone(status: string, isActive: boolean): string {
  if (isActive) {
    return styles.storyStatusActive;
  }
  if (status.startsWith('Pointed')) {
    return styles.storyStatusPointed;
  }
  if (status.startsWith('Archived')) {
    return styles.storyStatusArchived;
  }
  return styles.storyStatusReady;
}

/**
 * Builds the same-site SharePoint user-photo endpoint used by the application shell.
 *
 * @param webAbsoluteUrl - Current SharePoint web URL.
 * @param upn - Named participant user principal name.
 * @returns The encoded profile photo URL when host context is available.
 */
function createUserPhotoUrl(webAbsoluteUrl: string | undefined, upn: string): string | undefined {
  return webAbsoluteUrl === undefined || upn.length === 0
    ? undefined
    : `${webAbsoluteUrl.replace(/\/$/, '')}/_layouts/15/userphoto.aspx?size=S&accountname=${encodeURIComponent(upn)}`;
}
