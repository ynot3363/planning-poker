import type {
  ConnectionState,
  PlanningPokerDocumentRoot,
  PointingStory,
  SessionParticipant,
  UserReference,
  VotingSession
} from '../domain/planningPokerDomain';
import { isHostedBy, TeamRepository, TeamRepositoryError } from '../repository/teamRepository';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';
import { writePlanningPokerRoute } from '../shell/planningPokerRoute';

/** Stable expected failures for the session-entry experience. */
export type VotingSessionErrorCode =
  | 'not-found'
  | 'access-denied'
  | 'inactive-team'
  | 'incompatible-schema'
  | 'invalid-session'
  | 'ended-session'
  | 'host-required'
  | 'participant-required'
  | 'invalid-story'
  | 'active-round'
  | 'round-has-votes'
  | 'invalid-round'
  | 'invalid-timer-command'
  | 'invalid-vote'
  | 'invalid-estimate'
  | 'save-failure';

/** An expected session workflow failure containing only safe UI text. */
export class VotingSessionError extends Error {
  /**
   * @param code - Stable failure category.
   * @param message - Non-sensitive user-facing explanation.
   */
  public constructor(
    public readonly code: VotingSessionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'VotingSessionError';
    Object.setPrototypeOf(this, VotingSessionError.prototype);
  }
}

/** A verified live session context owned by the Voting destination. */
export interface VotingSessionContext {
  readonly team: HostedTeamSummary;
  readonly handle: TeamDocumentHandle;
  readonly isHost: boolean;
  readonly isConfiguredMember: boolean;
  readonly participantId?: string;
  getDocument(): PlanningPokerDocumentRoot;
  getSession(): VotingSession;
  getConnectionState(): ConnectionState;
}

/** Team entry shown on Voting with the current user's application relationship. */
export interface VotingTeamSummary extends HostedTeamSummary {
  readonly relationship: 'Host' | 'Participant';
}

/** Session-entry operations consumed by normal and focused Voting views. */
export interface IVotingSessionService {
  listHostedTeams(): Promise<readonly HostedTeamSummary[]>;
  listVotingTeams(): Promise<readonly VotingTeamSummary[]>;
  prepareSession(team: HostedTeamSummary): Promise<VotingSessionContext>;
  joinSession(teamId: string, sessionId: string): Promise<VotingSessionContext>;
  startVoting(context: VotingSessionContext): Promise<VotingSession>;
  selectStory(context: VotingSessionContext, storyId: string): Promise<VotingSession>;
  replaceStory(context: VotingSessionContext, storyId: string): Promise<VotingSession>;
  castVote(
    context: VotingSessionContext,
    roundId: string,
    scaleValue: string
  ): Promise<VotingSession>;
  startTimer(context: VotingSessionContext, roundId: string): Promise<VotingSession>;
  stopTimer(context: VotingSessionContext, roundId: string): Promise<VotingSession>;
  resetTimer(context: VotingSessionContext, roundId: string): Promise<VotingSession>;
  revealResults(context: VotingSessionContext, roundId: string): Promise<VotingSession>;
  undoReveal(context: VotingSessionContext, roundId: string): Promise<VotingSession>;
  finalizeEstimate(
    context: VotingSessionContext,
    roundId: string,
    scaleValue: string
  ): Promise<VotingSession>;
  subscribe(context: VotingSessionContext, listener: () => void): () => void;
  markDisconnected(context: VotingSessionContext): void;
  closeSession(context: VotingSessionContext): void;
}

