import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryStatus,
  UserReference
} from '../domain/planningPokerDomain';
import { TeamRepository, TeamRepositoryError, isHostedBy } from '../repository/teamRepository';
import type {
  HostedTeamSummary,
  IntentCommandResult,
  TeamDocumentHandle
} from '../repository/teamRepository';

/** Editable story content; audit and lifecycle fields remain system-owned. */
export interface StoryFormValues {
  readonly title: string;
  readonly description: string;
  readonly link: string;
}

/** Field-level story validation feedback. */
export interface StoryFormErrors {
  readonly title?: string;
  readonly link?: string;
}

/** A loaded team document owned by the Stories destination. */
export interface StoryTeamSession {
  readonly team: HostedTeamSummary;
  readonly handle: TeamDocumentHandle;
  getDocument(): PlanningPokerDocumentRoot;
}

/** Result of one story create, edit, or lifecycle command. */
export type StoryMutationResult =
  | { readonly isSaved: true }
  | {
      readonly isSaved: false;
      readonly fieldErrors: StoryFormErrors;
      readonly message?: string;
      readonly code?:
        | 'active-round'
        | 'not-found'
        | 'access-denied'
        | 'conflict'
        | 'stale'
        | 'save-failure';
    };

/** Host-facing story operations consumed by the Stories destination. */
export interface IStoryManagementService {
  /** @returns Hosted teams available for explicit story selection. */
  listTeams(): Promise<readonly HostedTeamSummary[]>;
  /** @param team - Selected hosted team. @returns Its verified live Fluid session. */
  openTeam(team: HostedTeamSummary): Promise<StoryTeamSession>;
  /** @param session - Session to release. @returns `void` after disposal. */
  closeTeam(session: StoryTeamSession): void;
  /**
   * @param session - Live story session.
   * @param listener - Receives synchronized plain document snapshots.
   * @returns An unsubscribe function.
   */
  subscribe(
    session: StoryTeamSession,
    listener: (document: PlanningPokerDocumentRoot) => void
  ): () => void;
  /** Creates one Ready story with system-owned audit values. */
  createStory(session: StoryTeamSession, values: StoryFormValues): Promise<StoryMutationResult>;
  /** Edits story content without changing lifecycle or estimate fields. */
  editStory(
    session: StoryTeamSession,
    storyId: string,
    values: StoryFormValues
  ): Promise<StoryMutationResult>;
  /** Atomically creates a validated collection of Ready stories. */
  importStories(
    session: StoryTeamSession,
    values: readonly StoryFormValues[]
  ): Promise<StoryMutationResult>;
  /** Archives one Ready or Pointed story after UI confirmation. */
  archiveStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
  /** Restores one Archived story to Ready. */
  restoreStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
  /** Returns one Pointed story to Ready without erasing estimate history. */
  repointStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
  /** Permanently removes one story that is not used by an unfinished round. */
  deleteStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
}

/** @returns Empty form values for a new story. */
export function createInitialStoryForm(): StoryFormValues {
  return { title: '', description: '', link: '' };
}

/**
 * @param story - Existing story.
 * @returns Editable content only.
 */
export function createStoryFormFromStory(story: PointingStory): StoryFormValues {
  return { title: story.title, description: story.description, link: story.link ?? '' };
}

/**
 * Accepts blank, root-relative SharePoint, or HTTPS story links.
 *
 * @param value - Untrusted optional link text.
 * @returns A normalized safe link, `undefined` for blank input, or an error.
 */
export function normalizeStoryLink(value: string): {
  readonly link?: string;
  readonly error?: string;
} {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {};
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) {
    return { link: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return { link: parsed.toString() };
    }
  } catch {
    // Invalid absolute URLs fall through to the safe field error.
  }
  return { error: 'Enter an HTTPS URL or a SharePoint-relative path beginning with /.' };
}

/**
 * @param values - Untrusted story form values.
 * @returns Field-level validation errors.
 */
export function validateStoryForm(values: StoryFormValues): StoryFormErrors {
  const errors: { title?: string; link?: string } = {};
  if (values.title.trim().length === 0) {
    errors.title = 'Enter a story title.';
  }
  const linkResult = normalizeStoryLink(values.link);
  if (linkResult.error !== undefined) {
    errors.link = linkResult.error;
  }
  return errors;
}

/**
 * @param stories - Team stories.
 * @returns Only stories currently eligible for voting.
 */
export function selectVotingEligibleStories(
  stories: readonly PointingStory[]
): readonly PointingStory[] {
  return stories.filter((story) => story.status === 'Ready');
}

/**
 * Detects whether a story is used by an unfinished round in an open session.
 *
 * @param document - Current authoritative document.
 * @param storyId - Stable story identifier.
 * @returns `true` when story administration must be blocked.
 */
