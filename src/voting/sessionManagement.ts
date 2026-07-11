import type {
  ConnectionState,
  PlanningPokerDocumentRoot,
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
  getDocument(): PlanningPokerDocumentRoot;
  getSession(): VotingSession;
  getConnectionState(): ConnectionState;
}

/** Session-entry operations consumed by normal and focused Voting views. */
export interface IVotingSessionService {
  listHostedTeams(): Promise<readonly HostedTeamSummary[]>;
  prepareSession(team: HostedTeamSummary): Promise<VotingSessionContext>;
  joinSession(teamId: string, sessionId: string): Promise<VotingSessionContext>;
  startVoting(context: VotingSessionContext): Promise<VotingSession>;
  subscribe(context: VotingSessionContext, listener: () => void): () => void;
  closeSession(context: VotingSessionContext): void;
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

/** Coordinates synchronized Lobby creation and entry over one team Fluid document. */
export class VotingSessionService implements IVotingSessionService {
  /**
   * @param repository - Configured SharePoint and Fluid repository.
   * @param currentUser - Current delegated user.
   * @param createId - Opaque identifier generator.
   * @param now - ISO timestamp provider.
   */
  public constructor(
    private readonly repository: TeamRepository,
    private readonly currentUser: UserReference,
    private readonly createId: () => string,
    private readonly now: () => string
  ) {}

  /** @inheritdoc */
  public async listHostedTeams(): Promise<readonly HostedTeamSummary[]> {
    return (await this.repository.listHostedTeams(this.currentUser)).filter(
      (team) => team.isActive
    );
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
        createdBy: this.currentUser,
        updatedAt: timestamp,
        updatedBy: this.currentUser
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
          throw new VotingSessionError('ended-session', 'This voting session has ended.');
        }
        if (document.openSessionId !== sessionId) {
          throw new VotingSessionError(
            'invalid-session',
            'This voting session is no longer available.'
          );
        }
        return this.createContext(team, handle, sessionId);
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
      updatedBy: this.currentUser
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
  public subscribe(context: VotingSessionContext, listener: () => void): () => void {
    return context.handle.subscribe(listener);
  }

  /** @inheritdoc */
  public closeSession(context: VotingSessionContext): void {
    context.handle.dispose();
  }

  /**
   * Creates a verified context over an owned live handle.
   *
   * @param team - Accessible SharePoint discovery summary.
   * @param handle - Owned live Fluid handle.
   * @param sessionId - Verified open session identifier.
   * @returns A synchronized session context.
   */
  private createContext(
    team: HostedTeamSummary,
    handle: TeamDocumentHandle,
    sessionId: string
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
      getDocument,
      getSession,
      getConnectionState: () => handle.getConnectionState()
    };
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
    }
    return new VotingSessionError(
      'save-failure',
      'The voting session could not be saved. Check the collaboration connection and try again.'
    );
  }
}
