import type {
  EstimateHistoryEntry,
  PlanningPokerDocumentRoot,
  PointingStory,
  SessionParticipant,
  StoryVotingRound,
  UserReference,
  VoteRecord,
  VotingSession
} from '../domain/planningPokerDomain';
import { isOpenSession, isUnfinishedRound } from '../domain/planningPokerDomain';

interface IMutableRoot {
  readonly stories: readonly PointingStory[];
  readonly sessions: readonly VotingSession[];
  openSessionId?: string;
}

interface IMutableSession {
  status: VotingSession['status'];
  readonly participants: readonly SessionParticipant[];
  readonly rounds: readonly StoryVotingRound[];
  readonly finalizedRoundIds: readonly string[];
  activeRoundId?: string;
  endedAt?: string;
  endedBy?: UserReference;
}

interface IMutableParticipant {
  alias?: `Participant ${number}`;
}

interface IMutableRound {
  status: StoryVotingRound['status'];
  readonly votes: readonly VoteRecord[];
  readonly timer: IMutableTimer;
  revealedAt?: string;
  revealedBy?: UserReference;
  revealReason?: StoryVotingRound['revealReason'];
  revealedVotedCount?: number;
  revealedMissingCount?: number;
  automaticRevealSuppressionKey?: string;
  assignedValue?: string;
  finalizedAt?: string;
  finalizedBy?: UserReference;
  finalizationOperationId?: string;
}

interface IMutableTimer {
  status: StoryVotingRound['timer']['status'];
  stoppedAt?: string;
}

interface IMutableVote {
  participantId: string;
  operationId?: string;
}

interface IMutableHistoryEntry {
  operationId?: string;
}

interface IMutableStory {
  status: PointingStory['status'];
  currentEstimate?: string;
  readonly estimateHistory: readonly EstimateHistoryEntry[];
}

/** Summary of one deterministic reconciliation pass. */
export interface CollaborationReconciliationResult {
  /** Whether the pass repaired at least one persisted field or sequence. */
  readonly changed: boolean;
  /** Stable identifier of the canonical Lobby or Active session, when present. */
  readonly canonicalOpenSessionId?: string;
}

/** Runtime-only inputs needed for reconciliation rules that depend on live Presence. */
export interface CollaborationReconciliationOptions {
  /** Resolves the currently connected participant IDs for one session. */
  readonly getConnectedParticipantIds?: (session: VotingSession) => readonly string[];
}

/**
 * Checks an opaque retry identity before it enters collaborative state.
 *
 * @param operationId - Candidate operation identity.
 * @returns Whether the identity is non-empty and bounded for persisted storage.
 */
export function isValidOperationId(operationId: string): boolean {
  return operationId.trim().length > 0 && operationId.length <= 200;
}

/**
 * Selects the deterministic open-session winner without mutating the document.
 *
 * @param document - Current converged or partially converged document.
 * @returns The lexicographically smallest open session ID, or `undefined`.
 */
export function selectCanonicalOpenSession(
  document: Pick<PlanningPokerDocumentRoot, 'sessions'>
): VotingSession | undefined {
  return document.sessions
    .filter((session) => isOpenSession(session.status))
    .slice()
    .sort((left, right) => compareStableIds(left.id, right.id))[0];
}

/**
 * Selects the deterministic unfinished-round winner without mutating a session.
 *
 * @param session - Session whose concurrently inserted rounds are being interpreted.
 * @returns The lexicographically smallest Voting or Revealed round, or `undefined`.
 */
export function selectCanonicalActiveRound(session: VotingSession): StoryVotingRound | undefined {
  return session.rounds
    .filter((round) => isUnfinishedRound(round.status))
    .slice()
    .sort((left, right) => compareStableIds(left.id, right.id))[0];
}

/**
 * Returns one deterministic vote per participant from a partially converged round.
 *
 * @param round - Round containing current and possibly concurrent vote intents.
 * @returns Canonical vote records ordered by participant ID.
 */
