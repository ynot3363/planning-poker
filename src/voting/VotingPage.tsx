import * as React from 'react';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { Persona, PersonaSize } from '@fluentui/react/lib/Persona';
import { TextField } from '@fluentui/react/lib/TextField';
import type { PlanningPokerDocumentRoot, VotingSession } from '../domain/planningPokerDomain';
import type { HostedTeamSummary } from '../repository/teamRepository';
import { ContentCard, StatusState } from '../shell/ShellPrimitives';
import type { IVotingSessionService, VotingSessionContext } from './sessionManagement';
import { createSessionShareUrl } from './sessionManagement';
import { selectParticipation } from './participation';
import styles from './VotingPage.module.scss';

/** Dependencies for the normal and focused Voting destination. */
export interface IVotingPageProps {
  readonly service: IVotingSessionService;
  readonly teamId?: string;
  readonly sessionId?: string;
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
  const [teams, setTeams] = React.useState<readonly HostedTeamSummary[]>([]);
  const [context, setContext] = React.useState<VotingSessionContext>();
  const [document, setDocument] = React.useState<PlanningPokerDocumentRoot>();
  const [error, setError] = React.useState<string>();
  const [busyTeamId, setBusyTeamId] = React.useState<string>();
  const [isStarting, setIsStarting] = React.useState(false);
  const [copyState, setCopyState] = React.useState<CopyState>('idle');

  React.useEffect(() => {
    let isCurrent = true;
    let opened: VotingSessionContext | undefined;
    let unsubscribe: (() => void) | undefined;
    setLoadingState('loading');
    setError(undefined);
    if (!isFocused) {
      props.service.listHostedTeams().then(
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
      if (opened !== undefined) {
        props.service.closeSession(opened);
      }
    };
  }, [isFocused, props.service, props.sessionId, props.teamId]);

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
            title="No active hosted teams"
            description="Create or activate a team before preparing a voting session."
          />
        ) : (
          <ul className={styles.teamList} aria-label="Active hosted teams">
            {teams.map((team) => (
              <li key={team.teamId}>
                <ContentCard label={team.title}>
                  <div className={styles.teamCard}>
                    <h2>{team.title}</h2>
                    <p>
                      {team.activeSessionId === undefined
                        ? 'No session is open.'
                        : 'A Lobby or voting session is already open.'}
                    </p>
                    <div className={styles.actions}>
                      {team.activeSessionId === undefined ? (
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
  return (
    <ContentCard label={`${context.team.title} voting session`} tone="accent">
      <div className={styles.sessionCard}>
        <div className={styles.sessionHeader}>
          <div>
            <h2>{context.team.title}</h2>
            <p>{session.status === 'Lobby' ? 'Voting has not started.' : 'Voting is active.'}</p>
          </div>
          <span className={styles.statusBadge} role="status" aria-live="polite">
            {session.status}
          </span>
        </div>
        {error !== undefined && (
          <MessageBar messageBarType={MessageBarType.error}>{error}</MessageBar>
        )}
        {context.getConnectionState() === 'Disconnected' && (
          <MessageBar messageBarType={MessageBarType.warning}>
            Reconnecting to collaboration services. Changes are unavailable while disconnected.
          </MessageBar>
        )}
        <dl className={styles.details}>
          <div>
            <dt>Scale</dt>
            <dd>{session.settings.scaleValues.join(', ')}</dd>
          </div>
          <div>
            <dt>Voting mode</dt>
            <dd>{session.settings.votingMode}</dd>
          </div>
          <div>
            <dt>Timer</dt>
            <dd>{formatTimer(session)}</dd>
          </div>
          <div>
            <dt>Team context</dt>
            <dd>
              {context.isHost
                ? 'Host'
                : context.isConfiguredMember
                  ? 'Configured member'
                  : 'Guest participant'}
            </dd>
          </div>
        </dl>
        <section className={styles.participation} aria-labelledby="session-participation-heading">
          <div className={styles.participationHeader}>
            <div>
              <h3 id="session-participation-heading">Participants</h3>
              {participation.mode === 'Anonymous' && participation.currentAlias !== undefined && (
                <p>Your session alias is {participation.currentAlias}.</p>
              )}
            </div>
            <p className={styles.participationCounts} aria-live="polite" aria-atomic="true">
              {participation.counts.joined} joined · {participation.counts.voted} voted ·{' '}
              {participation.counts.remaining} remaining
            </p>
          </div>
          {participation.mode === 'Named' ? (
            participation.rows.length === 0 ? (
              <p>No participants have joined yet.</p>
            ) : (
              <ul className={styles.participantList} aria-label="Named session participants">
                {participation.rows.map((participant) => (
                  <li key={participant.participantId}>
                    <Persona
                      text={participant.displayName}
                      secondaryText={`${participant.hasVoted ? 'Voted' : 'Not voted'} · ${participant.connection}`}
                      size={PersonaSize.size32}
                    />
                    {participant.isCurrent && <span className={styles.currentBadge}>You</span>}
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p>
              Anonymous sessions show aggregate participation only. Other participant aliases and
              Microsoft 365 identities are hidden.
            </p>
          )}
        </section>
        {context.isHost && session.status === 'Lobby' && (
          <div className={styles.actions}>
            <PrimaryButton
              disabled={isStarting}
              onClick={() => startVoting().catch(() => undefined)}
            >
              {isStarting ? 'Starting...' : 'Start voting'}
            </PrimaryButton>
          </div>
        )}
        <div className={styles.shareLinkRow}>
          <TextField
            className={styles.shareLink}
            label="Session link"
            value={sessionShareUrl}
            readOnly
          />
          <DefaultButton
            iconProps={{ iconName: 'Copy' }}
            aria-live="polite"
            onClick={() => copySessionLink(sessionShareUrl).catch(() => undefined)}
          >
            {copyState === 'copied'
              ? 'Copied'
              : copyState === 'failed'
                ? 'Copy failed'
                : 'Copy link'}
          </DefaultButton>
        </div>
      </div>
    </ContentCard>
  );
}

/**
 * @param session - Session whose settings are displayed.
 * @returns A concise minute-based timer description.
 */
function formatTimer(session: VotingSession): string {
  if (!session.settings.timerEnabled || session.settings.timerDurationSeconds === undefined) {
    return 'Off';
  }
  const minutes = session.settings.timerDurationSeconds / 60;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
