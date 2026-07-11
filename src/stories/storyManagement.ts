import type {
  PlanningPokerDocumentRoot,
  PointingStory,
  StoryStatus,
  UserReference
} from '../domain/planningPokerDomain';
import { canTransitionStory, validateDocumentInvariants } from '../domain/planningPokerValidation';
import { TeamRepository, TeamRepositoryError, isHostedBy } from '../repository/teamRepository';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';

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
      readonly code?: 'active-round' | 'not-found' | 'access-denied' | 'save-failure';
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
  /** Archives one Ready or Pointed story after UI confirmation. */
  archiveStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
  /** Restores one Archived story to Ready. */
  restoreStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
  /** Returns one Pointed story to Ready without erasing estimate history. */
  repointStory(session: StoryTeamSession, storyId: string): Promise<StoryMutationResult>;
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
    return this.persist(session, [...session.getDocument().stories, story]);
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
    if (isStoryInOpenRound(document, storyId)) {
      return Promise.resolve(this.activeRoundFailure());
    }
    const link = normalizeStoryLink(values.link).link;
    const updatedContent: PointingStory = {
      ...current,
      title: values.title.trim(),
      description: values.description.trim(),
      ...(link === undefined ? {} : { link }),
      updatedAt: this.now(),
      updatedBy: this.currentUser
    };
    const updated = link === undefined ? omitStoryLink(updatedContent) : updatedContent;
    return this.persist(
      session,
      document.stories.map((story) => (story.id === storyId ? updated : story))
    );
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
    const document = session.getDocument();
    const current = document.stories.find((story) => story.id === storyId);
    if (current === undefined) {
      return Promise.resolve(this.failure('not-found', 'The story could not be found.'));
    }
    if (isStoryInOpenRound(document, storyId)) {
      return Promise.resolve(this.activeRoundFailure());
    }
    if (allowedFrom.indexOf(current.status) < 0 || !canTransitionStory(current.status, status)) {
      return Promise.resolve(
        this.failure('save-failure', `A ${current.status} story cannot be changed to ${status}.`)
      );
    }
    const updated: PointingStory = {
      ...current,
      status,
      updatedAt: this.now(),
      updatedBy: this.currentUser
    };
    return this.persist(
      session,
      document.stories.map((story) => (story.id === storyId ? updated : story))
    );
  }

  /**
   * Persists one complete story collection and refreshes Last Activity metadata.
   *
   * @param session - Live story session.
   * @param stories - Complete next ordered story collection.
   * @returns The durable mutation outcome.
   */
  private async persist(
    session: StoryTeamSession,
    stories: readonly PointingStory[]
  ): Promise<StoryMutationResult> {
    try {
      const document = session.getDocument();
      if (!isHostedBy(document.team, this.currentUser)) {
        return this.failure('access-denied', 'Only a current team host can manage stories.');
      }
      const updatedAt = this.now();
      const nextDocument = { ...document, stories, updatedAt };
      if (validateDocumentInvariants(nextDocument).length > 0) {
        return this.failure('save-failure', 'The story change would make the team invalid.');
      }
      session.handle.updateStories(stories, updatedAt);
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
   * Creates a safe failed mutation result.
   *
   * @param code - Stable failure category.
   * @param message - Non-sensitive user guidance.
   * @returns A failed mutation result.
   */
  private failure(
    code: 'active-round' | 'not-found' | 'access-denied' | 'save-failure',
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

/**
 * Copies a story while deliberately omitting its optional link property.
 *
 * @param story - Story whose link is being cleared.
 * @returns A serializable story without an `undefined` link value.
 */
function omitStoryLink(story: PointingStory): PointingStory {
  return {
    id: story.id,
    title: story.title,
    description: story.description,
    status: story.status,
    ...(story.currentEstimate === undefined ? {} : { currentEstimate: story.currentEstimate }),
    estimateHistory: story.estimateHistory,
    createdAt: story.createdAt,
    createdBy: story.createdBy,
    updatedAt: story.updatedAt,
    updatedBy: story.updatedBy
  };
}
