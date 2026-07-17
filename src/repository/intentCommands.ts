import type {
  PlanningPokerTeam,
  PointingStory,
  StoryVotingRound,
  UserReference,
  VotingSession
} from '../domain/planningPokerDomain';
import { canTransitionStory } from '../domain/planningPokerValidation';
import type {
  IntentCommandResult,
  StoryCreateCommand,
  StoryDeleteCommand,
  StoryEditCommand,
  StoryImportCommand,
  StoryTransitionCommand,
  TeamActiveCommand,
  TeamEditCommand
} from './teamRepository';

/** Mutable subset of the SharedTree root owned by focused intent commands. */
export interface IntentDocumentRoot {
  team: PlanningPokerTeam;
  readonly stories: readonly PointingStory[];
  readonly sessions: readonly VotingSession[];
  openSessionId?: string;
  updatedAt: string;
}

interface IMutablePlanningPokerTeam {
  readonly id: string;
  title: string;
  description: string;
  isActive: boolean;
  hosts: readonly UserReference[];
  configuredMembers: readonly UserReference[];
  settings: PlanningPokerTeam['settings'];
  updatedAt: string;
  updatedBy: UserReference;
}

interface IMutablePointingStory {
  readonly id: string;
  title: string;
  description: string;
  link?: string;
  status: PointingStory['status'];
  updatedAt: string;
  updatedBy: UserReference;
}

interface IMutableVotingSession {
  readonly id: string;
  status: VotingSession['status'];
  updatedAt: string;
  updatedBy?: UserReference;
}

/**
 * Appends a detached value through SharedTree's sequence API.
 *
 * @param items - Hydrated SharedTree sequence or isolated plain-array test fake.
 * @param item - Detached value to insert.
 * @returns `void` after insertion.
 */
function appendTreeItem<T>(items: readonly T[], item: T): void {
  const mutable = items as T[] & { insertAtEnd?: (value: T) => void };
  if (mutable.insertAtEnd !== undefined) {
    mutable.insertAtEnd(item);
  } else {
    mutable.push(item);
  }
}

/**
 * Removes one current value through SharedTree's sequence API.
 *
 * @param items - Hydrated SharedTree sequence or isolated plain-array test fake.
 * @param index - Current sequence index.
 * @returns `void` after removal.
 */
function removeTreeItemAt<T>(items: readonly T[], index: number): void {
  const mutable = items as T[] & { removeAt?: (itemIndex: number) => void };
  if (mutable.removeAt !== undefined) {
    mutable.removeAt(index);
  } else {
    mutable.splice(index, 1);
  }
}

/**
 * Copies a user reference so inserted fields never reparent hydrated nodes.
 *
 * @param user - User value to detach.
 * @returns A plain insertable user reference.
 */
function copyUserReference(user: UserReference): UserReference {
  return {
    objectId: user.objectId,
    displayName: user.displayName,
    loginName: user.loginName,
    ...(user.sharePointUserId === undefined ? {} : { sharePointUserId: user.sharePointUserId })
  };
}

/**
 * Copies a story and its immutable audit/history values before sequence insertion.
 *
 * @param story - Story value that may have originated from another read model.
 * @returns A fully detached insertable story value.
 */
function copyPointingStory(story: PointingStory): PointingStory {
  return {
    id: story.id,
    title: story.title,
    description: story.description,
    ...(story.link === undefined ? {} : { link: story.link }),
    status: story.status,
    ...(story.currentEstimate === undefined ? {} : { currentEstimate: story.currentEstimate }),
    estimateHistory: story.estimateHistory.map((entry) => ({
      sessionId: entry.sessionId,
      roundId: entry.roundId,
      value: entry.value,
      finalizedAt: entry.finalizedAt,
      finalizedBy: copyUserReference(entry.finalizedBy)
    })),
    createdAt: story.createdAt,
    createdBy: copyUserReference(story.createdBy),
    updatedAt: story.updatedAt,
    updatedBy: copyUserReference(story.updatedBy)
  };
}

/**
 * Compares ordered roster values.
 *
 * @param left - Current roster.
 * @param right - Requested roster.
 * @returns Whether all ordered identity fields match.
 */
