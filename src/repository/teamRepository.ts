import type {
  PlanningPokerDocumentRoot,
  PlanningPokerTeam,
  PointingStory,
  SessionParticipant,
  StoryStatus,
  TeamSettings,
  UserReference,
  VoteRecord,
  VotingSession
} from '../domain/planningPokerDomain';
import type { IPlanningPokerStorageConfiguration } from '../storage/storageTypes';

/** Stable error categories that the UI can translate into non-sensitive messages. */
export type TeamRepositoryErrorCode =
  | 'not-configured'
  | 'not-found'
  | 'access-denied'
  | 'incompatible-schema'
  | 'corrupt-document'
  | 'duplicate-title'
  | 'invalid-title'
  | 'invalid-team'
  | 'host-mismatch'
  | 'stale-command'
  | 'disconnected'
  | 'save-timeout'
  | 'metadata-sync'
  | 'open-session'
  | 'recycle-failure';

/** Represents an expected repository failure without exposing transport details. */
export class TeamRepositoryError extends Error {
  /**
   * Creates a typed repository error.
   *
   * @param code - The stable category used by callers.
   * @param message - The non-sensitive diagnostic message.
   */
  public constructor(
    public readonly code: TeamRepositoryErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TeamRepositoryError';
    Object.setPrototypeOf(this, TeamRepositoryError.prototype);
  }
}

/** Describes a team using lightweight SharePoint metadata. */
export interface HostedTeamSummary {
  /** The stable team identifier. */
  readonly teamId: string;
  /** The ODSP drive item identifier used to load the Fluid container. */
  readonly driveItemId: string;
  /** The team title displayed in discovery results. */
  readonly title: string;
  /** Whether the team is available for current work. */
  readonly isActive: boolean;
  /** Current lobby or active session projected into SharePoint discovery metadata. */
  readonly activeSessionId?: string;
}

/** Identity-safe input for a participant join transaction. */
export type SessionParticipantJoin =
  | {
      readonly kind: 'Named';
      readonly participantId: string;
      readonly user: UserReference;
    }
  | {
      readonly kind: 'Anonymous';
      readonly participantId: string;
    };

/** Expected outcomes from the transaction that selects an active voting story. */
export type VotingStorySelectionResult =
  | 'selected'
  | 'invalid-session'
  | 'host-required'
  | 'invalid-story'
  | 'active-round'
  | 'round-has-votes';

/** Expected outcomes from the transaction that upserts a participant vote. */
export type VotingVoteResult =
  | 'cast'
  | 'already-cast'
  | 'reconciled-conflict'
  | 'invalid-session'
  | 'participant-required'
  | 'invalid-round'
  | 'invalid-vote'
  | 'invalid-command';

/** Host timer commands accepted by the active-round transaction. */
export type VotingTimerCommand = 'start' | 'stop' | 'reset';

/** Expected outcomes from a synchronized timer command. */
export type VotingTimerResult =
  | 'updated'
  | 'invalid-session'
  | 'host-required'
  | 'invalid-round'
  | 'invalid-command'
  | 'timer-disabled';

/** Expected outcomes from revealing the current voting round. */
export type VotingRevealResult =
  | 'revealed'
  | 'already-revealed'
  | 'invalid-session'
  | 'host-required'
  | 'invalid-round';

/** Expected outcomes from reopening a revealed round for voting. */
export type VotingUndoRevealResult =
  | 'reopened'
  | 'invalid-session'
  | 'host-required'
  | 'invalid-round';

/** Expected outcomes from finalizing a revealed estimate. */
export type VotingFinalizeResult =
  | 'finalized'
  | 'already-finalized'
  | 'reconciled-conflict'
  | 'invalid-session'
  | 'host-required'
  | 'invalid-round'
  | 'invalid-estimate'
  | 'invalid-story'
  | 'invalid-command';

/** Expected outcomes from ending an open voting session. */
export type VotingEndResult = 'ended' | 'already-ended' | 'invalid-session' | 'host-required';

/** Stable vote intent persisted for retry and deterministic concurrent-value resolution. */
export interface VotingVoteCommand extends VoteRecord {
  /** Opaque ID reused when this exact vote intent is retried. */
  readonly operationId: string;
  /** Prior authoritative vote operation observed by the caller. */
  readonly supersedesOperationId?: string;
}

