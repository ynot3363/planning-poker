import {
  CURRENT_SCHEMA_VERSION,
  FIBONACCI_SCALE,
  MAX_SUPPORTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION,
  T_SHIRT_SCALE,
  isOpenSession,
  isUnfinishedRound
} from './planningPokerDomain';
import type {
  PlanningPokerDocumentRoot,
  StoryStatus,
  TeamSettings,
  VotingRoundStatus,
  VotingSessionStatus
} from './planningPokerDomain';

/** The compatibility classification for a persisted document schema. */
export type SchemaCompatibility = 'supported' | 'migratable' | 'newer-unsupported' | 'invalid';

/**
 * Compares two strict three-part semantic versions.
 *
 * @param left - The first semantic version.
 * @param right - The second semantic version.
 * @returns A negative value when `left` is older, zero when equal, a positive value when newer,
 * or `Number.NaN` when either value is invalid.
 */
export function compareSchemaVersions(left: string, right: string): number {
  if (!/^\d+\.\d+\.\d+$/.test(left) || !/^\d+\.\d+\.\d+$/.test(right)) {
    return Number.NaN;
  }
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

/**
 * Classifies an untrusted schema version before a document is loaded into feature UI.
 *
 * @param value - The untrusted schema version value.
 * @returns The compatibility classification for the current client.
 */
export function getSchemaCompatibility(value: unknown): SchemaCompatibility {
  if (
    typeof value !== 'string' ||
    Number.isNaN(compareSchemaVersions(value, CURRENT_SCHEMA_VERSION))
  ) {
    return 'invalid';
  }
  if (value === CURRENT_SCHEMA_VERSION) {
    return 'supported';
  }
  if (
    compareSchemaVersions(value, MIN_SUPPORTED_SCHEMA_VERSION) >= 0 &&
    compareSchemaVersions(value, CURRENT_SCHEMA_VERSION) < 0
  ) {
    return 'migratable';
  }
  if (compareSchemaVersions(value, MAX_SUPPORTED_SCHEMA_VERSION) > 0) {
    return 'newer-unsupported';
  }
  return 'invalid';
}

/**
 * Validates the business rules for built-in and custom estimate scales.
 *
 * @param settings - The team settings to validate.
 * @returns User-facing validation errors; an empty array means the settings are valid.
 */
export function validateScale(settings: TeamSettings): string[] {
  const errors: string[] = [];
  const values = settings.scaleValues.map((value) => value.trim());
  const normalized = values.map((value) => value.toLocaleLowerCase());
  if (values.length < 2 || values.length > 20) {
    errors.push('A scale must contain between 2 and 20 values.');
  }
  if (values.some((value) => value.length === 0)) {
    errors.push('Scale values must be non-empty.');
  }
  if (new Set(normalized).size !== normalized.length) {
    errors.push('Scale values must be unique without regard to case.');
  }
  if (settings.scaleKind === 'Fibonacci' && values.join('|') !== FIBONACCI_SCALE.join('|')) {
    errors.push('Fibonacci values must use the canonical ordered set.');
  }
  if (settings.scaleKind === 'TShirt' && values.join('|') !== T_SHIRT_SCALE.join('|')) {
    errors.push('T-shirt values must use the canonical ordered set.');
  }
  const timerDurationSeconds = settings.timerDurationSeconds;
  if (
    settings.timerEnabled &&
    (timerDurationSeconds === undefined ||
      !Number.isInteger(timerDurationSeconds) ||
      timerDurationSeconds < 1 ||
      timerDurationSeconds > 3600)
  ) {
    errors.push('Enabled timers must be whole seconds from 1 through 3,600.');
  }
  if (!settings.timerEnabled && settings.timerDurationSeconds !== undefined) {
    errors.push('Disabled timers must not persist a duration.');
  }
  return errors;
}

/**
 * Determines whether a story status transition is allowed.
 *
 * @param from - The current story status.
 * @param to - The requested story status.
 * @returns `true` when the transition preserves the story lifecycle.
 */
export function canTransitionStory(from: StoryStatus, to: StoryStatus): boolean {
  return (
    (from === 'Ready' && (to === 'Pointed' || to === 'Archived')) ||
    (from === 'Pointed' && (to === 'Ready' || to === 'Archived')) ||
    (from === 'Archived' && to === 'Ready') ||
    from === to
  );
}

/**
 * Determines whether a voting session status transition is allowed.
 *
 * @param from - The current session status.
 * @param to - The requested session status.
 * @returns `true` when the transition preserves the session lifecycle.
 */
export function canTransitionSession(from: VotingSessionStatus, to: VotingSessionStatus): boolean {
  return (
    (from === 'Lobby' && to === 'Active') ||
    ((from === 'Lobby' || from === 'Active') && to === 'Ended') ||
    from === to
  );
}

/**
 * Command context required for exceptional voting-round recovery transitions.
 */
export type VotingRoundTransitionContext = 'standard' | 'undo-reveal';

/**
 * Determines whether a voting round status transition is allowed.
 *
 * @param from - The current round status.
 * @param to - The requested round status.
 * @param context - Command context authorizing documented recovery behavior.
 * @returns `true` when the transition preserves the round lifecycle.
 */
export function canTransitionRound(
  from: VotingRoundStatus,
  to: VotingRoundStatus,
  context: VotingRoundTransitionContext = 'standard'
): boolean {
  return (
    (from === 'Voting' && (to === 'Revealed' || to === 'Cancelled')) ||
    (from === 'Revealed' && (to === 'Finalized' || to === 'Cancelled')) ||
    (from === 'Revealed' && to === 'Voting' && context === 'undo-reveal') ||
    from === to
  );
}

/**
 * Checks cross-entity invariants before a document is saved or rendered.
 *
 * @param document - The plain Planning Poker document snapshot to validate.
 * @returns User-facing invariant failures; an empty array means the document is consistent.
 */
export function validateDocumentInvariants(document: PlanningPokerDocumentRoot): string[] {
  const errors: string[] = [];
  if (getSchemaCompatibility(document.schemaVersion) !== 'supported') {
    errors.push('The document schema is not supported by this client.');
  }
  const openSessions = document.sessions.filter((session) => isOpenSession(session.status));
  if (
    openSessions.length > 1 ||
    (openSessions.length === 1 && document.openSessionId !== openSessions[0].id) ||
    (openSessions.length === 0 && document.openSessionId !== undefined)
  ) {
    errors.push('A team may have at most one valid open session.');
  }
  for (const session of document.sessions) {
    const participantIds = session.participants.map((participant) => participant.id);
    const namedObjectIds = session.participants
      .filter((participant) => participant.kind === 'Named')
      .map((participant) => participant.user.objectId);
    const anonymousAliases = session.participants
      .filter((participant) => participant.kind === 'Anonymous')
      .map((participant) => participant.alias);
    if (new Set(participantIds).size !== participantIds.length) {
      errors.push(`Session ${session.id} contains duplicate participant IDs.`);
    }
    if (new Set(namedObjectIds).size !== namedObjectIds.length) {
      errors.push(`Session ${session.id} contains duplicate Named participants.`);
    }
    if (new Set(anonymousAliases).size !== anonymousAliases.length) {
      errors.push(`Session ${session.id} contains duplicate Anonymous aliases.`);
    }
    const unfinishedRounds = session.rounds.filter((round) => isUnfinishedRound(round.status));
    if (
      unfinishedRounds.length > 1 ||
      (unfinishedRounds.length === 1 && session.activeRoundId !== unfinishedRounds[0].id) ||
      (unfinishedRounds.length === 0 && session.activeRoundId !== undefined)
    ) {
      errors.push(`Session ${session.id} has an invalid unfinished-round pointer.`);
    }
    const expectedFinalizedRoundIds = session.rounds
      .filter((round) => round.status === 'Finalized')
      .map((round) => round.id);
    if (
      expectedFinalizedRoundIds.length !== session.finalizedRoundIds.length ||
      expectedFinalizedRoundIds.some(
        (roundId, index) => session.finalizedRoundIds[index] !== roundId
      )
    ) {
      errors.push(`Session ${session.id} has an invalid finalized-round index.`);
    }
    for (const round of session.rounds) {
      if (round.status === 'Finalized' && round.assignedValue === undefined) {
        errors.push(`Finalized round ${round.id} must have an assigned value.`);
      }
      if (
        round.votes.some(
          (vote) =>
            !session.participants.some((participant) => participant.id === vote.participantId)
        )
      ) {
        errors.push(`Round ${round.id} contains a vote from a non-participant.`);
      }
      const voterIds = round.votes.map((vote) => vote.participantId);
      if (new Set(voterIds).size !== voterIds.length) {
        errors.push(`Round ${round.id} contains duplicate participant vote slots.`);
      }
    }
  }
  for (const story of document.stories) {
    const operationIds = story.estimateHistory
      .map((entry) => entry.operationId)
      .filter((operationId): operationId is string => operationId !== undefined);
    if (new Set(operationIds).size !== operationIds.length) {
      errors.push(`Story ${story.id} contains replayed estimate-history operations.`);
    }
  }
  return errors;
}