/** Minimal browser-session storage surface used for anonymous reconnect state. */
export interface IParticipantSessionStorage {
  getItem(key: string): string | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Builds a focused route while preserving SharePoint's unrelated query parameters.
 *
 * @param currentUrl - Current browser URL.
 * @param teamId - Opaque stable team identifier.
 * @param sessionId - Opaque stable session identifier.
 * @returns A shareable same-page URL.
 */
export function createSessionShareUrl(
  currentUrl: string,
  teamId: string,
  sessionId: string
): string {
  const url = new URL(currentUrl);
  url.search = writePlanningPokerRoute(url.search, {
    view: 'Voting',
    teamId,
    sessionId,
    focusedVoting: true
  });
  return url.toString();
}

/**
 * Selects Ready stories not already finalized in this immutable session history.
 *
 * @param document - Current synchronized team document.
 * @param session - Active session whose history defines exclusions.
 * @returns Eligible stories in the team's durable order.
 */
export function selectEligibleVotingStories(
  document: PlanningPokerDocumentRoot,
  session: VotingSession
): readonly PointingStory[] {
  const finalizedStoryIds = new Set(
    session.rounds
      .filter((round) => session.finalizedRoundIds.indexOf(round.id) >= 0)
      .map((round) => round.storyId)
  );
  const activeStoryId = session.rounds.find((round) => round.id === session.activeRoundId)?.storyId;
  return document.stories.filter(
    (story) =>
      story.status === 'Ready' && story.id !== activeStoryId && !finalizedStoryIds.has(story.id)
  );
}

/** Coordinates synchronized Lobby creation and entry over one team Fluid document. */
export class VotingSessionService implements IVotingSessionService {
  private readonly closingHandles = new Set<TeamDocumentHandle>();
  /**
   * @param repository - Configured SharePoint and Fluid repository.
   * @param currentUser - Current delegated user.
   * @param createId - Opaque identifier generator.
   * @param now - ISO timestamp provider.
   * @param participantStorage - Optional browser-session adapter for anonymous reconnect state.
   */
  public constructor(
    private readonly repository: TeamRepository,
    private readonly currentUser: UserReference,
    private readonly createId: () => string,
    private readonly now: () => string,
    private readonly participantStorage?: IParticipantSessionStorage
  ) {}

  /** @inheritdoc */
  public async listHostedTeams(): Promise<readonly HostedTeamSummary[]> {
    return (await this.repository.listHostedTeams(this.currentUser)).filter(
      (team) => team.isActive
    );
  }

  /** @inheritdoc */
  public async listVotingTeams(): Promise<readonly VotingTeamSummary[]> {
    const [hostedTeams, participantTeams] = await Promise.all([
      this.repository.listHostedTeams(this.currentUser),
      this.repository.listParticipatingTeams(this.currentUser)
    ]);
    const teams = new Map<string, VotingTeamSummary>();
    hostedTeams
      .filter((team) => team.isActive)
      .forEach((team) => teams.set(team.teamId, { ...team, relationship: 'Host' }));
    participantTeams
      .filter(
        (team) => team.isActive && team.activeSessionId !== undefined && !teams.has(team.teamId)
      )
      .forEach((team) => teams.set(team.teamId, { ...team, relationship: 'Participant' }));
    return Array.from(teams.values());
  }

