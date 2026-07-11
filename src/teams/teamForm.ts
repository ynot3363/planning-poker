import { FIBONACCI_SCALE, T_SHIRT_SCALE } from '../domain/planningPokerDomain';
import type {
  PlanningPokerTeam,
  TeamScaleKind,
  TeamSettings,
  UserReference,
  VotingMode
} from '../domain/planningPokerDomain';
import { validateScale } from '../domain/planningPokerValidation';
import type { HostedTeamSummary } from '../repository/teamRepository';
import { validateTeamTitle } from '../repository/teamRepository';

/** Represents editable values owned by the team create/edit experience. */
export interface TeamFormValues {
  /** Stable identifier when editing an existing team. */
  readonly teamId?: string;
  /** User-facing team title. */
  readonly title: string;
  /** User-facing team description. */
  readonly description: string;
  /** Application hosts selected through the people picker. */
  readonly hosts: readonly UserReference[];
  /** Optional configured participant roster. */
  readonly configuredMembers: readonly UserReference[];
  /** Whether the team can begin new work. */
  readonly isActive: boolean;
  /** Selected estimate scale kind. */
  readonly scaleKind: TeamScaleKind;
  /** Ordered editable values used only for a custom scale. */
  readonly customScaleValues: readonly string[];
  /** Whether voting sessions default to a timer. */
  readonly timerEnabled: boolean;
  /** Timer duration in whole minutes while enabled. */
  readonly timerDurationMinutes?: number;
  /** Whether votes default to named or anonymous visibility. */
  readonly votingMode: VotingMode;
}

/** Field-level messages returned by team form validation. */
export interface TeamFormErrors {
  /** Team title validation or uniqueness error. */
  readonly title?: string;
  /** Host roster invariant or duplicate error. */
  readonly hosts?: string;
  /** Configured member duplicate error. */
  readonly configuredMembers?: string;
  /** Custom or built-in scale validation error. */
  readonly scaleValues?: string;
  /** Timer duration validation error. */
  readonly timerDurationMinutes?: string;
}

/** Defines deterministic dependencies used to create or update a team submission. */
export interface TeamFormSubmissionContext {
  /** Current delegated user recorded in audit fields. */
  readonly currentUser: UserReference;
  /** Existing team when editing rather than creating. */
  readonly existingTeam?: PlanningPokerTeam;
  /** Lightweight summaries used for case-insensitive title uniqueness. */
  readonly existingTeams: readonly HostedTeamSummary[];
  /** Produces a stable identifier for a newly created team. */
  readonly createId: () => string;
  /** Produces the current ISO timestamp. */
  readonly now: () => string;
}

/** Represents either a validated team mutation or field-level validation failures. */
export type TeamFormSubmission =
  | { readonly isValid: true; readonly team: PlanningPokerTeam; readonly errors: TeamFormErrors }
  | { readonly isValid: false; readonly errors: TeamFormErrors };

/**
 * Creates the default form state for a new team.
 *
 * @param currentUser - The current user selected as the initial host.
 * @returns New-team defaults using the canonical Fibonacci scale.
 */
export function createInitialTeamForm(currentUser: UserReference): TeamFormValues {
  return {
    title: '',
    description: '',
    hosts: [currentUser],
    configuredMembers: [],
    isActive: true,
    scaleKind: 'Fibonacci',
    customScaleValues: [],
    timerEnabled: false,
    votingMode: 'Named'
  };
}

/**
 * Converts an existing team snapshot into editable form values.
 *
 * @param team - The authoritative team snapshot.
 * @returns Form values that preserve custom scale ordering.
 */
export function createTeamFormFromTeam(team: PlanningPokerTeam): TeamFormValues {
  return {
    teamId: team.id,
    title: team.title,
    description: team.description,
    hosts: team.hosts,
    configuredMembers: team.configuredMembers,
    isActive: team.isActive,
    scaleKind: team.settings.scaleKind,
    customScaleValues: team.settings.scaleKind === 'Custom' ? team.settings.scaleValues : [],
    timerEnabled: team.settings.timerEnabled,
    timerDurationMinutes:
      team.settings.timerDurationSeconds === undefined
        ? undefined
        : team.settings.timerDurationSeconds / 60,
    votingMode: team.settings.votingMode
  };
}

/**
 * Returns the canonical persisted settings for editable form values.
 *
 * @param values - Untrusted editable values.
 * @returns Normalized settings with trimmed custom values and no disabled timer duration.
 */