export function isStoryInOpenRound(document: PlanningPokerDocumentRoot, storyId: string): boolean {
  return document.sessions.some(
    (session) =>
      (session.status === 'Lobby' || session.status === 'Active') &&
      session.rounds.some(
        (round) =>
          round.storyId === storyId && (round.status === 'Voting' || round.status === 'Revealed')
      )
  );
}

/** Coordinates pure story commands with a verified, durable Fluid document handle. */
export class StoryManagementService implements IStoryManagementService {
  /**
   * @param repository - Configured team repository.
   * @param currentUser - Stable delegated host identity.
   * @param createId - Stable ID generator.
   * @param now - ISO timestamp provider.
   */
  public constructor(
    private readonly repository: TeamRepository,
    private readonly currentUser: UserReference,
    private readonly createId: () => string,
    private readonly now: () => string
  ) {}

  /** @inheritdoc */
  public listTeams(): Promise<readonly HostedTeamSummary[]> {
    return this.repository.listHostedTeams(this.currentUser);
  }

  /** @inheritdoc */
  public async openTeam(team: HostedTeamSummary): Promise<StoryTeamSession> {
    const handle = await this.repository.loadTeamDocument(team.driveItemId);
    const document = handle.getSnapshot();
    if (document.team.id !== team.teamId || !isHostedBy(document.team, this.currentUser)) {
      handle.dispose();
      throw new TeamRepositoryError(
        'host-mismatch',
        'Only a current team host can manage this story catalog.'
      );
    }
    return { team, handle, getDocument: () => handle.getSnapshot() };
  }

  /** @inheritdoc */
  public closeTeam(session: StoryTeamSession): void {
    session.handle.dispose();
  }

  /** @inheritdoc */
  public subscribe(
    session: StoryTeamSession,
    listener: (document: PlanningPokerDocumentRoot) => void
  ): () => void {
    return session.handle.subscribe(() => listener(session.getDocument()));
  }

  /** @inheritdoc */
  public createStory(
    session: StoryTeamSession,
    values: StoryFormValues
  ): Promise<StoryMutationResult> {
    const errors = validateStoryForm(values);
    if (Object.keys(errors).length > 0) {
      return Promise.resolve({ isSaved: false, fieldErrors: errors });
    }
    const timestamp = this.now();
    const normalizedLink = normalizeStoryLink(values.link).link;
    const story: PointingStory = {
      id: this.createId(),
      title: values.title.trim(),
      description: values.description.trim(),
      ...(normalizedLink === undefined ? {} : { link: normalizedLink }),
      status: 'Ready',
      estimateHistory: [],
      createdAt: timestamp,
      createdBy: this.currentUser,
      updatedAt: timestamp,
      updatedBy: this.currentUser
    };
    return this.persistCommand(session, () =>
      session.handle.createStory({
        story,
        currentUser: this.currentUser,
        updatedAt: timestamp
      })
    );
  }

  /** @inheritdoc */
  public editStory(
    session: StoryTeamSession,
    storyId: string,
    values: StoryFormValues
  ): Promise<StoryMutationResult> {
    const errors = validateStoryForm(values);
    if (Object.keys(errors).length > 0) {
      return Promise.resolve({ isSaved: false, fieldErrors: errors });
    }
    const document = session.getDocument();
    const current = document.stories.find((story) => story.id === storyId);
    if (current === undefined) {
      return Promise.resolve(this.failure('not-found', 'The story could not be found.'));
    }
    const link = normalizeStoryLink(values.link).link;
    const updatedAt = this.now();
    return this.persistCommand(session, () =>
      session.handle.editStory({
        storyId,
        expectedUpdatedAt: current.updatedAt,
        title: values.title.trim(),
        description: values.description.trim(),
        ...(link === undefined ? {} : { link }),
        currentUser: this.currentUser,
        updatedAt
      })
    );
  }

  /** @inheritdoc */
  public importStories(
    session: StoryTeamSession,
    values: readonly StoryFormValues[]
  ): Promise<StoryMutationResult> {
    if (values.length === 0) {
      return Promise.resolve(
        this.failure('save-failure', 'The CSV file does not contain any stories to import.')
      );
    }
    if (values.some((value) => Object.keys(validateStoryForm(value)).length > 0)) {
      return Promise.resolve(
        this.failure('save-failure', 'Resolve every CSV validation error before importing.')
      );
    }
    const timestamp = this.now();
    try {
      const imported = values.map((value): PointingStory => {
        const link = normalizeStoryLink(value.link).link;
        return {
          id: this.createId(),
          title: value.title.trim(),
          description: value.description.trim(),
          ...(link === undefined ? {} : { link }),
          status: 'Ready',
          estimateHistory: [],
          createdAt: timestamp,
          createdBy: this.currentUser,
          updatedAt: timestamp,
          updatedBy: this.currentUser
        };
      });
      return this.persistCommand(session, () =>
        session.handle.importStories({
          stories: imported,
          currentUser: this.currentUser,
          updatedAt: timestamp
        })
      );
    } catch {
      return Promise.resolve(
        this.failure('save-failure', 'No stories were imported. Review the file and try again.')
      );
    }
  }