/** Safe reasons returned when an intent command cannot change current shared state. */
export type IntentCommandFailureReason =
  | 'team-not-found'
  | 'host-required'
  | 'invalid-team'
  | 'team-changed'
  | 'story-not-found'
  | 'story-changed'
  | 'story-in-open-round'
  | 'invalid-transition'
  | 'duplicate-id'
  | 'session-not-found'
  | 'session-not-open'
  | 'session-not-lobby';

/** Outcome shared by focused commands that recheck the current live tree before mutation. */
export type IntentCommandResult =
  | { readonly status: 'applied' }
  | { readonly status: 'idempotent' }
  | {
      readonly status: 'conflict' | 'stale' | 'rejected';
      readonly reason: IntentCommandFailureReason;
    };

/** Form-owned team fields applied only when the edit baseline is still current. */
export interface TeamEditCommand {
  readonly teamId: string;
  readonly expectedUpdatedAt: string;
  readonly title?: string;
  readonly description?: string;
  readonly isActive?: boolean;
  readonly hosts?: readonly UserReference[];
  readonly configuredMembers?: readonly UserReference[];
  readonly settings?: TeamSettings;
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** One independently editable team activity flag. */
export interface TeamActiveCommand {
  readonly teamId: string;
  readonly expectedIsActive: boolean;
  readonly isActive: boolean;
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** Creates one detached story without replacing the authoritative story sequence. */
export interface StoryCreateCommand {
  readonly story: PointingStory;
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** Atomically appends a submitted set of detached stories. */
export interface StoryImportCommand {
  readonly stories: readonly PointingStory[];
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** Patches only editable content on the current story node. */
export interface StoryEditCommand {
  readonly storyId: string;
  readonly expectedUpdatedAt: string;
  readonly title: string;
  readonly description: string;
  readonly link?: string;
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** Applies one guarded story lifecycle transition. */
export interface StoryTransitionCommand {
  readonly storyId: string;
  readonly status: StoryStatus;
  readonly allowedFrom: readonly StoryStatus[];
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** Deletes one current story when no unfinished round owns it. */
export interface StoryDeleteCommand {
  readonly storyId: string;
  readonly currentUser: UserReference;
  readonly updatedAt: string;
}

/** Owns one loaded Fluid document and its subscription lifecycle. */
export interface TeamDocumentHandle {
  /** The stable team identifier. */
  readonly teamId: string;
  /** The ODSP drive item identifier. */
  readonly driveItemId: string;
  /** @returns A plain serializable snapshot of the current shared state. */
  getSnapshot(): PlanningPokerDocumentRoot;
  /** @returns The current collaboration connection state. */
  getConnectionState(): 'Connected' | 'Disconnected';
  /** Applies a complete form edit only when its authoritative team baseline is unchanged. */
  editTeam(command: TeamEditCommand): IntentCommandResult;
  /** Changes only team activity while preserving concurrent roster and settings work. */
  setTeamActive(command: TeamActiveCommand): IntentCommandResult;
  /** Appends one new story through the SharedTree sequence API. */
  createStory(command: StoryCreateCommand): IntentCommandResult;
  /** Atomically appends detached import rows without replacing existing stories. */
  importStories(command: StoryImportCommand): IntentCommandResult;
  /** Patches editable content on one current story node. */
  editStory(command: StoryEditCommand): IntentCommandResult;
  /** Applies one lifecycle transition to a current story node. */
  transitionStory(command: StoryTransitionCommand): IntentCommandResult;
  /** Removes one current story that is not owned by an unfinished round. */
  deleteStory(command: StoryDeleteCommand): IntentCommandResult;
  /**
   * Creates a Lobby only when the transaction observes no existing open session.
   *
   * @param session - Candidate Lobby with an immutable identifier and settings snapshot.
   * @param updatedAt - ISO timestamp for document Last Activity when creation wins.
   * @returns The candidate ID, or the existing open Lobby/Active session ID.
   */
  prepareVotingSession(session: VotingSession, updatedAt: string): string;
  /** Moves the matching authoritative Lobby to Active without replacing its participants. */
  startVotingSession(
    sessionId: string,
    currentUser: UserReference,
    updatedAt: string
  ): IntentCommandResult;
  /**
   * Joins or reconnects one participant inside the Fluid transaction boundary.
   *
   * @param sessionId - Open Lobby or Active session identifier.
   * @param participant - Identity-safe participant join request.
   * @param timestamp - ISO join or reconnect timestamp.
   * @returns The durable participant selected or created by the transaction.
   */
  joinVotingSession(
    sessionId: string,
    participant: SessionParticipantJoin,
    timestamp: string
  ): SessionParticipant | undefined;
  /**
   * Selects or replaces the active story while rechecking host, lifecycle, and eligibility guards.
   */
  selectVotingStory(
    sessionId: string,
    storyId: string,
    roundId: string,
    currentUser: UserReference,
    replaceActive: boolean,
    timestamp: string
  ): VotingStorySelectionResult;
  /** Upserts one joined participant's vote after rechecking the active round and scale snapshot. */
  castVotingVote(sessionId: string, roundId: string, vote: VotingVoteCommand): VotingVoteResult;
  /** Applies one host timer command after rechecking the current active round. */
  updateVotingTimer(
    sessionId: string,
    roundId: string,
    command: VotingTimerCommand,
    currentUser: UserReference,
    timestamp: string
  ): VotingTimerResult;
  /** Reveals the current round through a host-authorized manual command. */
  revealVotingRound(
    sessionId: string,
    roundId: string,
    currentUser: UserReference,
    timestamp: string
  ): VotingRevealResult;
  /** Reopens the current revealed round while preserving its votes and stopped timer. */
  undoVotingRoundReveal(
    sessionId: string,
    roundId: string,
    currentUser: UserReference,
    timestamp: string
  ): VotingUndoRevealResult;
  /** Finalizes a revealed round and assigns its story estimate atomically. */
  finalizeVotingRound(
    sessionId: string,
    roundId: string,
    scaleValue: string,
    currentUser: UserReference,
    timestamp: string,
    operationId: string,
    supersedesOperationId?: string
  ): VotingFinalizeResult;
  /** Ends the matching open session and cancels any unfinished active round atomically. */
  endVotingSession(
    sessionId: string,
    currentUser: UserReference,
    timestamp: string
  ): VotingEndResult;
  /**
   * Updates technical participant presence without deleting durable roster or vote state.
   *
   * @param sessionId - Open session identifier.
   * @param participantId - Durable session participant identifier.
   * @param connection - Current collaboration connection state.
   * @param timestamp - ISO presence observation timestamp.
   * @returns `void` after the local transaction is applied.
   */
  setVotingParticipantConnection(
    sessionId: string,
    participantId: string,
    connection: 'Connected' | 'Disconnected',
    timestamp: string
  ): void;
  /** @returns A promise that resolves only after Fluid acknowledges the pending mutation. */
  waitForSaved(): Promise<void>;
  /**
   * @param listener - The callback invoked after shared state changes.
   * @returns An idempotent unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
  /** @returns `void` after owned subscriptions and clients are released. */
  dispose(): void;
}

/** Defines the SharePoint and Fluid operations required by the domain repository. */
export interface ITeamDocumentStore {
  /** @returns All team summaries the current user can access. */
  list(): Promise<readonly HostedTeamSummary[]>;
  /**
   * Queries host metadata for the supplied user; SharePoint remains the authorization boundary.
   *
   * @param currentUser - The user whose hosted teams should be discovered.
   * @returns Team summaries whose host metadata contains the user.
   */
  listHostedBy(currentUser: UserReference): Promise<readonly HostedTeamSummary[]>;
  /**
   * Queries configured-participant metadata for the supplied user.
   *
   * @param currentUser - The user whose configured teams should be discovered.
   * @returns Team summaries whose participant metadata contains the user.
   */
  listParticipatingIn(currentUser: UserReference): Promise<readonly HostedTeamSummary[]>;
  /**
   * @param team - The initial team state.
   * @param fileName - The validated Fluid file name.
   * @returns The attached team document handle.
   */
  create(team: PlanningPokerTeam, fileName: string): Promise<TeamDocumentHandle>;
  /** @param id - The ODSP drive item identifier. @returns The loaded document handle. */
  load(id: string): Promise<TeamDocumentHandle>;
  /**
   * @param teamId - The stable team identifier.
   * @param title - The validated new title.
   * @returns A promise that resolves when the rename is acknowledged.
   */
  rename(teamId: string, title: string): Promise<void>;
  /**
   * Moves one Fluid file to the SharePoint recycle bin.
   *
   * @param driveItemId - Immutable ODSP drive item identifier.
   * @returns The optional recycle-bin identifier supplied by the backing API.
   */
  recycle(driveItemId: string): Promise<{ readonly recycleBinItemId?: string }>;
  /**
   * Refreshes the SharePoint discovery index from an authoritative Fluid snapshot.
   *
   * @param document - The validated plain document snapshot.
   * @returns A promise that resolves when SharePoint acknowledges the metadata update.
   */
  updateMetadata(document: PlanningPokerDocumentRoot): Promise<void>;
}

/** Represents the SharePoint discovery values projected from one Fluid document. */
export interface TeamMetadataProjection {
  /** Built-in SharePoint title. */
  readonly title: string;
  /** Stable team identifier. */
  readonly teamId: string;
  /** Application hosts projected to the multi-person field. */
  readonly hosts: readonly UserReference[];
  /** Configured members projected to the participants field. */
  readonly participants: readonly UserReference[];
  /** Whether the team can begin new work. */
  readonly isActive: boolean;
  /** Persisted document schema version. */
  readonly schemaVersion: string;
  /** Current lobby or active session identifier. */
  readonly activeSessionId?: string;
  /** ISO timestamp of the latest meaningful Fluid activity. */
  readonly lastActivity: string;
}

const INVALID_FILE_NAME = /["*:<>?\\/|]/;
const RESERVED_NAMES = new Set(['con', 'prn', 'aux', 'nul', 'com1', 'lpt1']);

/**
 * Validates a team title against SharePoint file-name constraints.
 *
 * @param title - The untrusted user-entered title.
 * @returns A user-facing error, or `undefined` when the title is valid.
 */
export function validateTeamTitle(title: string): string | undefined {
  const value = title.trim();
  if (value.length === 0) {
    return 'Enter a team title.';
  }
  if (INVALID_FILE_NAME.test(value) || value.endsWith('.')) {
    return 'The title is not a valid SharePoint file name.';
  }
  if (RESERVED_NAMES.has(value.toLocaleLowerCase())) {
    return 'The title uses a reserved file name.';
  }
  return undefined;
}

/**
 * Determines whether a user is listed as an application-level host.
 *
 * @remarks SharePoint permissions, rather than this UI role, authorize protected operations.
 * @param team - The team to inspect.
 * @param currentUser - The current delegated user.
 * @returns `true` when the user is present in host metadata.
 */
export function isHostedBy(team: PlanningPokerTeam, currentUser: UserReference): boolean {
  return team.hosts.some((host) => host.objectId === currentUser.objectId);
}

/**
 * Compares ordered user-reference values when deriving a focused team patch.
 *
 * @param left - Baseline roster.
 * @param right - Submitted roster.
 * @returns Whether every ordered identity value matches.
 */
function areUserReferencesEqual(
  left: readonly UserReference[],
  right: readonly UserReference[]
): boolean {
  return (
    left.length === right.length &&
    left.every((user, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        user.objectId === other.objectId &&
        user.displayName === other.displayName &&
        user.loginName === other.loginName &&
        user.sharePointUserId === other.sharePointUserId
      );
    })
  );
}

/**
 * Compares team settings when deriving a focused team patch.
 *
 * @param left - Baseline settings.
 * @param right - Submitted settings.
 * @returns Whether scalar and ordered scale values match.
 */
function areTeamSettingsEqual(left: TeamSettings, right: TeamSettings): boolean {
  return (
    left.scaleKind === right.scaleKind &&
    left.timerEnabled === right.timerEnabled &&
    left.timerDurationSeconds === right.timerDurationSeconds &&
    left.votingMode === right.votingMode &&
    left.scaleValues.length === right.scaleValues.length &&
    left.scaleValues.every((value, index) => value === right.scaleValues[index])
  );
}

/**
 * Projects the authoritative Fluid document into lightweight SharePoint discovery metadata.
 *
 * @param document - The validated plain document snapshot.
 * @returns The complete team metadata projection.
 */
export function projectTeamMetadata(document: PlanningPokerDocumentRoot): TeamMetadataProjection {
  return {
    title: document.team.title,
    teamId: document.team.id,
    hosts: document.team.hosts,
    participants: document.team.configuredMembers,
    isActive: document.team.isActive,
    schemaVersion: document.schemaVersion,
    activeSessionId: document.openSessionId,
    lastActivity: document.updatedAt
  };
}

/** Coordinates domain validation with a SharePoint- and Fluid-backed document store. */
export class TeamRepository {
  /**
   * Creates a repository for one configured web-part instance.
   *
   * @param storage - The validated storage configuration, when available.
   * @param store - The document-store boundary.
   */
  public constructor(
    private readonly storage: IPlanningPokerStorageConfiguration | undefined,
    private readonly store: ITeamDocumentStore
  ) {}