export function createTeamSettings(values: TeamFormValues): TeamSettings {
  const scaleValues =
    values.scaleKind === 'Fibonacci'
      ? FIBONACCI_SCALE
      : values.scaleKind === 'TShirt'
        ? T_SHIRT_SCALE
        : values.customScaleValues.map((value) => value.trim());
  return {
    scaleKind: values.scaleKind,
    scaleValues,
    timerEnabled: values.timerEnabled,
    timerDurationSeconds:
      values.timerEnabled && values.timerDurationMinutes !== undefined
        ? values.timerDurationMinutes * 60
        : undefined,
    votingMode: values.votingMode
  };
}

/**
 * Validates team form values against domain, identity, and title uniqueness rules.
 *
 * @param values - Untrusted editable team values.
 * @param existingTeams - Current hosted-team summaries used for title uniqueness.
 * @returns Field-level errors; an empty object means the values are valid.
 */
export function validateTeamForm(
  values: TeamFormValues,
  existingTeams: readonly HostedTeamSummary[]
): TeamFormErrors {
  const errors: {
    title?: string;
    hosts?: string;
    configuredMembers?: string;
    scaleValues?: string;
    timerDurationMinutes?: string;
  } = {};
  const normalizedTitle = values.title.trim();
  errors.title = validateTeamTitle(normalizedTitle);
  if (
    errors.title === undefined &&
    existingTeams.some(
      (team) =>
        team.teamId !== values.teamId &&
        team.title.trim().toLocaleLowerCase() === normalizedTitle.toLocaleLowerCase()
    )
  ) {
    errors.title = 'A team already uses that title.';
  }
  if (values.hosts.length === 0) {
    errors.hosts = 'Select at least one host.';
  } else if (hasDuplicatePeople(values.hosts)) {
    errors.hosts = 'Each host can be selected only once.';
  }
  if (hasDuplicatePeople(values.configuredMembers)) {
    errors.configuredMembers = 'Each configured member can be selected only once.';
  }
  const settingsErrors = validateScale(createTeamSettings(values));
  errors.scaleValues = settingsErrors.find((error) => !error.includes('timer'));
  if (
    values.timerEnabled &&
    (values.timerDurationMinutes === undefined ||
      !Number.isInteger(values.timerDurationMinutes) ||
      values.timerDurationMinutes < 1 ||
      values.timerDurationMinutes > 60)
  ) {
    errors.timerDurationMinutes = 'Enabled timers must be whole minutes from 1 through 60.';
  }
  const result: {
    title?: string;
    hosts?: string;
    configuredMembers?: string;
    scaleValues?: string;
    timerDurationMinutes?: string;
  } = {};
  if (errors.title !== undefined) {
    result.title = errors.title;
  }
  if (errors.hosts !== undefined) {
    result.hosts = errors.hosts;
  }
  if (errors.configuredMembers !== undefined) {
    result.configuredMembers = errors.configuredMembers;
  }
  if (errors.scaleValues !== undefined) {
    result.scaleValues = errors.scaleValues;
  }
  if (errors.timerDurationMinutes !== undefined) {
    result.timerDurationMinutes = errors.timerDurationMinutes;
  }
  return result;
}

/**
 * Validates and materializes a complete team mutation with stable audit fields.
 *
 * @param values - Untrusted editable team values.
 * @param context - Existing data and deterministic identity/time dependencies.
 * @returns Either a complete team mutation or field-level errors.
 */
export function createTeamFormSubmission(
  values: TeamFormValues,
  context: TeamFormSubmissionContext
): TeamFormSubmission {
  const errors = validateTeamForm(values, context.existingTeams);
  if (Object.keys(errors).length > 0) {
    return { isValid: false, errors };
  }
  const timestamp = context.now();
  const existing = context.existingTeam;
  return {
    isValid: true,
    errors: {},
    team: {
      id: existing?.id ?? context.createId(),
      title: values.title.trim(),
      description: values.description.trim(),
      hosts: values.hosts,
      configuredMembers: values.configuredMembers,
      isActive: values.isActive,
      settings: createTeamSettings(values),
      createdAt: existing?.createdAt ?? timestamp,
      createdBy: existing?.createdBy ?? context.currentUser,
      updatedAt: timestamp,
      updatedBy: context.currentUser
    }
  };
}

/**
 * Checks whether a selected people collection repeats an immutable identity.
 *
 * @param people - User references selected by a people picker.
 * @returns `true` when any Entra object identifier occurs more than once.
 */
function hasDuplicatePeople(people: readonly UserReference[]): boolean {
  const identities = people.map((person) => person.objectId.toLocaleLowerCase());
  return new Set(identities).size !== identities.length;
}
