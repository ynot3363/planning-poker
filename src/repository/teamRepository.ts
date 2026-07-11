import type {
  PlanningPokerDocumentRoot,
  PlanningPokerTeam,
  PointingStory,
  UserReference
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
}

/** Owns one loaded Fluid document and its subscription lifecycle. */
export interface TeamDocumentHandle {
  /** The stable team identifier. */
  readonly teamId: string;
  /** The ODSP drive item identifier. */
  readonly driveItemId: string;
  /** @returns A plain serializable snapshot of the current shared state. */
  getSnapshot(): PlanningPokerDocumentRoot;
  /**
   * Applies one team mutation through the store's Fluid transaction boundary.
   *
   * @param team - The complete next team state with stable identity and audit fields.
   * @returns `void` after the local transaction is applied.
   */
  updateTeam(team: PlanningPokerTeam): void;
  /**
   * Replaces the ordered story collection through the store's Fluid transaction boundary.
   *
   * @param stories - Complete next story collection.
   * @param updatedAt - ISO timestamp for document Last Activity.
   * @returns `void` after the local transaction is applied.
   */
  updateStories(stories: readonly PointingStory[], updatedAt: string): void;
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
   * @param team - The complete next team state.
   * @returns A promise that resolves after Fluid, rename, and metadata operations are acknowledged.
   * @throws Throws `TeamRepositoryError` when Fluid host state rejects the mutation or data is invalid.
   */
  public async updateTeamDocument(
    handle: TeamDocumentHandle,
    currentUser: UserReference,
    team: PlanningPokerTeam
  ): Promise<void> {
    this.requireStorage();
    const current = handle.getSnapshot();
    if (current.team.id !== team.id || handle.teamId !== team.id) {
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
    const isRenamed = current.team.title !== team.title.trim();
    handle.updateTeam(team);
    await handle.waitForSaved();
    if (isRenamed) {
      await this.store.rename(team.id, team.title.trim());
    }
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