  /**
   * Lists teams whose host metadata contains the current user.
   *
   * @param currentUser - The current delegated user.
   * @returns The matching lightweight team summaries.
   */
  public async listHostedTeams(currentUser: UserReference): Promise<readonly HostedTeamSummary[]> {
    this.requireStorage();
    return this.store.listHostedBy(currentUser);
  }

  /**
   * Lists teams whose configured participant metadata contains the current user.
   *
   * @param currentUser - Current delegated user with a site-scoped SharePoint ID.
   * @returns Matching lightweight team summaries.
   */
  public async listParticipatingTeams(
    currentUser: UserReference
  ): Promise<readonly HostedTeamSummary[]> {
    this.requireStorage();
    return this.store.listParticipatingIn(currentUser);
  }

  /** @returns All team summaries the delegated user can access through SharePoint. */
  public async listAccessibleTeams(): Promise<readonly HostedTeamSummary[]> {
    this.requireStorage();
    return this.store.list();
  }

  /**
   * Resolves one opaque team identifier without relying on a mutable file title.
   *
   * @param teamId - Stable team identifier from a validated application route.
   * @returns The accessible discovery summary.
   */
  public async findAccessibleTeam(teamId: string): Promise<HostedTeamSummary> {
    const team = (await this.listAccessibleTeams()).find(
      (candidate) => candidate.teamId === teamId
    );
    if (team === undefined) {
      throw new TeamRepositoryError(
        'not-found',
        'The team could not be found or is not accessible.'
      );
    }
    return team;
  }