  /** @inheritdoc */
  public async prepareSession(team: HostedTeamSummary): Promise<VotingSessionContext> {
    const handle = await this.repository.loadTeamDocument(team.driveItemId);
    try {
      const document = handle.getSnapshot();
      this.requireMatchingTeam(document, team.teamId);
      if (!isHostedBy(document.team, this.currentUser)) {
        throw new VotingSessionError(
          'host-required',
          'Only a current team host can prepare voting.'
        );
      }
      if (!document.team.isActive) {
        throw new VotingSessionError(
          'inactive-team',
          'Activate this team before preparing voting.'
        );
      }
      const open = this.findOpenSession(document);
      if (open !== undefined) {
        return this.createContext(team, handle, open.id);
      }
      const timestamp = this.now();
      const session: VotingSession = {
        id: this.createId(),
        teamId: document.team.id,
        status: 'Lobby',
        settings: {
          ...document.team.settings,
          scaleValues: [...document.team.settings.scaleValues]
        },
        participants: [],
        rounds: [],
        finalizedRoundIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(document.team.settings.votingMode === 'Named'
          ? { createdBy: this.currentUser, updatedBy: this.currentUser }
          : {})
      };
      handle.prepareVotingSession(session, timestamp);
      await handle.waitForSaved();
      await this.repository.updateTeamMetadata(handle);
      const authoritative = handle.getSnapshot();
      const winner = this.findOpenSession(authoritative);
      if (winner === undefined) {
        throw new VotingSessionError('save-failure', 'The voting Lobby could not be confirmed.');
      }
      return this.createContext(team, handle, winner.id);
    } catch (error: unknown) {
      handle.dispose();
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public async joinSession(teamId: string, sessionId: string): Promise<VotingSessionContext> {
    try {
      const team = await this.repository.findAccessibleTeam(teamId);
      const handle = await this.repository.loadTeamDocument(team.driveItemId);
      try {
        const document = handle.getSnapshot();
        this.requireMatchingTeam(document, teamId);
        if (!document.team.isActive) {
          throw new VotingSessionError('inactive-team', 'This team is inactive.');
        }
        const session = document.sessions.find((candidate) => candidate.id === sessionId);
        if (session === undefined) {
          throw new VotingSessionError(
            'invalid-session',
            'This voting session is no longer available.'
          );
        }
        if (session.status === 'Ended') {
          this.clearAnonymousReconnectState(teamId, session);
          throw new VotingSessionError('ended-session', 'This voting session has ended.');
        }
        if (document.openSessionId !== sessionId) {
          throw new VotingSessionError(
            'invalid-session',
            'This voting session is no longer available.'
          );
        }
        const participant = this.joinParticipant(handle, session, teamId);
        await handle.waitForSaved();
        return this.createContext(team, handle, sessionId, participant.id);
      } catch (error: unknown) {
        handle.dispose();
        throw error;
      }
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public async startVoting(context: VotingSessionContext): Promise<VotingSession> {
    const document = context.getDocument();
    if (!isHostedBy(document.team, this.currentUser)) {
      throw new VotingSessionError('host-required', 'Only a current team host can start voting.');
    }
    const current = document.sessions.find((session) => session.id === document.openSessionId);
    if (current === undefined || current.id !== context.getSession().id) {
      throw new VotingSessionError(
        'invalid-session',
        'This voting session is no longer available.'
      );
    }
    if (current.status === 'Active') {
      return current;
    }
    if (current.status === 'Ended') {
      throw new VotingSessionError('ended-session', 'This voting session has ended.');
    }
    const timestamp = this.now();
    const started: VotingSession = {
      ...current,
      status: 'Active',
      updatedAt: timestamp,
      ...(current.settings.votingMode === 'Named' ? { updatedBy: this.currentUser } : {})
    };
    context.handle.updateSessions(
      document.sessions.map((session) => (session.id === started.id ? started : session)),
      started.id,
      timestamp
    );
    try {
      await context.handle.waitForSaved();
      await this.repository.updateTeamMetadata(context.handle);
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public async selectStory(context: VotingSessionContext, storyId: string): Promise<VotingSession> {
    return this.selectOrReplaceStory(context, storyId, false);
  }

  /** @inheritdoc */
  public async replaceStory(
    context: VotingSessionContext,
    storyId: string
  ): Promise<VotingSession> {
    return this.selectOrReplaceStory(context, storyId, true);
  }

  /** @inheritdoc */
  public async castVote(
    context: VotingSessionContext,
    roundId: string,
    scaleValue: string
  ): Promise<VotingSession> {
    const participantId = context.participantId;
    if (participantId === undefined) {
      throw new VotingSessionError(
        'participant-required',
        'Join this voting session before casting a vote.'
      );
    }
    try {
      const result = context.handle.castVotingVote(context.getSession().id, roundId, {
        participantId,
        value: scaleValue,
        castAt: this.now()
      });
      if (result !== 'cast') {
        throw this.createVoteMutationError(result);
      }
      await context.handle.waitForSaved();
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public async startTimer(context: VotingSessionContext, roundId: string): Promise<VotingSession> {
    return this.runTimerCommand(context, roundId, 'start');
  }

  /** @inheritdoc */
  public async stopTimer(context: VotingSessionContext, roundId: string): Promise<VotingSession> {
    return this.runTimerCommand(context, roundId, 'stop');
  }

  /** @inheritdoc */
  public async resetTimer(context: VotingSessionContext, roundId: string): Promise<VotingSession> {
    return this.runTimerCommand(context, roundId, 'reset');
  }

  /** @inheritdoc */
  public async revealResults(
    context: VotingSessionContext,
    roundId: string
  ): Promise<VotingSession> {
    try {
      const result = context.handle.revealVotingRound(
        context.getSession().id,
        roundId,
        this.currentUser,
        this.now()
      );
      if (result !== 'revealed' && result !== 'already-revealed') {
        const errors = {
          'invalid-session': new VotingSessionError(
            'invalid-session',
            'This voting session is no longer active.'
          ),
          'host-required': new VotingSessionError(
            'host-required',
            'Only a current team host can reveal results.'
          ),
          'invalid-round': new VotingSessionError(
            'invalid-round',
            'Voting has moved to another story.'
          )
        } as const;
        throw errors[result];
      }
      await context.handle.waitForSaved();
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public async undoReveal(context: VotingSessionContext, roundId: string): Promise<VotingSession> {
    try {
      const result = context.handle.undoVotingRoundReveal(
        context.getSession().id,
        roundId,
        this.currentUser,
        this.now()
      );
      if (result !== 'reopened') {
        const errors = {
          'invalid-session': new VotingSessionError(
            'invalid-session',
            'This voting session is no longer active.'
          ),
          'host-required': new VotingSessionError(
            'host-required',
            'Only a current team host can undo a reveal.'
          ),
          'invalid-round': new VotingSessionError(
            'invalid-round',
            'Only the current revealed round can be reopened.'
          )
        } as const;
        throw errors[result];
      }
      await context.handle.waitForSaved();
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public async finalizeEstimate(
    context: VotingSessionContext,
    roundId: string,
    scaleValue: string
  ): Promise<VotingSession> {
    try {
      const result = context.handle.finalizeVotingRound(
        context.getSession().id,
        roundId,
        scaleValue,
        this.currentUser,
        this.now()
      );
      if (result !== 'finalized' && result !== 'already-finalized') {
        const errors = {
          'invalid-session': new VotingSessionError(
            'invalid-session',
            'This voting session is no longer active.'
          ),
          'host-required': new VotingSessionError(
            'host-required',
            'Only a current team host can assign the final estimate.'
          ),
          'invalid-round': new VotingSessionError(
            'invalid-round',
            'These results are no longer available for assignment.'
          ),
          'invalid-estimate': new VotingSessionError(
            'invalid-estimate',
            'Select a value from this session scale.'
          ),
          'invalid-story': new VotingSessionError(
            'invalid-round',
            'The source story is no longer ready for assignment.'
          )
        } as const;
        throw errors[result];
      }
      await context.handle.waitForSaved();
      await this.repository.updateTeamMetadata(context.handle);
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /** @inheritdoc */
  public subscribe(context: VotingSessionContext, listener: () => void): () => void {
    return context.handle.subscribe(() => {
      const session = context.getSession();
      if (session.status === 'Ended') {
        this.clearAnonymousReconnectState(context.team.teamId, session);
      }
      const participantId = context.participantId;
      if (participantId !== undefined) {
        const participant = context
          .getSession()
          .participants.find((candidate) => candidate.id === participantId);
        const connection = context.handle.getConnectionState();
        if (participant !== undefined && participant.presence.connection !== connection) {
          context.handle.setVotingParticipantConnection(
            context.getSession().id,
            participantId,
            connection,
            this.now()
          );
        }
      }
      listener();
    });
  }

  /** @inheritdoc */
  public closeSession(context: VotingSessionContext): void {
    if (this.closingHandles.has(context.handle)) {
      return;
    }
    this.closingHandles.add(context.handle);
    const participantId = context.participantId;
    if (participantId !== undefined) {
      this.markDisconnected(context);
    }
    const dispose = (): void => {
      context.handle.dispose();
      this.closingHandles.delete(context.handle);
    };
    // eslint-disable-next-line no-void -- Close owns save completion and always disposes its handle.
    void context.handle.waitForSaved().then(dispose, dispose);
  }

  /** @inheritdoc */
  public markDisconnected(context: VotingSessionContext): void {
    if (context.participantId === undefined) {
      return;
    }
    context.handle.setVotingParticipantConnection(
      context.getSession().id,
      context.participantId,
      'Disconnected',
      this.now()
    );
  }

  /**
   * Runs one host timer command and waits for Fluid save acknowledgement.
   *
   * @param context - Verified live session context.
   * @param roundId - Current active round identifier.
   * @param command - Host timer transition to apply.
   * @returns The synchronized session after save acknowledgement.
   */
  private async runTimerCommand(
    context: VotingSessionContext,
    roundId: string,
    command: import('../repository/teamRepository').VotingTimerCommand
  ): Promise<VotingSession> {
    try {
      const result = context.handle.updateVotingTimer(
        context.getSession().id,
        roundId,
        command,
        this.currentUser,
        this.now()
      );
      if (result !== 'updated') {
        const messages = {
          'invalid-session': 'This voting session is no longer active.',
          'host-required': 'Only a current team host can control the timer.',
          'invalid-round': 'The timer belongs to a different active story.',
          'invalid-command': 'The timer has already moved to another state.',
          'timer-disabled': 'This voting session does not use a timer.'
        } as const;
        const code =
          result === 'host-required'
            ? 'host-required'
            : result === 'invalid-command'
              ? 'invalid-timer-command'
              : 'invalid-round';
        throw new VotingSessionError(code, messages[result]);
      }
      await context.handle.waitForSaved();
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Applies host selection through the store's authoritative transaction guards.
   *
   * @param context - Verified live session context.
   * @param storyId - Ready story selected by the host.
   * @param replaceActive - Whether an unvoted active round may be cancelled and replaced.
   * @returns The synchronized session after save acknowledgement.
   */
  private async selectOrReplaceStory(
    context: VotingSessionContext,
    storyId: string,
    replaceActive: boolean
  ): Promise<VotingSession> {
    const timestamp = this.now();
    try {
      const result = context.handle.selectVotingStory(
        context.getSession().id,
        storyId,
        this.createId(),
        this.currentUser,
        replaceActive,
        timestamp
      );
      if (result !== 'selected') {
        const errors = {
          'invalid-session': new VotingSessionError(
            'invalid-session',
            'This voting session is no longer active.'
          ),
          'host-required': new VotingSessionError(
            'host-required',
            'Only a current team host can select the active story.'
          ),
          'invalid-story': new VotingSessionError(
            'invalid-story',
            'Select an available Ready story.'
          ),
          'active-round': new VotingSessionError(
            'active-round',
            'A story is already active for voting.'
          ),
          'round-has-votes': new VotingSessionError(
            'round-has-votes',
            'The active story cannot be replaced after voting begins.'
          )
        } as const;
        throw errors[result];
      }
      await context.handle.waitForSaved();
      return context.getSession();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Maps store vote guards to stable, privacy-safe UI failures.
   *
   * @param result - Expected rejected vote transaction outcome.
   * @returns A stable user-facing session error.
   */
  private createVoteMutationError(
    result: Exclude<ReturnType<TeamDocumentHandle['castVotingVote']>, 'cast'>
  ): VotingSessionError {
    switch (result) {
      case 'participant-required':
        return new VotingSessionError(
          'participant-required',
          'Join this voting session before casting a vote.'
        );
      case 'invalid-vote':
        return new VotingSessionError('invalid-vote', 'Select a value from this session scale.');
      case 'invalid-round':
        return new VotingSessionError(
          'invalid-round',
          'Voting has moved to another story. Select your vote again.'
        );
      default:
        return new VotingSessionError(
          'invalid-session',
          'This voting session is no longer active.'
        );
    }
  }

  /**
   * Creates a verified context over an owned live handle.
   *
   * @param team - Accessible SharePoint discovery summary.
   * @param handle - Owned live Fluid handle.
   * @param sessionId - Verified open session identifier.
   * @param participantId - Current browser's joined participant, when available.
   * @returns A synchronized session context.
   */
  private createContext(
    team: HostedTeamSummary,
    handle: TeamDocumentHandle,
    sessionId: string,
    participantId?: string
  ): VotingSessionContext {
    const getDocument = (): PlanningPokerDocumentRoot => handle.getSnapshot();
    const getSession = (): VotingSession => {
      const session = getDocument().sessions.find((candidate) => candidate.id === sessionId);
      if (session === undefined) {
        throw new VotingSessionError(
          'invalid-session',
          'This voting session is no longer available.'
        );
      }
      return session;
    };
    const document = getDocument();
    return {
      team,
      handle,
      isHost: isHostedBy(document.team, this.currentUser),
      isConfiguredMember: document.team.configuredMembers.some(
        (member) => member.objectId === this.currentUser.objectId
      ),
      participantId,
      getDocument,
      getSession,
      getConnectionState: () => handle.getConnectionState()
    };
  }

  /**
   * Joins the current user according to the immutable session privacy snapshot.
   *
   * @param handle - Live Fluid document handle.
   * @param session - Verified Lobby or Active session.
   * @param teamId - Stable team identifier used only to scope local reconnect state.
   * @returns The durable participant selected by the join transaction.
   */
  private joinParticipant(
    handle: TeamDocumentHandle,
    session: VotingSession,
    teamId: string
  ): SessionParticipant {
    const timestamp = this.now();
    if (session.settings.votingMode === 'Named') {
      const participant = handle.joinVotingSession(
        session.id,
        { kind: 'Named', participantId: this.createId(), user: this.currentUser },
        timestamp
      );
      if (participant === undefined) {
        throw new VotingSessionError('invalid-session', 'This voting session is no longer open.');
      }
      return participant;
    }
    const storage = this.getParticipantStorage();
    const storageKey = this.getAnonymousStorageKey(teamId, session.id);
    const savedParticipantId = this.loadAnonymousParticipantId(storage, storageKey);
    const participantId = savedParticipantId ?? this.createId();
    const participant = handle.joinVotingSession(
      session.id,
      { kind: 'Anonymous', participantId },
      timestamp
    );
    if (participant === undefined) {
      throw new VotingSessionError('invalid-session', 'This voting session is no longer open.');
    }
    if (savedParticipantId === undefined) {
      this.saveAnonymousParticipantId(storage, storageKey, participant.id);
    }
    return participant;
  }

  /** @returns Browser session storage when available and permitted. */
  private getParticipantStorage(): IParticipantSessionStorage | undefined {
    if (this.participantStorage !== undefined) {
      return this.participantStorage;
    }
    if (typeof window === 'undefined') {
      return undefined;
    }
    return {
      getItem: (key) => window.sessionStorage.getItem(key) ?? undefined,
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
      removeItem: (key) => window.sessionStorage.removeItem(key)
    };
  }

  /**
   * @param teamId - Stable opaque team identifier.
   * @param sessionId - Stable opaque session identifier.
   * @returns A browser-local key containing opaque team and session IDs only.
   */
  private getAnonymousStorageKey(teamId: string, sessionId: string): string {
    return `planningPoker:anonymous:${teamId}:${sessionId}`;
  }

  /**
   * Reads reconnect state while treating unavailable browser storage as an ordinary new join.
   *
   * @param storage - Optional browser-session adapter.
   * @param storageKey - Opaque session-scoped storage key.
   * @returns The prior participant ID, when valid and readable.
   */
  private loadAnonymousParticipantId(
    storage: IParticipantSessionStorage | undefined,
    storageKey: string
  ): string | undefined {
    try {
      return this.readAnonymousParticipantId(storage?.getItem(storageKey));
    } catch {
      return undefined;
    }
  }

  /**
   * Saves an opaque reconnect record without failing a successful collaborative join.
   *
   * @param storage - Optional browser-session adapter.
   * @param storageKey - Opaque session-scoped storage key.
   * @param participantId - Anonymous shared participant identifier.
   * @returns `void` after storage succeeds or is safely unavailable.
   */
  private saveAnonymousParticipantId(
    storage: IParticipantSessionStorage | undefined,
    storageKey: string,
    participantId: string
  ): void {
    try {
      storage?.setItem(
        storageKey,
        JSON.stringify({ reconnectToken: this.createId(), participantId })
      );
    } catch {
      // The participant remains joined; only same-tab alias reclamation is unavailable.
    }
  }

  /**
   * Clears browser-local anonymous reconnect state after authoritative session completion.
   *
   * @param teamId - Stable opaque team identifier.
   * @param session - Authoritative ended session snapshot.
   * @returns `void` after state is removed or browser storage is safely unavailable.
   */
  private clearAnonymousReconnectState(teamId: string, session: VotingSession): void {
    if (session.settings.votingMode !== 'Anonymous' || session.status !== 'Ended') {
      return;
    }
    try {
      this.getParticipantStorage()?.removeItem(this.getAnonymousStorageKey(teamId, session.id));
    } catch {
      // Ending remains authoritative even when browser storage cannot be modified.
    }
  }

  /**
   * Parses only the opaque participant identifier from untrusted browser state.
   *
   * @param value - Serialized reconnect record.
   * @returns A participant ID, or `undefined` for absent or malformed state.
   */
  private readAnonymousParticipantId(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value) as { participantId?: unknown; reconnectToken?: unknown };
      return typeof parsed.participantId === 'string' &&
        parsed.participantId.trim().length > 0 &&
        typeof parsed.reconnectToken === 'string' &&
        parsed.reconnectToken.trim().length > 0
        ? parsed.participantId
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * @param document - Authoritative Fluid snapshot.
   * @returns The Lobby or Active session referenced by the root.
   */
  private findOpenSession(document: PlanningPokerDocumentRoot): VotingSession | undefined {
    if (document.openSessionId === undefined) {
      return undefined;
    }
    return document.sessions.find(
      (session) =>
        session.id === document.openSessionId &&
        (session.status === 'Lobby' || session.status === 'Active')
    );
  }

  /**
   * Throws when a loaded document does not match its opaque route identity.
   *
   * @param document - Loaded authoritative snapshot.
   * @param teamId - Expected opaque team identifier.
   */
  private requireMatchingTeam(document: PlanningPokerDocumentRoot, teamId: string): void {
    if (document.team.id !== teamId) {
      throw new VotingSessionError('invalid-session', 'The voting link does not match this team.');
    }
  }

  /**
   * Maps repository and unexpected failures to the session UI contract.
   *
   * @param error - Untrusted caught failure.
   * @returns A safe typed session error.
   */
  private normalizeError(error: unknown): VotingSessionError {
    if (error instanceof VotingSessionError) {
      return error;
    }
    if (error instanceof TeamRepositoryError) {
      if (error.code === 'access-denied') {
        return new VotingSessionError(
          'access-denied',
          'SharePoint denied access to this voting session.'
        );
      }
      if (error.code === 'incompatible-schema') {
        return new VotingSessionError('incompatible-schema', error.message);
      }
      if (error.code === 'not-found') {
        return new VotingSessionError(
          'not-found',
          'The team could not be found or is not accessible.'
        );
      }
      if (error.code === 'metadata-sync') {
        return new VotingSessionError('save-failure', error.message);
      }
    }
    return new VotingSessionError(
      'save-failure',
      'The voting session could not be saved. Check the collaboration connection and try again.'
    );
  }
}