  /** @inheritdoc */
  public archiveStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult> {
    return this.transition(session, storyId, 'Archived', ['Ready', 'Pointed']);
  }

  /** @inheritdoc */
  public restoreStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult> {
    return this.transition(session, storyId, 'Ready', ['Archived']);
  }

  /** @inheritdoc */
  public repointStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult> {
    return this.transition(session, storyId, 'Ready', ['Pointed']);
  }

  /** @inheritdoc */
  public deleteStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult> {
    const updatedAt = this.now();
    return this.persistCommand(session, () =>
      session.handle.deleteStory({
        storyId,
        currentUser: this.currentUser,
        updatedAt
      })
    );
  }

  /**
   * Applies one explicit lifecycle transition while preserving estimates and audit creation.
   *
   * @param session - Live story session.
   * @param storyId - Stable story identifier.
   * @param status - Explicit destination lifecycle state.
   * @param allowedFrom - Lifecycle states permitted for this command.
   * @returns The durable mutation outcome.
   */
  private transition(
    session: StoryTeamSession,
    storyId: string,
    status: StoryStatus,
    allowedFrom: readonly StoryStatus[]
  ): Promise<StoryMutationResult> {
    const updatedAt = this.now();
    return this.persistCommand(session, () =>
      session.handle.transitionStory({
        storyId,
        status,
        allowedFrom,
        currentUser: this.currentUser,
        updatedAt
      })
    );
  }

  /**
   * Applies one focused command and refreshes metadata only after Fluid acknowledgement.
   *
   * @param session - Live story session.
   * @param apply - Synchronous store command that rechecks current shared state.
   * @returns The durable mutation outcome.
   */
  private async persistCommand(
    session: StoryTeamSession,
    apply: () => IntentCommandResult
  ): Promise<StoryMutationResult> {
    try {
      const result = apply();
      if (result.status !== 'applied' && result.status !== 'idempotent') {
        return this.mapCommandFailure(result);
      }
      await session.handle.waitForSaved();
      await this.repository.updateTeamMetadata(session.handle);
      return { isSaved: true };
    } catch (error: unknown) {
      if (error instanceof TeamRepositoryError) {
        return this.failure(
          error.code === 'host-mismatch' || error.code === 'access-denied'
            ? 'access-denied'
            : 'save-failure',
          error.message
        );
      }
      return this.failure('save-failure', 'The story could not be saved. Try again.');
    }
  }

  /**
   * Maps a rejected live-tree command to actionable, non-sensitive UI feedback.
   *
   * @param result - Store outcome that did not apply or match an idempotent retry.
   * @returns A failed story mutation result.
   */
  private mapCommandFailure(
    result: Exclude<IntentCommandResult, { readonly status: 'applied' | 'idempotent' }>
  ): StoryMutationResult {
    switch (result.reason) {
      case 'host-required':
        return this.failure('access-denied', 'Only a current team host can manage stories.');
      case 'story-in-open-round':
        return this.activeRoundFailure();
      case 'story-not-found':
        return this.failure('not-found', 'The story no longer exists. Reload the story list.');
      case 'story-changed':
        return this.failure(
          'conflict',
          'This story changed in another window. Reload its latest content and try again.'
        );
      case 'invalid-transition':
        return this.failure(
          'stale',
          'The story status changed before this action completed. Reload and try again.'
        );
      default:
        return this.failure('save-failure', 'The story change conflicted with current team state.');
    }
  }

  /**
   * Creates a safe failed mutation result.
   *
   * @param code - Stable failure category.
   * @param message - Non-sensitive user guidance.
   * @returns A failed mutation result.
   */
  private failure(
    code: 'active-round' | 'not-found' | 'access-denied' | 'conflict' | 'stale' | 'save-failure',
    message: string
  ): StoryMutationResult {
    return { isSaved: false, fieldErrors: {}, code, message };
  }

  /** @returns The standard unfinished-round failure. */
  private activeRoundFailure(): StoryMutationResult {
    return this.failure(
      'active-round',
      'Finalize or end the open voting round before changing this story.'
    );
  }
}