  /**
   * Validates and creates one team Fluid document.
   *
   * @param team - The initial team state.
   * @returns The attached document handle.
   * @throws Throws `TeamRepositoryError` when storage is missing or the title is invalid or used.
   */
  public async createTeamDocument(team: PlanningPokerTeam): Promise<TeamDocumentHandle> {
    this.requireStorage();
    await this.validateAvailableTitle(team.title);
    this.validateTeam(team);
    const handle = await this.store.create(team, `${team.title.trim()}.fluid`);
    await handle.waitForSaved();
    await this.updateTeamMetadata(handle);
    return handle;
  }

  /**
   * Loads one team document after confirming storage is configured.
   *
   * @param id - The ODSP drive item identifier.
   * @returns The loaded document handle.
   */
  public async loadTeamDocument(id: string): Promise<TeamDocumentHandle> {
    this.requireStorage();
    return this.store.load(id);
  }

  /**
   * Validates and renames a team document.
   *
   * @param teamId - The stable team identifier.
   * @param title - The requested team title.
   * @returns A promise that resolves when the rename is acknowledged.
   * @throws Throws `TeamRepositoryError` when storage is missing or the title is invalid.
   */
  public async renameTeamDocument(teamId: string, title: string): Promise<void> {
    this.requireStorage();
    await this.validateAvailableTitle(title, teamId);
    await this.store.rename(teamId, title.trim());
  }