function areUsersEqual(left: readonly UserReference[], right: readonly UserReference[]): boolean {
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
 * Compares immutable settings values.
 *
 * @param left - Current settings.
 * @param right - Requested settings.
 * @returns Whether every setting and ordered scale value matches.
 */
function areSettingsEqual(
  left: PlanningPokerTeam['settings'],
  right: PlanningPokerTeam['settings']
): boolean {
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
 * Checks whether a retry already produced the requested team state.
 *
 * @param team - Current live team.
 * @param command - Requested edit.
 * @returns Whether form-owned fields already match.
 */
function teamMatchesEdit(team: PlanningPokerTeam, command: TeamEditCommand): boolean {
  return (
    (command.title === undefined || team.title === command.title) &&
    (command.description === undefined || team.description === command.description) &&
    (command.isActive === undefined || team.isActive === command.isActive) &&
    (command.hosts === undefined || areUsersEqual(team.hosts, command.hosts)) &&
    (command.configuredMembers === undefined ||
      areUsersEqual(team.configuredMembers, command.configuredMembers)) &&
    (command.settings === undefined || areSettingsEqual(team.settings, command.settings))
  );
}

/**
 * Checks whether a retry already produced the requested story content.
 *
 * @param story - Current live story.
 * @param command - Requested edit.
 * @returns Whether editable content already matches.
 */
function storyMatchesEdit(story: PointingStory, command: StoryEditCommand): boolean {
  return (
    story.title === command.title &&
    story.description === command.description &&
    story.link === command.link
  );
}

/**
 * Detects an unfinished round that currently owns a story.
 *
 * @param document - Current live document root.
 * @param storyId - Stable story identifier.
 * @returns Whether story administration must be rejected.
 */
function isStoryInOpenRound(document: IntentDocumentRoot, storyId: string): boolean {
  return document.sessions.some(
    (session) =>
      (session.status === 'Lobby' || session.status === 'Active') &&
      session.rounds.some(
        (round: StoryVotingRound) =>
          round.storyId === storyId && (round.status === 'Voting' || round.status === 'Revealed')
      )
  );
}

/**
 * Recognizes an already-applied create or import row.
 *
 * @param left - Current story.
 * @param right - Submitted detached story.
 * @returns Whether stable creation fields match.
 */
function isSameCreatedStory(left: PointingStory, right: PointingStory): boolean {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.description === right.description &&
    left.link === right.link &&
    left.status === right.status &&
    left.createdAt === right.createdAt &&
    left.createdBy.objectId === right.createdBy.objectId
  );
}

/**
 * Applies a team form edit against the live team version.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Validated edit and its baseline version.
 * @returns A typed applied, retry, conflict, stale, or rejection outcome.
 */
export function applyTeamEdit(
  document: IntentDocumentRoot,
  command: TeamEditCommand
): IntentCommandResult {
  if (document.team.id !== command.teamId) {
    return { status: 'stale', reason: 'team-not-found' };
  }
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  if (command.hosts !== undefined && command.hosts.length === 0) {
    return { status: 'rejected', reason: 'invalid-team' };
  }
  if (teamMatchesEdit(document.team, command)) {
    return { status: 'idempotent' };
  }
  if (document.team.updatedAt !== command.expectedUpdatedAt) {
    return { status: 'conflict', reason: 'team-changed' };
  }
  const team = document.team as unknown as IMutablePlanningPokerTeam;
  if (command.title !== undefined) {
    team.title = command.title;
  }
  if (command.description !== undefined) {
    team.description = command.description;
  }
  if (command.isActive !== undefined) {
    team.isActive = command.isActive;
  }
  if (command.hosts !== undefined) {
    team.hosts = command.hosts.map(copyUserReference);
  }
  if (command.configuredMembers !== undefined) {
    team.configuredMembers = command.configuredMembers.map(copyUserReference);
  }
  if (command.settings !== undefined) {
    team.settings = { ...command.settings, scaleValues: [...command.settings.scaleValues] };
  }
  team.updatedAt = command.updatedAt;
  team.updatedBy = copyUserReference(command.currentUser);
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Applies the independently owned team activity field.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Requested activity change and observed value.
 * @returns A typed intent-command outcome.
 */
export function applyTeamActive(
  document: IntentDocumentRoot,
  command: TeamActiveCommand
): IntentCommandResult {
  if (document.team.id !== command.teamId) {
    return { status: 'stale', reason: 'team-not-found' };
  }
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  if (document.team.isActive === command.isActive) {
    return { status: 'idempotent' };
  }
  if (document.team.isActive !== command.expectedIsActive) {
    return { status: 'conflict', reason: 'team-changed' };
  }
  const team = document.team as unknown as IMutablePlanningPokerTeam;
  team.isActive = command.isActive;
  team.updatedAt = command.updatedAt;
  team.updatedBy = copyUserReference(command.currentUser);
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Appends one story without replacing unrelated stories.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Detached story creation command.
 * @returns A typed intent-command outcome.
 */
export function applyStoryCreate(
  document: IntentDocumentRoot,
  command: StoryCreateCommand
): IntentCommandResult {
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  const existing = document.stories.find((story) => story.id === command.story.id);
  if (existing !== undefined) {
    return isSameCreatedStory(existing, command.story)
      ? { status: 'idempotent' }
      : { status: 'conflict', reason: 'duplicate-id' };
  }
  appendTreeItem(document.stories, copyPointingStory(command.story));
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Atomically validates and appends a submitted import batch.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Detached import rows.
 * @returns A typed intent-command outcome.
 */
export function applyStoryImport(
  document: IntentDocumentRoot,
  command: StoryImportCommand
): IntentCommandResult {
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  const submittedIds = command.stories.map((story) => story.id);
  if (new Set(submittedIds).size !== submittedIds.length) {
    return { status: 'rejected', reason: 'duplicate-id' };
  }
  const existingById = new Map<string, PointingStory>();
  document.stories.forEach((story) => existingById.set(story.id, story));
  const conflicting = command.stories.some((story) => {
    const existing = existingById.get(story.id);
    return existing !== undefined && !isSameCreatedStory(existing, story);
  });
  if (conflicting) {
    return { status: 'conflict', reason: 'duplicate-id' };
  }
  const missing = command.stories.filter((story) => !existingById.has(story.id));
  if (missing.length === 0) {
    return { status: 'idempotent' };
  }
  missing.forEach((story) => appendTreeItem(document.stories, copyPointingStory(story)));
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Patches editable content only on the current story node.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Story edit and observed story version.
 * @returns A typed intent-command outcome.
 */
export function applyStoryEdit(
  document: IntentDocumentRoot,
  command: StoryEditCommand
): IntentCommandResult {
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  const current = document.stories.find((story) => story.id === command.storyId);
  if (current === undefined) {
    return { status: 'stale', reason: 'story-not-found' };
  }
  if (storyMatchesEdit(current, command)) {
    return { status: 'idempotent' };
  }
  if (isStoryInOpenRound(document, command.storyId)) {
    return { status: 'rejected', reason: 'story-in-open-round' };
  }
  if (current.updatedAt !== command.expectedUpdatedAt) {
    return { status: 'conflict', reason: 'story-changed' };
  }
  const story = current as unknown as IMutablePointingStory;
  story.title = command.title;
  story.description = command.description;
  story.link = command.link;
  story.updatedAt = command.updatedAt;
  story.updatedBy = copyUserReference(command.currentUser);
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Applies one lifecycle transition after reading the current story and open rounds.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Requested destination and permitted source states.
 * @returns A typed intent-command outcome.
 */
export function applyStoryTransition(
  document: IntentDocumentRoot,
  command: StoryTransitionCommand
): IntentCommandResult {
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  const current = document.stories.find((story) => story.id === command.storyId);
  if (current === undefined) {
    return { status: 'stale', reason: 'story-not-found' };
  }
  if (current.status === command.status) {
    return { status: 'idempotent' };
  }
  if (isStoryInOpenRound(document, command.storyId)) {
    return { status: 'rejected', reason: 'story-in-open-round' };
  }
  if (
    command.allowedFrom.indexOf(current.status) < 0 ||
    !canTransitionStory(current.status, command.status)
  ) {
    return { status: 'stale', reason: 'invalid-transition' };
  }
  const story = current as unknown as IMutablePointingStory;
  story.status = command.status;
  story.updatedAt = command.updatedAt;
  story.updatedBy = copyUserReference(command.currentUser);
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Removes one current story when no unfinished round owns it.
 *
 * @param document - Current mutable SharedTree root.
 * @param command - Stable story deletion intent.
 * @returns A typed intent-command outcome.
 */
export function applyStoryDelete(
  document: IntentDocumentRoot,
  command: StoryDeleteCommand
): IntentCommandResult {
  if (!document.team.hosts.some((host) => host.objectId === command.currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  const index = document.stories.findIndex((story) => story.id === command.storyId);
  if (index < 0) {
    return { status: 'idempotent' };
  }
  if (isStoryInOpenRound(document, command.storyId)) {
    return { status: 'rejected', reason: 'story-in-open-round' };
  }
  removeTreeItemAt(document.stories, index);
  document.updatedAt = command.updatedAt;
  return { status: 'applied' };
}

/**
 * Starts only the matching current Lobby and preserves participants and session history.
 *
 * @param document - Current mutable SharedTree root.
 * @param sessionId - Stable Lobby identifier.
 * @param currentUser - Host requesting the transition.
 * @param updatedAt - ISO audit timestamp.
 * @returns A typed intent-command outcome.
 */
export function applyVotingSessionStart(
  document: IntentDocumentRoot,
  sessionId: string,
  currentUser: UserReference,
  updatedAt: string
): IntentCommandResult {
  const sessionNode = document.sessions.find((session) => session.id === sessionId);
  if (sessionNode === undefined) {
    return { status: 'stale', reason: 'session-not-found' };
  }
  if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
    return { status: 'rejected', reason: 'host-required' };
  }
  if (sessionNode.status === 'Active' && document.openSessionId === sessionId) {
    return { status: 'idempotent' };
  }
  if (document.openSessionId !== sessionId) {
    return { status: 'stale', reason: 'session-not-open' };
  }
  if (sessionNode.status !== 'Lobby') {
    return { status: 'rejected', reason: 'session-not-lobby' };
  }
  const session = sessionNode as unknown as IMutableVotingSession;
  session.status = 'Active';
  session.updatedAt = updatedAt;
  if (sessionNode.settings.votingMode === 'Named') {
    session.updatedBy = copyUserReference(currentUser);
  }
  document.updatedAt = updatedAt;
  return { status: 'applied' };
}