export function selectCanonicalVotes(round: StoryVotingRound): readonly VoteRecord[] {
  const groups = new Map<string, VoteRecord[]>();
  round.votes.forEach((vote) => {
    const group = groups.get(vote.participantId) ?? [];
    group.push(vote);
    groups.set(vote.participantId, group);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => compareStableIds(left, right))
    .map(([, votes]) => selectCanonicalOperation(votes, (vote) => vote.operationId));
}

/**
 * Creates the stable vote-state fingerprint used to keep an undone reveal open.
 *
 * @param round - Round whose canonical vote operations are being identified.
 * @returns A deterministic JSON tuple sequence ordered by participant ID.
 */
export function createCanonicalVoteOperationKey(round: StoryVotingRound): string {
  return JSON.stringify(
    selectCanonicalVotes(round).map((vote) => [vote.participantId, vote.operationId ?? ''])
  );
}

/**
 * Reconciles keyed collaborative facts using only stable IDs and causal supersession links.
 *
 * @remarks
 * The pass is synchronous, monotonic, and idempotent. It never uses wall-clock ordering.
 * Session and round conflicts choose the smallest stable entity ID. Vote and history conflicts
 * choose the smallest operation ID among causal tips, so an observed later command supersedes its
 * parent while simultaneous siblings resolve identically on every client.
 *
 * @param document - Hydrated SharedTree root or isolated mutable test root.
 * @param options - Optional live Presence projection for automatic reveal.
 * @returns Whether persisted state changed and the canonical open session ID.
 */
export function reconcileCollaborativeDocument(
  document: PlanningPokerDocumentRoot,
  options: CollaborationReconciliationOptions = {}
): CollaborationReconciliationResult {
  const root = document as unknown as IMutableRoot;
  let changed = false;
  const canonicalOpen = selectCanonicalOpenSession(document);

  document.sessions.forEach((sessionNode) => {
    const session = sessionNode as unknown as IMutableSession;
    if (isOpenSession(sessionNode.status) && sessionNode.id !== canonicalOpen?.id) {
      session.status = 'Ended';
      session.endedAt = sessionNode.endedAt ?? sessionNode.createdAt;
      if (sessionNode.createdBy !== undefined) {
        session.endedBy = sessionNode.endedBy ?? copyUserReference(sessionNode.createdBy);
      }
      changed = true;
    }
    changed = reconcileParticipants(sessionNode) || changed;
    changed =
      reconcileRounds(sessionNode, options.getConnectedParticipantIds?.(sessionNode)) || changed;
  });

  if (root.openSessionId !== canonicalOpen?.id) {
    root.openSessionId = canonicalOpen?.id;
    changed = true;
  }
  changed = reconcileEstimateHistory(document) || changed;
  return {
    changed,
    ...(canonicalOpen === undefined ? {} : { canonicalOpenSessionId: canonicalOpen.id })
  };
}

/**
 * Reconciles participant identity keys, anonymous aliases, and dependent vote IDs.
 *
 * @param sessionNode - Session whose participant facts may have converged concurrently.
 * @returns Whether any participant or dependent vote field changed.
 */
function reconcileParticipants(sessionNode: VotingSession): boolean {
  const session = sessionNode as unknown as IMutableSession;
  let changed = false;
  const duplicateIds = new Set<string>();
  const canonicalParticipantIds = new Map<string, string>();

  sessionNode.participants
    .filter((participant) => participant.kind === 'Named')
    .forEach((participant) => {
      const key = participant.user.objectId;
      const current = canonicalParticipantIds.get(key);
      if (current === undefined || compareStableIds(participant.id, current) < 0) {
        if (current !== undefined) {
          duplicateIds.add(current);
        }
        canonicalParticipantIds.set(key, participant.id);
      } else {
        duplicateIds.add(participant.id);
      }
    });

  if (duplicateIds.size > 0) {
    sessionNode.rounds.forEach((round) => {
      round.votes.forEach((vote) => {
        if (!duplicateIds.has(vote.participantId)) {
          return;
        }
        const duplicate = sessionNode.participants.find(
          (participant) => participant.id === vote.participantId && participant.kind === 'Named'
        );
        const canonicalId =
          duplicate?.kind === 'Named'
            ? canonicalParticipantIds.get(duplicate.user.objectId)
            : undefined;
        if (canonicalId !== undefined && canonicalId !== vote.participantId) {
          (vote as unknown as IMutableVote).participantId = canonicalId;
          changed = true;
        }
      });
    });
    removeWhere(session.participants, (participant) => duplicateIds.has(participant.id));
    changed = true;
  }

  session.participants
    .filter((participant) => participant.kind === 'Anonymous')
    .slice()
    .sort((left, right) => compareStableIds(left.id, right.id))
    .forEach((participant, index) => {
      const alias = `Participant ${index + 1}` as const;
      if (participant.kind === 'Anonymous' && participant.alias !== alias) {
        (participant as unknown as IMutableParticipant).alias = alias;
        changed = true;
      }
    });
  return changed;
}

/**
 * Reconciles the active round, vote slots, and finalized-round index for one session.
 *
 * @param sessionNode - Session whose round facts may have converged concurrently.
 * @param connectedParticipantIds - Live connected roster IDs when Presence is available.
 * @returns Whether any round, vote, pointer, or index field changed.
 */
function reconcileRounds(
  sessionNode: VotingSession,
  connectedParticipantIds: readonly string[] | undefined
): boolean {
  const session = sessionNode as unknown as IMutableSession;
  let changed = false;
  const canonicalRound = isOpenSession(sessionNode.status)
    ? selectCanonicalActiveRound(sessionNode)
    : undefined;
  sessionNode.rounds.forEach((roundNode) => {
    const round = roundNode as unknown as IMutableRound;
    if (isUnfinishedRound(roundNode.status) && roundNode.id !== canonicalRound?.id) {
      round.status = 'Cancelled';
      changed = true;
    }
    changed = reconcileVotes(roundNode) || changed;
    if (roundNode.id === canonicalRound?.id && connectedParticipantIds !== undefined) {
      changed =
        reconcileAutomaticReveal(sessionNode, roundNode, connectedParticipantIds) || changed;
    }
  });
  if (session.activeRoundId !== canonicalRound?.id) {
    session.activeRoundId = canonicalRound?.id;
    changed = true;
  }

  const expectedFinalizedIds = sessionNode.rounds
    .filter((round) => round.status === 'Finalized')
    .map((round) => round.id);
  if (!areStringsEqual(sessionNode.finalizedRoundIds, expectedFinalizedIds)) {
    replaceStringSequence(session.finalizedRoundIds, expectedFinalizedIds);
    changed = true;
  }
  return changed;
}

/**
 * Reveals a Voting round when converged votes cover every Presence-connected participant.
 *
 * @remarks
 * The reveal audit uses the smallest stable vote operation ID, not arrival time, so independent
 * clients project identical metadata when no local transaction observed the final merged vote.
 *
 * @param sessionNode - Session owning the active round and eligible roster.
 * @param roundNode - Canonical active round after vote reconciliation.
 * @param connectedParticipantIds - Participant IDs reported connected by Fluid Presence.
 * @returns Whether the round was automatically revealed.
 */
function reconcileAutomaticReveal(
  sessionNode: VotingSession,
  roundNode: StoryVotingRound,
  connectedParticipantIds: readonly string[]
): boolean {
  if (roundNode.status !== 'Voting') {
    return false;
  }
  const connectedIds = new Set(connectedParticipantIds);
  const connectedParticipants = sessionNode.participants.filter((participant) =>
    connectedIds.has(participant.id)
  );
  const canonicalVotes = selectCanonicalVotes(roundNode);
  if (roundNode.automaticRevealSuppressionKey === createCanonicalVoteOperationKey(roundNode)) {
    return false;
  }
  const votedIds = new Set(canonicalVotes.map((vote) => vote.participantId));
  if (
    connectedParticipants.length === 0 ||
    !connectedParticipants.every((participant) => votedIds.has(participant.id))
  ) {
    return false;
  }
  const auditVote = canonicalVotes
    .filter((vote) => connectedIds.has(vote.participantId))
    .slice()
    .sort((left, right) =>
      compareStableIds(left.operationId as string, right.operationId as string)
    )[0];
  const auditParticipant = sessionNode.participants.find(
    (participant) => participant.id === auditVote.participantId
  );
  const round = roundNode as unknown as IMutableRound;
  round.status = 'Revealed';
  round.revealedAt = auditVote.castAt;
  round.revealReason = 'Automatic';
  round.revealedVotedCount = canonicalVotes.length;
  round.revealedMissingCount = 0;
  round.automaticRevealSuppressionKey = undefined;
  if (auditParticipant?.kind === 'Named') {
    round.revealedBy = copyUserReference(auditParticipant.user);
  }
  if (roundNode.timer.status !== 'Stopped') {
    round.timer.status = 'Stopped';
    round.timer.stoppedAt = auditVote.castAt;
  }
  return true;
}

/**
 * Reconciles duplicate or concurrent vote intents to one causal tip per participant.
 *
 * @param roundNode - Round containing keyed vote intents.
 * @returns Whether legacy IDs were assigned or duplicate slots were removed.
 */
function reconcileVotes(roundNode: StoryVotingRound): boolean {
  let changed = false;
  roundNode.votes.forEach((vote) => {
    if (vote.operationId === undefined) {
      (vote as unknown as IMutableVote).operationId = legacyVoteOperationId(roundNode.id, vote);
      changed = true;
    }
  });
  const canonical = new Set(selectCanonicalVotes(roundNode));
  if (canonical.size !== roundNode.votes.length) {
    removeWhere(roundNode.votes, (vote) => !canonical.has(vote));
    changed = true;
  }
  return changed;
}

/**
 * Reconciles replayed history IDs and projects canonical correction tips onto rounds/stories.
 *
 * @param document - Document containing round and story history facts.
 * @returns Whether history, estimates, or finalization projections changed.
 */
function reconcileEstimateHistory(document: PlanningPokerDocumentRoot): boolean {
  let changed = false;
  document.stories.forEach((storyNode) => {
    const story = storyNode as unknown as IMutableStory;
    storyNode.estimateHistory.forEach((entry) => {
      if (entry.operationId === undefined) {
        (entry as unknown as IMutableHistoryEntry).operationId = legacyHistoryOperationId(entry);
        changed = true;
      }
    });
    const seen = new Set<string>();
    const historyLength = storyNode.estimateHistory.length;
    removeWhere(story.estimateHistory, (entry) => {
      const operationId = entry.operationId as string;
      if (seen.has(operationId)) {
        return true;
      }
      seen.add(operationId);
      return false;
    });
    changed = storyNode.estimateHistory.length !== historyLength || changed;

    const byRound = new Map<string, EstimateHistoryEntry[]>();
    storyNode.estimateHistory.forEach((entry) => {
      const group = byRound.get(entry.roundId) ?? [];
      group.push(entry);
      byRound.set(entry.roundId, group);
    });
    const canonicalEntries = Array.from(byRound.values()).map((entries) =>
      selectCanonicalOperation(entries, (entry) => entry.operationId)
    );
    canonicalEntries.forEach((entry) => {
      const roundNode = findRound(document.sessions, entry.roundId);
      if (roundNode === undefined) {
        return;
      }
      const round = roundNode as unknown as IMutableRound;
      if (
        round.finalizationOperationId !== entry.operationId ||
        round.assignedValue !== entry.value ||
        round.finalizedAt !== entry.finalizedAt ||
        round.finalizedBy?.objectId !== entry.finalizedBy.objectId
      ) {
        round.finalizationOperationId = entry.operationId;
        round.assignedValue = entry.value;
        round.finalizedAt = entry.finalizedAt;
        round.finalizedBy = copyUserReference(entry.finalizedBy);
        changed = true;
      }
    });
    const latest = storyNode.estimateHistory
      .slice()
      .reverse()
      .find((entry) => canonicalEntries.indexOf(entry) >= 0);
    if (latest !== undefined && story.currentEstimate !== latest.value) {
      story.currentEstimate = latest.value;
      story.status = 'Pointed';
      changed = true;
    }
  });
  return changed;
}

/**
 * Selects one causal tip, breaking simultaneous siblings by stable operation ID.
 *
 * @param operations - Operations belonging to one logical keyed fact.
 * @param getOperationId - Reads the stable identity from an operation.
 * @returns The deterministic causal-tip winner.
 */
function selectCanonicalOperation<T>(
  operations: readonly T[],
  getOperationId: (operation: T) => string | undefined
): T {
  const supersededIds = new Set(
    operations
      .map(
        (operation) =>
          (operation as unknown as { readonly supersedesOperationId?: string })
            .supersedesOperationId
      )
      .filter((value): value is string => value !== undefined)
  );
  const tips = operations.filter((operation) => {
    const operationId = getOperationId(operation);
    return operationId !== undefined && !supersededIds.has(operationId);
  });
  const candidates = tips.length > 0 ? tips : operations;
  return candidates
    .slice()
    .sort((left, right) =>
      compareStableIds(getOperationId(left) ?? '', getOperationId(right) ?? '')
    )[0];
}

/**
 * Finds a round without depending on `Array.prototype.flatMap` in the SPFx ES5 target.
 *
 * @param sessions - Sessions to search.
 * @param roundId - Stable round identifier.
 * @returns The matching round, when present.
 */
function findRound(
  sessions: readonly VotingSession[],
  roundId: string
): StoryVotingRound | undefined {
  for (const session of sessions) {
    const round = session.rounds.find((candidate) => candidate.id === roundId);
    if (round !== undefined) {
      return round;
    }
  }
  return undefined;
}

/**
 * Compares opaque IDs by Unicode code unit so every client uses the same ordering.
 *
 * @param left - First stable ID.
 * @param right - Second stable ID.
 * @returns Negative, zero, or positive according to deterministic code-unit order.
 */
function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Removes matching items through the SharedTree sequence API.
 *
 * @param items - Hydrated sequence or isolated plain-array fake.
 * @param shouldRemove - Predicate identifying non-canonical entries.
 * @returns `void` after matching entries are removed.
 */
function removeWhere<T>(items: readonly T[], shouldRemove: (item: T) => boolean): void {
  const mutable = items as T[] & { removeAt?: (index: number) => void };
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (shouldRemove(items[index])) {
      if (mutable.removeAt !== undefined) {
        mutable.removeAt(index);
      } else {
        mutable.splice(index, 1);
      }
    }
  }
}