  /**
   * Applies an authorized team edit, waits for durable Fluid save, and refreshes discovery metadata.
   *
   * @param handle - The loaded document handle that owns the Fluid transaction boundary.
   * @param currentUser - The delegated user requesting the mutation.
   * @param expectedTeam - Team snapshot used to create the edit draft.
   * @param team - The complete next team state.
   * @returns A promise that resolves after Fluid, rename, and metadata operations are acknowledged.
   * @throws Throws `TeamRepositoryError` when Fluid host state rejects the mutation or data is invalid.
   */
  public async editTeamDocument(
    handle: TeamDocumentHandle,
    currentUser: UserReference,
    expectedTeam: PlanningPokerTeam,
    team: PlanningPokerTeam
  ): Promise<void> {
    this.requireStorage();
    const current = handle.getSnapshot();
    if (current.team.id !== team.id || expectedTeam.id !== team.id || handle.teamId !== team.id) {
      throw new TeamRepositoryError('invalid-team', 'The loaded team identity does not match.');
    }
    if (!isHostedBy(current.team, currentUser)) {
      throw new TeamRepositoryError(
        'host-mismatch',
        'Team host details changed. Reload the team or ask another host to repair access.'
      );
    }
    await this.validateAvailableTitle(team.title, team.id);
    this.validateTeam(team);
    const isRenamed = expectedTeam.title !== team.title.trim();
    const result = handle.editTeam({
      teamId: team.id,
      expectedUpdatedAt: expectedTeam.updatedAt,
      ...(expectedTeam.title === team.title.trim() ? {} : { title: team.title.trim() }),
      ...(expectedTeam.description === team.description ? {} : { description: team.description }),
      ...(expectedTeam.isActive === team.isActive ? {} : { isActive: team.isActive }),
      ...(areUserReferencesEqual(expectedTeam.hosts, team.hosts) ? {} : { hosts: team.hosts }),
      ...(areUserReferencesEqual(expectedTeam.configuredMembers, team.configuredMembers)
        ? {}
        : { configuredMembers: team.configuredMembers }),
      ...(areTeamSettingsEqual(expectedTeam.settings, team.settings)
        ? {}
        : { settings: team.settings }),
      currentUser,
      updatedAt: team.updatedAt
    });
    if (result.status !== 'applied' && result.status !== 'idempotent') {
      throw new TeamRepositoryError(
        result.reason === 'host-required' ? 'host-mismatch' : 'stale-command',
        result.reason === 'host-required'
          ? 'Team host details changed. Reload the team or ask another host to repair access.'
          : 'This team changed while you were editing it. Reload the latest values and try again.'
      );
    }
    await handle.waitForSaved();
    if (isRenamed) {
      await this.store.rename(team.id, team.title.trim());
    }
    await this.updateTeamMetadata(handle);
  }

