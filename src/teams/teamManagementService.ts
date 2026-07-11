import type { PlanningPokerTeam, UserReference } from '../domain/planningPokerDomain';
import { TeamRepository, TeamRepositoryError, isHostedBy } from '../repository/teamRepository';
import type { HostedTeamSummary, TeamDocumentHandle } from '../repository/teamRepository';
import { createTeamFormFromTeam, createTeamFormSubmission } from './teamForm';
import type { TeamFormErrors, TeamFormValues } from './teamForm';

/** Owns a loaded team handle while its edit panel is open. */
export interface TeamEditSession {
  /** Authoritative team snapshot used to create the edit draft. */
  readonly team: PlanningPokerTeam;
  /** Editable values initialized from the authoritative snapshot. */
  readonly values: TeamFormValues;
  /** Loaded repository handle disposed when editing ends. */
  readonly handle: TeamDocumentHandle;
}

/** Represents a create or update result suitable for accessible UI feedback. */
export type TeamSaveResult =
  | { readonly isSaved: true }
  | { readonly isSaved: false; readonly fieldErrors: TeamFormErrors; readonly message?: string };

/** Defines host-facing team administration operations consumed by React. */
export interface ITeamManagementService {
  /** @returns Teams discovered through current-user host metadata. */
  listTeams(): Promise<readonly HostedTeamSummary[]>;
  /**
   * Loads and verifies one team against authoritative Fluid hosts.
   *
   * @param summary - Metadata summary selected by the current user.
   * @returns The loaded edit session.
   */
  openTeam(summary: HostedTeamSummary): Promise<TeamEditSession>;
  /**
   * Creates a team after validating the current list and form values.
   *
   * @param values - New-team form values.
   * @param existingTeams - Current summaries used for immediate uniqueness feedback.
   * @returns Save outcome and safe validation feedback.
   */
  createTeam(
    values: TeamFormValues,
    existingTeams: readonly HostedTeamSummary[]
  ): Promise<TeamSaveResult>;
  /**
   * Updates a loaded team through the durable repository workflow.
   *
   * @param session - Loaded authoritative edit session.
   * @param values - Edited form values.
   * @param existingTeams - Current summaries used for immediate uniqueness feedback.
   * @returns Save outcome and safe validation feedback.
   */
  updateTeam(
    session: TeamEditSession,
    values: TeamFormValues,
    existingTeams: readonly HostedTeamSummary[]
  ): Promise<TeamSaveResult>;
  /** @param session - Loaded edit session to release. @returns `void` after disposal. */
  closeTeam(session: TeamEditSession): void;
}

/** Coordinates form submissions with the authenticated team repository. */
export class TeamManagementService implements ITeamManagementService {
  /**
   * Creates a deterministic team management service.
   *
   * @param repository - Configured team repository.
   * @param currentUser - Stable current delegated identity.
   * @param createId - Stable ID generator for new teams.
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
  public async openTeam(summary: HostedTeamSummary): Promise<TeamEditSession> {
    const handle = await this.repository.loadTeamDocument(summary.driveItemId);
    const team = handle.getSnapshot().team;
    if (!isHostedBy(team, this.currentUser)) {
      handle.dispose();
      throw new TeamRepositoryError(
        'host-mismatch',
        'Team host details changed. Reload the team or ask another host to repair access.'
      );
    }
    return { team, values: createTeamFormFromTeam(team), handle };
  }

  /** @inheritdoc */
  public async createTeam(
    values: TeamFormValues,
    existingTeams: readonly HostedTeamSummary[]
  ): Promise<TeamSaveResult> {
    const submission = createTeamFormSubmission(values, {
      currentUser: this.currentUser,
      existingTeams,
      createId: this.createId,
      now: this.now
    });
    if (!submission.isValid) {
      return { isSaved: false, fieldErrors: submission.errors };
    }
    try {
      const handle = await this.repository.createTeamDocument(submission.team);
      handle.dispose();
      return { isSaved: true };
    } catch (error: unknown) {
      return this.mapSaveError(error);
    }
  }

  /** @inheritdoc */
  public async updateTeam(
    session: TeamEditSession,
    values: TeamFormValues,
    existingTeams: readonly HostedTeamSummary[]
  ): Promise<TeamSaveResult> {
    const submission = createTeamFormSubmission(values, {
      currentUser: this.currentUser,
      existingTeam: session.team,
      existingTeams,
      createId: this.createId,
      now: this.now
    });
    if (!submission.isValid) {
      return { isSaved: false, fieldErrors: submission.errors };
    }
    try {
      await this.repository.updateTeamDocument(session.handle, this.currentUser, submission.team);
      return { isSaved: true };
    } catch (error: unknown) {
      return this.mapSaveError(error);
    }
  }

  /** @inheritdoc */
  public closeTeam(session: TeamEditSession): void {
    session.handle.dispose();
  }

  /**
   * Maps repository failures into field-level or safe workflow feedback.
   *
   * @param error - Unknown repository rejection.
   * @returns A non-sensitive save result.
   */
  private mapSaveError(error: unknown): TeamSaveResult {
    if (error instanceof TeamRepositoryError) {
      if (error.code === 'duplicate-title' || error.code === 'invalid-title') {
        return { isSaved: false, fieldErrors: { title: error.message } };
      }
      return { isSaved: false, fieldErrors: {}, message: error.message };
    }
    return {
      isSaved: false,
      fieldErrors: {},
      message: 'The team could not be saved. Check the connection and try again.'
    };
  }
}