/**
 * Replaces a string sequence with one deterministic ordered set.
 *
 * @param items - Hydrated string sequence or isolated plain-array fake.
 * @param values - Canonical ordered values.
 * @returns `void` after replacement.
 */
function replaceStringSequence(items: readonly string[], values: readonly string[]): void {
  const mutable = items as string[] & {
    insertAtEnd?: (value: string) => void;
    removeAt?: (index: number) => void;
  };
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (mutable.removeAt !== undefined) {
      mutable.removeAt(index);
    } else {
      mutable.splice(index, 1);
    }
  }
  values.forEach((value) => {
    if (mutable.insertAtEnd !== undefined) {
      mutable.insertAtEnd(value);
    } else {
      mutable.push(value);
    }
  });
}

/**
 * Returns whether two ordered string sequences are equal.
 *
 * @param left - First sequence.
 * @param right - Second sequence.
 * @returns Whether every ordered value matches.
 */
function areStringsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Creates a deterministic migration identity for a legacy vote.
 *
 * @param roundId - Owning round identifier.
 * @param vote - Legacy vote without an operation ID.
 * @returns Stable derived operation identity.
 */
function legacyVoteOperationId(roundId: string, vote: VoteRecord): string {
  return `legacy-vote:${roundId}:${vote.participantId}:${vote.value}`;
}

/**
 * Creates a deterministic migration identity for indistinguishable legacy history retries.
 *
 * @param entry - Legacy history entry without an operation ID.
 * @returns Stable derived operation identity.
 */
function legacyHistoryOperationId(entry: EstimateHistoryEntry): string {
  return `legacy-history:${entry.sessionId}:${entry.roundId}:${entry.value}`;
}

/**
 * Copies a user reference without reparenting a hydrated SharedTree node.
 *
 * @param user - Hydrated or detached user reference.
 * @returns Detached user reference.
 */
function copyUserReference(user: UserReference): UserReference {
  return {
    objectId: user.objectId,
    displayName: user.displayName,
    loginName: user.loginName,
    ...(user.sharePointUserId === undefined ? {} : { sharePointUserId: user.sharePointUserId })
  };
}