  /**
   * Changes only a team's activity flag against the current live team node.
   *
   * @param handle - Loaded document handle that owns the transaction boundary.
   * @param currentUser - Delegated host requesting the change.
   * @param expectedIsActive - Activity value observed by the initiating screen.
   * @param isActive - Requested next activity value.
   * @param updatedAt - ISO audit timestamp.
   * @returns A promise resolving after Fluid and metadata acknowledgements.
   * @throws Throws `TeamRepositoryError` when current host or activity state rejects the command.
   */
  public async setTeamActive(
    handle: TeamDocumentHandle,
    currentUser: UserReference,
    expectedIsActive: boolean,
    isActive: boolean,
    updatedAt: string
  ): Promise<void> {
    this.requireStorage();
    const result = handle.setTeamActive({
      teamId: handle.teamId,
      expectedIsActive,
      isActive,
      currentUser,
      updatedAt
    });
    if (result.status !== 'applied' && result.status !== 'idempotent') {
      throw new TeamRepositoryError(
        result.reason === 'host-required' ? 'host-mismatch' : 'stale-command',
        result.reason === 'host-required'
          ? 'Only a current team host can change team activity.'
          : 'Team activity changed in another window. Reload and try again.'
      );
    }
    await handle.waitForSaved();
    await this.updateTeamMetadata(handle);
  }

  /**
   * Loads authoritative Fluid state, verifies the current host and session guard, then recycles it.
   *
   * @param teamId - Stable team identifier selected for deletion.
   * @param currentUser - Delegated user requesting deletion.
   * @returns The optional recycle-bin identifier supplied by SharePoint.
   * @throws Throws `TeamRepositoryError` when the team cannot be safely recycled.
   */
  public async deleteTeam(
    teamId: string,
    currentUser: UserReference
  ): Promise<{ readonly recycleBinItemId?: string }> {
    this.requireStorage();
    const summary = (await this.store.list()).find((team) => team.teamId === teamId);
    if (summary === undefined) {
      throw new TeamRepositoryError('not-found', 'The team file could not be found.');
    }
    const handle = await this.store.load(summary.driveItemId);
    try {
      const document = handle.getSnapshot();
      if (document.team.id !== teamId || handle.teamId !== teamId) {
        throw new TeamRepositoryError('invalid-team', 'The loaded team identity does not match.');
      }
      if (!isHostedBy(document.team, currentUser)) {
        throw new TeamRepositoryError(
          'host-mismatch',
          'Team host details changed. Reload the team or ask another host to repair access.'
        );
      }
      if (document.openSessionId !== undefined && document.openSessionId.trim().length > 0) {
        throw new TeamRepositoryError(
          'open-session',
          "End the team's open voting session before deleting it."
        );
      }
      try {
        return await this.store.recycle(handle.driveItemId);
      } catch (error: unknown) {
        if (error instanceof TeamRepositoryError) {
          throw error;
        }
        throw new TeamRepositoryError(
          'recycle-failure',
          'The team could not be moved to the SharePoint recycle bin.'
        );
      }
    } finally {
      handle.dispose();
    }
  }

  /**
   * Refreshes SharePoint discovery metadata after a durable Fluid mutation.
   *
   * @param handle - The document handle containing the authoritative snapshot.
   * @returns A promise that resolves after SharePoint acknowledges the update.
   * @throws Throws `TeamRepositoryError` when metadata cannot be synchronized.
   */
  public async updateTeamMetadata(handle: TeamDocumentHandle): Promise<void> {
    this.requireStorage();
    try {
      await this.store.updateMetadata(handle.getSnapshot());
    } catch {
      throw new TeamRepositoryError(
        'metadata-sync',
        'The team was saved, but its SharePoint discovery details could not be refreshed.'
      );
    }
  }

  /**
   * Validates title syntax and case-insensitive uniqueness.
   *
   * @param title - The requested team title.
   * @param currentTeamId - The stable team identifier to exclude during a rename.
   * @returns A promise that resolves when the title is available.
   * @throws Throws `TeamRepositoryError` for invalid or duplicate titles.
   */
  private async validateAvailableTitle(title: string, currentTeamId?: string): Promise<void> {
    const trimmedTitle = title.trim();
    const titleError = validateTeamTitle(trimmedTitle);
    if (titleError !== undefined) {
      throw new TeamRepositoryError('invalid-title', titleError);
    }
    const existing = await this.store.list();
    if (
      existing.some(
        (candidate) =>
          candidate.teamId !== currentTeamId &&
          candidate.title.trim().toLocaleLowerCase() === trimmedTitle.toLocaleLowerCase()
      )
    ) {
      throw new TeamRepositoryError('duplicate-title', 'A team already uses that title.');
    }
  }

  /**
   * Enforces repository-level team invariants before a Fluid mutation.
   *
   * @param team - The requested complete team state.
   * @returns `void` when repository invariants are satisfied.
   * @throws Throws `TeamRepositoryError` when no application host remains.
   */
  private validateTeam(team: PlanningPokerTeam): void {
    if (team.hosts.length === 0) {
      throw new TeamRepositoryError('invalid-team', 'A team must have at least one host.');
    }
  }

  /**
   * Enforces the configured-storage precondition for repository operations.
   *
   * @returns `void` when storage is configured.
   * @throws Throws `TeamRepositoryError` when storage is unavailable.
   */
  private requireStorage(): void {
    if (this.storage === undefined) {
      throw new TeamRepositoryError('not-configured', 'Planning Poker storage is not configured.');
    }
  }
}
