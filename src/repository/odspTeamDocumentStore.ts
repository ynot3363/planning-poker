import type { IFluidContainer } from '@fluidframework/fluid-static';
import { getPresence } from 'fluid-framework';
import { StateFactory } from '@fluidframework/presence/beta';
import type { Attendee, Latest, StatesWorkspaceSchema } from '@fluidframework/presence/beta';
import { OdspClient } from '@fluidframework/odsp-client/beta';
import type { IOdspTokenProvider, OdspContainerServices } from '@fluidframework/odsp-client/beta';
import { Tree, TreeViewConfiguration } from '@fluidframework/tree';
import type { TreeNode, TreeView } from '@fluidframework/tree';
import { SharedTree } from '@fluidframework/tree/legacy';
import {
  CURRENT_SCHEMA_VERSION,
  MAX_SUPPORTED_SCHEMA_VERSION,
  MIN_SUPPORTED_SCHEMA_VERSION
} from '../domain/planningPokerDomain';
import type {
  PlanningPokerDocumentRoot,
  PlanningPokerTeam,
  PointingStory,
  SessionParticipant,
  StoryVotingRound,
  UserReference,
  VoteRecord,
  VotingTimer,
  VotingSession
} from '../domain/planningPokerDomain';
import { PlanningPokerDocumentRootSchema } from '../domain/planningPokerSchema';
import type {
  IPlanningPokerStorageConfiguration,
  ISharePointTransport
} from '../storage/storageTypes';
import type { IGraphDriveItem, IPlanningPokerDriveService } from './graphDriveService';
import { TeamRepositoryError, projectTeamMetadata } from './teamRepository';
import type {
  HostedTeamSummary,
  ITeamDocumentStore,
  SessionParticipantJoin,
  TeamDocumentHandle
} from './teamRepository';

const MIN_FLUID_VERSION = '2.111.0' as const;
const SAVE_TIMEOUT_MS = 15_000;
const CONNECTION_TIMEOUT_MS = 15_000;
const INITIAL_OBJECT_KEY = 'appTree';
const FLUID_DISCONNECTED_STATE = 0;
// Fluid's public ConnectionState enum represents Connected as 2 in this pinned runtime.
const FLUID_CONNECTED_STATE = 2;
const containerSchema = { initialObjects: { [INITIAL_OBJECT_KEY]: SharedTree } } as const;
const treeConfiguration = new TreeViewConfiguration({
  schema: PlanningPokerDocumentRootSchema,
  enableSchemaValidation: true
});

interface ISharePointPersonValue {
  readonly Id?: unknown;
}

interface ISharePointFileValue {
  readonly Name?: unknown;
}

interface ITeamListItem {
  readonly Id?: unknown;
  readonly Title?: unknown;
  readonly File?: ISharePointFileValue;
  readonly [fieldName: string]: unknown;
}

interface ITeamItemRecord {
  readonly itemId: number;
  readonly fileName: string;
  readonly teamId: string;
  readonly title: string;
  readonly isActive: boolean;
  readonly activeSessionId?: string;
  readonly hostIds: readonly number[];
  readonly participantIds: readonly number[];
  readonly driveItemId?: string;
}

interface ITreeRootView {
  readonly compatibility: {
    readonly canInitialize: boolean;
    readonly canView: boolean;
    readonly canUpgrade?: boolean;
  };
  root: unknown;
  initialize(content: unknown): void;
  upgradeSchema(): void;
  dispose(): void;
}

interface IMutableDocumentRoot {
  team: PlanningPokerTeam;
  stories: readonly PointingStory[];
  sessions: readonly VotingSession[];
  openSessionId?: string;
  updatedAt: string;
}

interface IMutableVotingSession {
  readonly id: string;
  status: VotingSession['status'];
  participants: readonly SessionParticipant[];
  readonly rounds: readonly StoryVotingRound[];
  activeRoundId?: string;
  endedAt?: string;
  endedBy?: UserReference;
  updatedAt: string;
}

interface IMutableVotingRound {
  readonly id: string;
  status: StoryVotingRound['status'];
  readonly votes: readonly VoteRecord[];
  timer: VotingTimer;
  revealedAt?: string;
  revealedBy?: UserReference;
  revealReason?: StoryVotingRound['revealReason'];
  revealedVotedCount?: number;
  revealedMissingCount?: number;
  assignedValue?: string;
  finalizedAt?: string;
  finalizedBy?: UserReference;
}

interface IMutablePointingStory {
  readonly id: string;
  status: PointingStory['status'];
  currentEstimate?: string;
  readonly estimateHistory: PointingStory['estimateHistory'];
  updatedAt: string;
  updatedBy: UserReference;
}

interface IMutableVoteRecord {
  readonly participantId: string;
  value: string;
  castAt: string;
}

interface IMutableParticipantPresence {
  connection: 'Connected' | 'Disconnected';
  lastSeenAt: string;
}

interface IParticipantPresenceBinding {
  readonly sessionId: string;
  readonly participantId: string;
  readonly mode: 'Named' | 'Anonymous' | 'None';
}

/**
 * Appends through SharedTree's sequence API, with a plain-array fallback for isolated store tests.
 *
 * @param items - SharedTree sequence or plain test array.
 * @param item - Detached item to append.
 * @returns `void` after the local insertion.
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
 * Removes one item through SharedTree's sequence API, with a plain-array fallback for tests.
 *
 * @param items - SharedTree sequence or plain test array.
 * @param index - Current item index to remove.
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
 * Creates a detached user value that can be inserted into a new SharedTree field.
 *
 * @param user - Plain or hydrated user reference to copy.
 * @returns An insertable identity value with no existing tree parent.
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
 * Validates privacy-safe participant bindings received through ephemeral Fluid Presence.
 *
 * @param value - Untrusted remote presence value.
 * @returns The validated binding or `undefined`.
 */
function validateParticipantPresenceBinding(
  value: unknown
): IParticipantPresenceBinding | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const binding = value as Partial<IParticipantPresenceBinding>;
  return typeof binding.sessionId === 'string' &&
    typeof binding.participantId === 'string' &&
    (binding.mode === 'Named' || binding.mode === 'Anonymous' || binding.mode === 'None')
    ? (binding as IParticipantPresenceBinding)
    : undefined;
}

/**
 * Creates the ODSP token provider required by Fluid from an SPFx AAD token callback.
 *
 * @param webAbsoluteUrl - SharePoint web URL used to derive the storage-token audience.
 * @param getToken - Callback that obtains an AAD token for one resource audience.
 * @returns A Fluid-compatible storage and websocket token provider.
 */
export function createOdspTokenProvider(
  webAbsoluteUrl: string,
  getToken: (resource: string, refresh: boolean) => Promise<string>
): IOdspTokenProvider {
  const storageResource = new URL(webAbsoluteUrl).origin;
  const fetchToken = async (
    resource: string,
    refresh: boolean
  ): Promise<{ token: string; fromCache: boolean }> => ({
    token: await getToken(resource, refresh),
    fromCache: !refresh
  });
  return {
    fetchStorageToken: async (_siteUrl, refresh) => fetchToken(storageResource, refresh),
    fetchWebsocketToken: async (_siteUrl, refresh) =>
      fetchToken('https://pushchannel.1drv.ms', refresh)
  };
}

/** Implements the team document boundary over SharePoint metadata and ODSP Fluid containers. */
export class OdspTeamDocumentStore implements ITeamDocumentStore {
  private readonly client: OdspClient;
  private readonly attachedFiles = new Map<string, { driveItemId: string; fileName: string }>();

  /**
   * Creates a store for one validated site library.
   *
   * @param storage - Validated and persisted storage configuration.
   * @param transport - Authenticated same-origin SharePoint transport.
   * @param driveService - Authenticated Microsoft Graph drive mutation service.
   * @param tokenProvider - SPFx-backed ODSP token provider.
   * @param retryDelay - Injectable list-item propagation delay.
   */
  public constructor(
    private readonly storage: IPlanningPokerStorageConfiguration,
    private readonly transport: ISharePointTransport,
    private readonly driveService: IPlanningPokerDriveService,
    tokenProvider: IOdspTokenProvider,
    private readonly retryDelay: (attempt: number) => Promise<void> = (attempt) =>
      new Promise((resolve) => window.setTimeout(resolve, attempt * 250))
  ) {
    this.client = new OdspClient({
      connection: {
        siteUrl: storage.webAbsoluteUrl,
        driveId: storage.driveId,
        filePath: '',
        tokenProvider
      }
    });
  }

  /** @inheritdoc */
  public async list(): Promise<readonly HostedTeamSummary[]> {
    const records = await this.readTeamItems();
    const summaries = await Promise.all(records.map((record) => this.toSummary(record)));
    return summaries.filter((summary): summary is HostedTeamSummary => summary !== undefined);
  }

  /** @inheritdoc */
  public async listHostedBy(currentUser: UserReference): Promise<readonly HostedTeamSummary[]> {
    if (currentUser.sharePointUserId === undefined) {
      return [];
    }
    const records = (await this.readTeamItems()).filter(
      (record) => record.hostIds.indexOf(currentUser.sharePointUserId as number) >= 0
    );
    const summaries = await Promise.all(records.map((record) => this.toSummary(record)));
    return summaries.filter((summary): summary is HostedTeamSummary => summary !== undefined);
  }

  /** @inheritdoc */
  public async listParticipatingIn(
    currentUser: UserReference
  ): Promise<readonly HostedTeamSummary[]> {
    if (currentUser.sharePointUserId === undefined) {
      return [];
    }
    const records = (await this.readTeamItems()).filter(
      (record) => record.participantIds.indexOf(currentUser.sharePointUserId as number) >= 0
    );
    const summaries = await Promise.all(records.map((record) => this.toSummary(record)));
    return summaries.filter((summary): summary is HostedTeamSummary => summary !== undefined);
  }

  /** @inheritdoc */
  public async create(team: PlanningPokerTeam, fileName: string): Promise<TeamDocumentHandle> {
    try {
      const { container, services } = await this.client.createContainer(
        containerSchema,
        MIN_FLUID_VERSION
      );
      const view = container.initialObjects.appTree.viewWith(treeConfiguration);
      view.initialize(this.createDocument(team) as never);
      const driveItemId = await container.attach({ fileName, filePath: undefined });
      this.attachedFiles.set(team.id, { driveItemId, fileName });
      return this.createHandle(team.id, driveItemId, container, services, view);
    } catch (error: unknown) {
      throw this.normalizeFluidError(error);
    }
  }

  /** @inheritdoc */
  public async load(id: string): Promise<TeamDocumentHandle> {
    try {
      const { container, services } = await this.client.getContainer(
        id,
        containerSchema,
        MIN_FLUID_VERSION
      );
      try {
        await this.waitForConnected(container);
      } catch (error: unknown) {
        services.dispose();
        container.dispose();
        throw error;
      }
      const view = container.initialObjects.appTree.viewWith(treeConfiguration);
      const untypedView = view as unknown as ITreeRootView;
      if (untypedView.compatibility.canUpgrade === true) {
        untypedView.upgradeSchema();
      }
      if (!untypedView.compatibility.canView) {
        view.dispose();
        services.dispose();
        container.dispose();
        throw new TeamRepositoryError(
          'incompatible-schema',
          'This team was created with an incompatible Planning Poker version.'
        );
      }
      const snapshot = this.readSnapshot(untypedView);
      this.validateSchemaVersion(snapshot.schemaVersion);
      this.attachedFiles.set(snapshot.team.id, {
        driveItemId: id,
        fileName: `${snapshot.team.title}.fluid`
      });
      return this.createHandle(snapshot.team.id, id, container, services, view);
    } catch (error: unknown) {
      if (error instanceof TeamRepositoryError) {
        throw error;
      }
      throw this.normalizeFluidError(error);
    }
  }

  /** @inheritdoc */
  public async rename(teamId: string, title: string): Promise<void> {
    const attached = this.attachedFiles.get(teamId);
    const record = attached === undefined ? await this.findTeamItem(teamId) : undefined;
    const driveItemId = attached?.driveItemId ?? record?.driveItemId;
    if (driveItemId === undefined) {
      throw new TeamRepositoryError('not-found', 'The team file could not be found.');
    }
    const fileName = `${title}.fluid`;
    try {
      await this.driveService.rename(this.storage.driveId, driveItemId, fileName);
      this.attachedFiles.set(teamId, { driveItemId, fileName });
    } catch (error: unknown) {
      throw this.normalizeDriveError(error, 'The team file could not be renamed.', 'disconnected');
    }
  }

  /** @inheritdoc */
  public async recycle(driveItemId: string): Promise<{ readonly recycleBinItemId?: string }> {
    try {
      return await this.driveService.recycle(this.storage.driveId, driveItemId);
    } catch (error: unknown) {
      throw this.normalizeDriveError(
        error,
        'The team could not be moved to the SharePoint recycle bin.',
        'recycle-failure'
      );
    }
  }

  /** @inheritdoc */
  public async updateMetadata(document: PlanningPokerDocumentRoot): Promise<void> {
    const projection = projectTeamMetadata(document);
    const itemId = await this.findListItemIdWithRetry(projection.teamId);
    if (itemId === undefined) {
      throw new TeamRepositoryError('not-found', 'The team file metadata could not be found.');
    }
    const hostIds = this.requireUserIds(projection.hosts);
    const participantIds = this.requireUserIds(projection.participants);
    const body: Record<string, unknown> = {
      Title: projection.title,
      [this.field('Team ID')]: projection.teamId,
      [`${this.field('Hosts')}Id`]: hostIds,
      [`${this.field('Participants')}Id`]: participantIds,
      [this.field('Is Active')]: projection.isActive,
      [this.field('Schema Version')]: projection.schemaVersion,
      [this.field('Active Session ID')]: projection.activeSessionId ?? null,
      [this.field('Last Activity')]: projection.lastActivity
    };
    await this.transport.patch<unknown>(this.listItemPath(itemId), body);
  }

  /**
   * @param team - Initial team state.
   * @returns A new empty team document.
   */
  private createDocument(team: PlanningPokerTeam): PlanningPokerDocumentRoot {
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      team,
      stories: [],
      sessions: [],
      createdAt: team.createdAt,
      updatedAt: team.updatedAt
    };
  }

  /**
   * @param teamId - Stable team identifier.
   * @param driveItemId - Attached ODSP item identifier.
   * @param container - Owned Fluid container.
   * @param services - Owned ODSP services.
   * @param view - Typed SharedTree view.
   * @returns A lifecycle-safe domain handle.
   */
  private createHandle(
    teamId: string,
    driveItemId: string,
    container: IFluidContainer<typeof containerSchema>,
    services: OdspContainerServices,
    view: TreeView<typeof PlanningPokerDocumentRootSchema>
  ): TeamDocumentHandle {
    const untypedView = view as unknown as ITreeRootView;
    let isDisposed = false;
    let presenceReconcileTimeoutId: number | undefined;
    const participantBindings = new Map<Attendee, IParticipantPresenceBinding>();
    const presence = getPresence(container);
    const presenceSchema = {
      participant: StateFactory.latest<IParticipantPresenceBinding>({
        local: { sessionId: '', participantId: '', mode: 'None' },
        validator: validateParticipantPresenceBinding
      })
    } as const satisfies StatesWorkspaceSchema;
    const participantPresence: Latest<IParticipantPresenceBinding> = presence.states.getWorkspace(
      'planning-poker:participant:v1',
      presenceSchema
    ).states.participant;
    const setParticipantConnection = (
      sessionId: string,
      participantId: string,
      connection: 'Connected' | 'Disconnected',
      timestamp: string
    ): void => {
      Tree.runTransaction(view, (root) => {
        const document = root as unknown as IMutableDocumentRoot;
        const sessionNode = document.sessions.find((session) => session.id === sessionId);
        const participant = sessionNode?.participants.find(
          (candidate) => candidate.id === participantId
        );
        if (participant === undefined) {
          return;
        }
        const presence = participant.presence as IMutableParticipantPresence;
        presence.connection = connection;
        presence.lastSeenAt = timestamp;
      });
    };
    const removeAnonymousPresenceParticipant = (
      binding: IParticipantPresenceBinding,
      timestamp: string
    ): void => {
      Tree.runTransaction(view, (root) => {
        const document = root as unknown as IMutableDocumentRoot;
        const sessionNode = document.sessions.find(
          (candidate) =>
            candidate.id === binding.sessionId &&
            candidate.id === document.openSessionId &&
            (candidate.status === 'Lobby' || candidate.status === 'Active')
        );
        if (sessionNode === undefined) {
          return;
        }
        const participantIndex = sessionNode.participants.findIndex(
          (participant) => participant.id === binding.participantId
        );
        if (participantIndex < 0) {
          return;
        }
        removeTreeItemAt(sessionNode.participants, participantIndex);
        const activeRound = sessionNode.rounds.find(
          (candidate) => candidate.id === sessionNode.activeRoundId && candidate.status === 'Voting'
        );
        const voteIndex =
          activeRound?.votes.findIndex((vote) => vote.participantId === binding.participantId) ??
          -1;
        if (activeRound !== undefined && voteIndex >= 0) {
          removeTreeItemAt(activeRound.votes, voteIndex);
        }
        const session = sessionNode as unknown as IMutableVotingSession;
        session.updatedAt = timestamp;
        document.updatedAt = timestamp;
      });
    };
    const getBinding = (attendee: Attendee): IParticipantPresenceBinding | undefined =>
      participantPresence.getRemote(attendee).value();
    const hasConnectedBinding = (binding: IParticipantPresenceBinding): boolean => {
      const myself = presence.attendees.getMyself();
      if (
        myself.getConnectionStatus() === 'Connected' &&
        participantPresence.local.sessionId === binding.sessionId &&
        participantPresence.local.participantId === binding.participantId
      ) {
        return true;
      }
      return participantPresence.getStateAttendees().some((attendee: Attendee) => {
        if (attendee === myself) {
          return false;
        }
        const candidate = getBinding(attendee);
        return (
          attendee.getConnectionStatus() === 'Connected' &&
          candidate?.sessionId === binding.sessionId &&
          candidate.participantId === binding.participantId
        );
      });
    };
    const isParticipantConnected = (sessionId: string, participant: SessionParticipant): boolean =>
      participant.presence.connection === 'Connected' ||
      hasConnectedBinding({
        sessionId,
        participantId: participant.id,
        mode: participant.kind
      });
    const handlePresenceConnected = (binding: IParticipantPresenceBinding): void => {
      if (binding.mode !== 'None') {
        setParticipantConnection(
          binding.sessionId,
          binding.participantId,
          'Connected',
          new Date().toISOString()
        );
      }
    };
    const reconcileParticipantPresence = (): void => {
      const connectedBindings = new Set<string>();
      if (
        presence.attendees.getMyself().getConnectionStatus() === 'Connected' &&
        participantPresence.local.mode !== 'None'
      ) {
        connectedBindings.add(
          `${participantPresence.local.sessionId}:${participantPresence.local.participantId}`
        );
      }
      const myself = presence.attendees.getMyself();
      participantPresence.getStateAttendees().forEach((attendee: Attendee) => {
        if (attendee === myself || attendee.getConnectionStatus() !== 'Connected') {
          return;
        }
        const binding = getBinding(attendee);
        if (binding !== undefined && binding.mode !== 'None') {
          participantBindings.set(attendee, binding);
          connectedBindings.add(`${binding.sessionId}:${binding.participantId}`);
        }
      });
      const document = this.readSnapshot(untypedView);
      document.sessions
        .filter(
          (session) =>
            (session.status === 'Lobby' || session.status === 'Active') &&
            session.id === document.openSessionId
        )
        .forEach((session) => {
          const timestamp = new Date().toISOString();
          session.participants.forEach((participant) => {
            const isConnected = connectedBindings.has(`${session.id}:${participant.id}`);
            if (participant.kind === 'Anonymous') {
              if (!isConnected) {
                removeAnonymousPresenceParticipant(
                  { sessionId: session.id, participantId: participant.id, mode: 'Anonymous' },
                  timestamp
                );
              }
            } else if (
              participant.presence.connection !== (isConnected ? 'Connected' : 'Disconnected')
            ) {
              setParticipantConnection(
                session.id,
                participant.id,
                isConnected ? 'Connected' : 'Disconnected',
                timestamp
              );
            }
          });
        });
    };
    const schedulePresenceReconciliation = (): void => {
      if (presenceReconcileTimeoutId !== undefined) {
        window.clearTimeout(presenceReconcileTimeoutId);
      }
      presenceReconcileTimeoutId = window.setTimeout(() => {
        presenceReconcileTimeoutId = undefined;
        reconcileParticipantPresence();
      }, 3000);
    };
    const handlePresenceDisconnected = (attendee: Attendee): void => {
      const binding = participantBindings.get(attendee) ?? getBinding(attendee);
      participantBindings.delete(attendee);
      if (binding === undefined || binding.mode === 'None' || hasConnectedBinding(binding)) {
        schedulePresenceReconciliation();
        return;
      }
      if (binding.mode === 'Anonymous') {
        removeAnonymousPresenceParticipant(binding, new Date().toISOString());
      } else {
        setParticipantConnection(
          binding.sessionId,
          binding.participantId,
          'Disconnected',
          new Date().toISOString()
        );
      }
      schedulePresenceReconciliation();
    };
    const stopTimerForReveal = (round: StoryVotingRound, timestamp: string): VotingTimer => {
      const elapsedMilliseconds =
        round.timer.status === 'Running' && round.timer.startedAt !== undefined
          ? Date.parse(timestamp) - Date.parse(round.timer.startedAt)
          : 0;
      const elapsedSeconds = Number.isFinite(elapsedMilliseconds)
        ? Math.max(0, Math.floor(elapsedMilliseconds / 1000))
        : 0;
      return {
        configuredDurationSeconds: round.timer.configuredDurationSeconds,
        status: 'Stopped',
        remainingSeconds: Math.max(0, round.timer.remainingSeconds - elapsedSeconds),
        stoppedAt: timestamp
      };
    };
    const revealRound = (
      session: VotingSession,
      round: StoryVotingRound,
      reason: import('../domain/planningPokerDomain').RevealReason,
      currentUser: UserReference | undefined,
      timestamp: string
    ): void => {
      const connectedParticipants = session.participants.filter((participant) =>
        isParticipantConnected(session.id, participant)
      );
      const votedIds = new Set(round.votes.map((vote) => vote.participantId));
      const mutableRound = round as unknown as IMutableVotingRound;
      mutableRound.status = 'Revealed';
      mutableRound.revealedAt = timestamp;
      mutableRound.revealReason = reason;
      mutableRound.revealedVotedCount = round.votes.length;
      mutableRound.revealedMissingCount = connectedParticipants.filter(
        (participant) => !votedIds.has(participant.id)
      ).length;
      if (
        currentUser !== undefined &&
        (reason === 'Manual' || session.settings.votingMode === 'Named')
      ) {
        mutableRound.revealedBy = copyUserReference(currentUser);
      }
      if (session.settings.timerEnabled && round.timer.status !== 'Stopped') {
        mutableRound.timer = stopTimerForReveal(round, timestamp);
      }
    };
    return {
      teamId,
      driveItemId,
      getSnapshot: () => this.readSnapshot(untypedView),
      getConnectionState: () =>
        container.connectionState === FLUID_CONNECTED_STATE ? 'Connected' : 'Disconnected',
      updateTeam: (team) => {
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          document.team = team;
          document.updatedAt = team.updatedAt;
        });
      },
      updateStories: (stories, updatedAt) => {
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          document.stories = stories;
          document.updatedAt = updatedAt;
        });
      },
      updateSessions: (sessions, openSessionId, updatedAt) => {
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          document.sessions = sessions;
          document.openSessionId = openSessionId;
          document.updatedAt = updatedAt;
        });
      },
      prepareVotingSession: (session, updatedAt) => {
        let selectedSessionId = session.id;
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const existing = document.sessions.find(
            (candidate) =>
              candidate.id === document.openSessionId &&
              (candidate.status === 'Lobby' || candidate.status === 'Active')
          );
          if (existing !== undefined) {
            selectedSessionId = existing.id;
            return;
          }
          appendTreeItem(document.sessions, session);
          document.openSessionId = session.id;
          document.updatedAt = updatedAt;
        });
        return selectedSessionId;
      },
      joinVotingSession: (sessionId, participant, timestamp) => {
        let selected: SessionParticipant | undefined;
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              (candidate.status === 'Lobby' || candidate.status === 'Active')
          );
          if (sessionNode === undefined) {
            return;
          }
          const session = sessionNode as unknown as IMutableVotingSession;
          const currentParticipants = cloneParticipants(session.participants);
          const existing = findJoinedParticipant(currentParticipants, participant);
          if (existing !== undefined) {
            selected = {
              ...existing,
              presence: { connection: 'Connected', lastSeenAt: timestamp }
            };
          } else if (participant.kind === 'Named') {
            selected = {
              kind: 'Named',
              id: participant.participantId,
              user: participant.user,
              joinedAt: timestamp,
              presence: { connection: 'Connected', lastSeenAt: timestamp }
            };
          } else {
            const aliasNumber = nextAnonymousAliasNumber(currentParticipants);
            selected = {
              kind: 'Anonymous',
              id: participant.participantId,
              alias: `Participant ${aliasNumber}`,
              joinedAt: timestamp,
              presence: { connection: 'Connected', lastSeenAt: timestamp }
            };
          }
          const selectedParticipant = selected;
          if (selectedParticipant === undefined) {
            return;
          }
          const participants =
            existing === undefined
              ? [...currentParticipants, selectedParticipant]
              : currentParticipants.map((current) =>
                  current.id === existing.id ? selectedParticipant : current
                );
          session.participants = participants;
          session.updatedAt = timestamp;
          document.updatedAt = timestamp;
        });
        if (selected !== undefined) {
          participantPresence.local = {
            sessionId,
            participantId: selected.id,
            mode: selected.kind
          };
          schedulePresenceReconciliation();
        }
        return selected;
      },
      selectVotingStory: (sessionId, storyId, roundId, currentUser, replaceActive, timestamp) => {
        let result: import('./teamRepository').VotingStorySelectionResult = 'invalid-session';
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              candidate.id === document.openSessionId &&
              candidate.status === 'Active'
          );
          if (sessionNode === undefined) {
            return;
          }
          if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
            result = 'host-required';
            return;
          }
          const story = document.stories.find(
            (candidate) => candidate.id === storyId && candidate.status === 'Ready'
          );
          const finalizedStoryIds = new Set(
            sessionNode.rounds
              .filter((candidate) => sessionNode.finalizedRoundIds.indexOf(candidate.id) >= 0)
              .map((candidate) => candidate.storyId)
          );
          if (story === undefined || finalizedStoryIds.has(storyId)) {
            result = 'invalid-story';
            return;
          }
          const currentRound = sessionNode.rounds.find(
            (candidate) => candidate.id === sessionNode.activeRoundId
          );
          if (currentRound !== undefined) {
            if (!replaceActive) {
              result = 'active-round';
              return;
            }
            if (currentRound.status !== 'Voting' || currentRound.votes.length > 0) {
              result = 'round-has-votes';
              return;
            }
          }
          const session = sessionNode as unknown as IMutableVotingSession;
          if (currentRound !== undefined) {
            (currentRound as unknown as IMutableVotingRound).status = 'Cancelled';
          }
          const configuredDurationSeconds = sessionNode.settings.timerEnabled
            ? (sessionNode.settings.timerDurationSeconds ?? 0)
            : 0;
          const round: StoryVotingRound = {
            id: roundId,
            storyId: story.id,
            storySnapshot: {
              storyId: story.id,
              title: story.title,
              description: story.description,
              ...(story.link === undefined ? {} : { link: story.link })
            },
            status: 'Voting',
            votes: [],
            timer: {
              configuredDurationSeconds,
              status: 'Ready',
              remainingSeconds: configuredDurationSeconds
            }
          };
          appendTreeItem(session.rounds, round);
          session.activeRoundId = roundId;
          session.updatedAt = timestamp;
          document.updatedAt = timestamp;
          result = 'selected';
        });
        return result;
      },
      castVotingVote: (sessionId, roundId, vote) => {
        let result: import('./teamRepository').VotingVoteResult = 'invalid-session';
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              candidate.id === document.openSessionId &&
              candidate.status === 'Active'
          );
          if (sessionNode === undefined) {
            return;
          }
          if (
            !sessionNode.participants.some((participant) => participant.id === vote.participantId)
          ) {
            result = 'participant-required';
            return;
          }
          const round = sessionNode.rounds.find((candidate) => candidate.id === roundId);
          if (
            round === undefined ||
            sessionNode.activeRoundId !== roundId ||
            round.status !== 'Voting'
          ) {
            result = 'invalid-round';
            return;
          }
          if (sessionNode.settings.scaleValues.indexOf(vote.value) < 0) {
            result = 'invalid-vote';
            return;
          }
          const session = sessionNode as unknown as IMutableVotingSession;
          const existingVote = round.votes.find(
            (candidate) => candidate.participantId === vote.participantId
          );
          if (existingVote === undefined) {
            appendTreeItem(round.votes, vote);
          } else {
            const mutableVote = existingVote as unknown as IMutableVoteRecord;
            mutableVote.value = vote.value;
            mutableVote.castAt = vote.castAt;
          }
          session.updatedAt = vote.castAt;
          document.updatedAt = vote.castAt;
          const connectedParticipants = sessionNode.participants.filter((participant) =>
            isParticipantConnected(sessionNode.id, participant)
          );
          const votedIds = new Set(round.votes.map((candidate) => candidate.participantId));
          if (
            connectedParticipants.length > 0 &&
            connectedParticipants.every((participant) => votedIds.has(participant.id))
          ) {
            const participant = sessionNode.participants.find(
              (candidate) => candidate.id === vote.participantId
            );
            revealRound(
              sessionNode,
              round,
              'Automatic',
              participant?.kind === 'Named' ? participant.user : undefined,
              vote.castAt
            );
          }
          result = 'cast';
        });
        return result;
      },
      updateVotingTimer: (sessionId, roundId, command, currentUser, timestamp) => {
        let result: import('./teamRepository').VotingTimerResult = 'invalid-session';
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              candidate.id === document.openSessionId &&
              candidate.status === 'Active'
          );
          if (sessionNode === undefined) {
            return;
          }
          if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
            result = 'host-required';
            return;
          }
          if (!sessionNode.settings.timerEnabled) {
            result = 'timer-disabled';
            return;
          }
          const round = sessionNode.rounds.find(
            (candidate) =>
              candidate.id === roundId &&
              candidate.id === sessionNode.activeRoundId &&
              candidate.status === 'Voting'
          );
          if (round === undefined) {
            result = 'invalid-round';
            return;
          }
          const elapsedMilliseconds =
            round.timer.status === 'Running' && round.timer.startedAt !== undefined
              ? Date.parse(timestamp) - Date.parse(round.timer.startedAt)
              : 0;
          const elapsedSeconds = Number.isFinite(elapsedMilliseconds)
            ? Math.max(0, Math.floor(elapsedMilliseconds / 1000))
            : 0;
          const remainingSeconds = Math.max(0, round.timer.remainingSeconds - elapsedSeconds);
          const isFullyReset =
            round.timer.status === 'Ready' &&
            round.timer.remainingSeconds === round.timer.configuredDurationSeconds;
          if (
            (command === 'start' && (round.timer.status === 'Running' || remainingSeconds === 0)) ||
            (command === 'stop' && round.timer.status !== 'Running') ||
            (command === 'reset' && isFullyReset)
          ) {
            result = 'invalid-command';
            return;
          }
          const mutableRound = round as unknown as IMutableVotingRound;
          if (command === 'reset') {
            mutableRound.timer = {
              configuredDurationSeconds: round.timer.configuredDurationSeconds,
              status: 'Ready',
              remainingSeconds: round.timer.configuredDurationSeconds,
              resetAt: timestamp
            };
          } else if (command === 'stop') {
            mutableRound.timer = {
              configuredDurationSeconds: round.timer.configuredDurationSeconds,
              status: 'Stopped',
              remainingSeconds,
              stoppedAt: timestamp
            };
          } else {
            mutableRound.timer = {
              configuredDurationSeconds: round.timer.configuredDurationSeconds,
              status: 'Running',
              remainingSeconds,
              startedAt: timestamp
            };
          }
          const session = sessionNode as unknown as IMutableVotingSession;
          session.updatedAt = timestamp;
          document.updatedAt = timestamp;
          result = 'updated';
        });
        return result;
      },
      revealVotingRound: (sessionId, roundId, currentUser, timestamp) => {
        let result: import('./teamRepository').VotingRevealResult = 'invalid-session';
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              candidate.id === document.openSessionId &&
              candidate.status === 'Active'
          );
          if (sessionNode === undefined) {
            return;
          }
          const round = sessionNode.rounds.find((candidate) => candidate.id === roundId);
          if (round?.status === 'Revealed' || round?.status === 'Finalized') {
            result = 'already-revealed';
            return;
          }
          if (
            round === undefined ||
            round.id !== sessionNode.activeRoundId ||
            round.status !== 'Voting'
          ) {
            result = 'invalid-round';
            return;
          }
          if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
            result = 'host-required';
            return;
          }
          revealRound(sessionNode, round, 'Manual', currentUser, timestamp);
          const session = sessionNode as unknown as IMutableVotingSession;
          session.updatedAt = timestamp;
          document.updatedAt = timestamp;
          result = 'revealed';
        });
        return result;
      },
      undoVotingRoundReveal: (sessionId, roundId, currentUser, timestamp) => {
        let result: import('./teamRepository').VotingUndoRevealResult = 'invalid-session';
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              candidate.id === document.openSessionId &&
              candidate.status === 'Active'
          );
          if (sessionNode === undefined) {
            return;
          }
          if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
            result = 'host-required';
            return;
          }
          const round = sessionNode.rounds.find((candidate) => candidate.id === roundId);
          if (
            round === undefined ||
            round.id !== sessionNode.activeRoundId ||
            round.status !== 'Revealed'
          ) {
            result = 'invalid-round';
            return;
          }
          const mutableRound = round as unknown as IMutableVotingRound;
          mutableRound.status = 'Voting';
          mutableRound.revealedAt = undefined;
          mutableRound.revealedBy = undefined;
          mutableRound.revealReason = undefined;
          mutableRound.revealedVotedCount = undefined;
          mutableRound.revealedMissingCount = undefined;
          const session = sessionNode as unknown as IMutableVotingSession;
          session.updatedAt = timestamp;
          document.updatedAt = timestamp;
          result = 'reopened';
        });
        return result;
      },
      finalizeVotingRound: (sessionId, roundId, scaleValue, currentUser, timestamp) => {
        let result: import('./teamRepository').VotingFinalizeResult = 'invalid-session';
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find(
            (candidate) =>
              candidate.id === sessionId &&
              candidate.id === document.openSessionId &&
              candidate.status === 'Active'
          );
          if (sessionNode === undefined) {
            return;
          }
          if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
            result = 'host-required';
            return;
          }
          const round = sessionNode.rounds.find((candidate) => candidate.id === roundId);
          if (round?.status === 'Finalized') {
            if (round.assignedValue === scaleValue) {
              result = 'already-finalized';
              return;
            }
            if (sessionNode.settings.scaleValues.indexOf(scaleValue) < 0) {
              result = 'invalid-estimate';
              return;
            }
            const story = document.stories.find(
              (candidate) => candidate.id === round.storyId && candidate.status === 'Pointed'
            );
            if (story === undefined) {
              result = 'invalid-story';
              return;
            }
            const mutableRound = round as unknown as IMutableVotingRound;
            mutableRound.assignedValue = scaleValue;
            mutableRound.finalizedAt = timestamp;
            mutableRound.finalizedBy = copyUserReference(currentUser);
            const mutableStory = story as unknown as IMutablePointingStory;
            mutableStory.currentEstimate = scaleValue;
            appendTreeItem(mutableStory.estimateHistory, {
              sessionId,
              roundId,
              value: scaleValue,
              finalizedAt: timestamp,
              finalizedBy: copyUserReference(currentUser)
            });
            mutableStory.updatedAt = timestamp;
            mutableStory.updatedBy = copyUserReference(currentUser);
            const session = sessionNode as unknown as IMutableVotingSession;
            session.updatedAt = timestamp;
            document.updatedAt = timestamp;
            result = 'finalized';
            return;
          }
          if (
            round === undefined ||
            round.id !== sessionNode.activeRoundId ||
            round.status !== 'Revealed'
          ) {
            result = 'invalid-round';
            return;
          }
          if (sessionNode.settings.scaleValues.indexOf(scaleValue) < 0) {
            result = 'invalid-estimate';
            return;
          }
          const story = document.stories.find(
            (candidate) => candidate.id === round.storyId && candidate.status === 'Ready'
          );
          if (story === undefined) {
            result = 'invalid-story';
            return;
          }
          const mutableRound = round as unknown as IMutableVotingRound;
          mutableRound.status = 'Finalized';
          mutableRound.assignedValue = scaleValue;
          mutableRound.finalizedAt = timestamp;
          mutableRound.finalizedBy = copyUserReference(currentUser);
          const mutableStory = story as unknown as IMutablePointingStory;
          mutableStory.status = 'Pointed';
          mutableStory.currentEstimate = scaleValue;
          appendTreeItem(mutableStory.estimateHistory, {
            sessionId,
            roundId,
            value: scaleValue,
            finalizedAt: timestamp,
            finalizedBy: copyUserReference(currentUser)
          });
          mutableStory.updatedAt = timestamp;
          mutableStory.updatedBy = copyUserReference(currentUser);
          const session = sessionNode as unknown as IMutableVotingSession;
          appendTreeItem(sessionNode.finalizedRoundIds, roundId);
          session.activeRoundId = undefined;
          session.updatedAt = timestamp;
          document.updatedAt = timestamp;
          result = 'finalized';
        });
        return result;
      },
      endVotingSession: (sessionId, currentUser, timestamp) => {
        let result: import('./teamRepository').VotingEndResult = 'invalid-session';
        let didEnd = false;
        Tree.runTransaction(view, (root) => {
          const document = root as unknown as IMutableDocumentRoot;
          const sessionNode = document.sessions.find((candidate) => candidate.id === sessionId);
          if (sessionNode?.status === 'Ended') {
            result = 'already-ended';
            return;
          }
          if (
            sessionNode === undefined ||
            sessionNode.id !== document.openSessionId ||
            (sessionNode.status !== 'Lobby' && sessionNode.status !== 'Active')
          ) {
            return;
          }
          if (!document.team.hosts.some((host) => host.objectId === currentUser.objectId)) {
            result = 'host-required';
            return;
          }
          const activeRound = sessionNode.rounds.find(
            (candidate) => candidate.id === sessionNode.activeRoundId
          );
          if (
            activeRound !== undefined &&
            (activeRound.status === 'Voting' || activeRound.status === 'Revealed')
          ) {
            const mutableRound = activeRound as unknown as IMutableVotingRound;
            mutableRound.status = 'Cancelled';
            if (activeRound.timer.status !== 'Stopped') {
              mutableRound.timer = stopTimerForReveal(activeRound, timestamp);
            }
          }
          const session = sessionNode as unknown as IMutableVotingSession;
          session.status = 'Ended';
          session.activeRoundId = undefined;
          session.endedAt = timestamp;
          session.endedBy = copyUserReference(currentUser);
          session.updatedAt = timestamp;
          document.openSessionId = undefined;
          document.updatedAt = timestamp;
          result = 'ended';
          didEnd = true;
        });
        if (didEnd) {
          participantPresence.local = { sessionId: '', participantId: '', mode: 'None' };
        }
        return result;
      },
      setVotingParticipantConnection: setParticipantConnection,
      waitForSaved: () => this.waitForSaved(container),
      subscribe: (listener) => {
        const root = untypedView.root as TreeNode;
        let isSubscribed = true;
        const unsubscribe = Tree.on(root, 'treeChanged', listener);
        const unsubscribePresenceUpdated = participantPresence.events.on(
          'remoteUpdated',
          (update: {
            attendee: Attendee;
            value: () => IParticipantPresenceBinding | undefined;
          }) => {
            const binding = update.value();
            if (binding !== undefined) {
              participantBindings.set(update.attendee, binding);
              handlePresenceConnected(binding);
              schedulePresenceReconciliation();
            }
          }
        );
        const unsubscribePresenceDisconnected = presence.attendees.events.on(
          'attendeeDisconnected',
          handlePresenceDisconnected
        );
        schedulePresenceReconciliation();
        container.on('connected', listener);
        container.on('disconnected', listener);
        return (): void => {
          if (isSubscribed) {
            isSubscribed = false;
            unsubscribe();
            container.off('connected', listener);
            container.off('disconnected', listener);
            unsubscribePresenceUpdated();
            unsubscribePresenceDisconnected();
          }
        };
      },
      dispose: () => {
        if (!isDisposed) {
          isDisposed = true;
          if (presenceReconcileTimeoutId !== undefined) {
            window.clearTimeout(presenceReconcileTimeoutId);
          }
          view.dispose();
          services.dispose();
          container.dispose();
        }
      }
    };
  }

  /**
   * @param container - Fluid container whose local operations must be acknowledged.
   * @returns A promise that resolves when the container becomes clean.
   */
  private async waitForSaved(container: IFluidContainer<typeof containerSchema>): Promise<void> {
    if (!container.isDirty) {
      return;
    }
    container.connect();
    await new Promise<void>((resolve, reject) => {
      const timeoutState: { id?: number } = {};
      const handleSaved = (): void => {
        if (timeoutState.id !== undefined) {
          window.clearTimeout(timeoutState.id);
        }
        container.off('saved', handleSaved);
        resolve();
      };
      timeoutState.id = window.setTimeout(() => {
        container.off('saved', handleSaved);
        reject(
          new TeamRepositoryError(
            'save-timeout',
            'The team is still waiting for SharePoint to acknowledge the save.'
          )
        );
      }, SAVE_TIMEOUT_MS);
      container.on('saved', handleSaved);
      if (!container.isDirty) {
        handleSaved();
      }
    });
  }

  /**
   * Waits until a newly loaded container has processed remote operations before reading its tree.
   *
   * @param container - Loaded Fluid container that may still be catching up.
   * @returns A promise that resolves after Fluid reports the connected state.
   */
  private async waitForConnected(
    container: IFluidContainer<typeof containerSchema>
  ): Promise<void> {
    if (container.connectionState === FLUID_CONNECTED_STATE) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let isSettled = false;
      const listenerState: {
        timeoutId?: number;
        handleConnected: () => void;
        handleDisposed: () => void;
      } = {
        handleConnected: () => undefined,
        handleDisposed: () => undefined
      };
      const cleanup = (): void => {
        if (listenerState.timeoutId !== undefined) {
          window.clearTimeout(listenerState.timeoutId);
        }
        container.off('connected', listenerState.handleConnected);
        container.off('disposed', listenerState.handleDisposed);
      };
      listenerState.handleConnected = (): void => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          resolve();
        }
      };
      listenerState.handleDisposed = (): void => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(
            new TeamRepositoryError(
              'disconnected',
              'The team could not connect to SharePoint collaboration services.'
            )
          );
        }
      };
      listenerState.timeoutId = window.setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(
            new TeamRepositoryError(
              'disconnected',
              'The team could not catch up with SharePoint collaboration services.'
            )
          );
        }
      }, CONNECTION_TIMEOUT_MS);
      container.on('connected', listenerState.handleConnected);
      container.on('disposed', listenerState.handleDisposed);
      if (container.connectionState === FLUID_CONNECTED_STATE) {
        listenerState.handleConnected();
      } else if (container.connectionState === FLUID_DISCONNECTED_STATE) {
        container.connect();
      }
    });
  }

  /**
   * @param view - Live tree view.
   * @returns A detached serializable document snapshot.
   */
  private readSnapshot(view: ITreeRootView): PlanningPokerDocumentRoot {
    try {
      const value: unknown = JSON.parse(JSON.stringify(view.root)) as unknown;
      if (typeof value !== 'object' || value === null || !('team' in value)) {
        throw new Error('missing root');
      }
      return value as PlanningPokerDocumentRoot;
    } catch {
      throw new TeamRepositoryError(
        'corrupt-document',
        'This team document is missing required Planning Poker data.'
      );
    }
  }

  /** @param version - Persisted schema version. @returns `void` when supported. */
  private validateSchemaVersion(version: string): void {
    if (version < MIN_SUPPORTED_SCHEMA_VERSION || version > MAX_SUPPORTED_SCHEMA_VERSION) {
      throw new TeamRepositoryError(
        'incompatible-schema',
        'This team uses an unsupported Planning Poker schema version.'
      );
    }
  }

  /** @returns Parsed team metadata items from the configured library. */
  private async readTeamItems(): Promise<readonly ITeamItemRecord[]> {
    const hostField = this.field('Hosts');
    const participantField = this.field('Participants');
    const response = await this.transport.get<unknown>(
      `${this.listPath()}/items?$select=Id,Title,File/Name,${this.field('Team ID')},${this.field(
        'Is Active'
      )},${this.field(
        'Active Session ID'
      )},${hostField}/Id,${participantField}/Id&$expand=File,${hostField},${participantField}`
    );
    return this.unwrapResults(response)
      .map((value) => this.parseTeamItem(value))
      .filter((item): item is ITeamItemRecord => item !== undefined);
  }

  /**
   * @param value - Untrusted list item.
   * @returns A validated metadata record when usable.
   */
  private parseTeamItem(value: unknown): ITeamItemRecord | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const item = value as ITeamListItem;
    const itemId = this.readNumber(item.Id);
    const fileName = this.readString(item.File?.Name);
    const attachedTeamId = Array.from(this.attachedFiles.entries()).find(
      (entry) => entry[1].fileName === fileName
    )?.[0];
    const teamId = this.readString(item[this.field('Team ID')]) ?? attachedTeamId;
    const title = this.readString(item.Title);
    if (
      itemId === undefined ||
      fileName === undefined ||
      teamId === undefined ||
      title === undefined
    ) {
      return undefined;
    }
    return {
      itemId,
      fileName,
      teamId,
      title,
      isActive: Boolean(item[this.field('Is Active')]),
      activeSessionId: this.readString(item[this.field('Active Session ID')]),
      hostIds: this.readPersonIds(item[this.field('Hosts')]),
      participantIds: this.readPersonIds(item[this.field('Participants')]),
      driveItemId: this.attachedFiles.get(teamId)?.driveItemId
    };
  }

  /**
   * @param record - Parsed list item.
   * @returns Its hosted-team summary when resolvable.
   */
  private async toSummary(record: ITeamItemRecord): Promise<HostedTeamSummary | undefined> {
    try {
      const driveItemId = record.driveItemId ?? (await this.resolveDriveItemId(record.fileName));
      return {
        teamId: record.teamId,
        driveItemId,
        title: record.title,
        isActive: record.isActive,
        activeSessionId: record.activeSessionId
      };
    } catch {
      return undefined;
    }
  }

  /**
   * @param teamId - Stable team ID.
   * @returns The current metadata item when present.
   */
  private async findTeamItem(teamId: string): Promise<ITeamItemRecord | undefined> {
    return (await this.readTeamItems()).find((item) => item.teamId === teamId);
  }

  /**
   * @param teamId - Stable team ID whose attached list item may still be propagating.
   * @returns The numeric list-item ID when SharePoint exposes it within the bounded retry window.
   */
  private async findListItemIdWithRetry(teamId: string): Promise<number | undefined> {
    const attached = this.attachedFiles.get(teamId);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      if (attached !== undefined) {
        try {
          const response = await this.driveService.get(this.storage.driveId, attached.driveItemId);
          const attachedItemId =
            this.readNumber(response.sharepointIds?.listItemId) ??
            this.readNumber(response.listItem?.id);
          if (attachedItemId !== undefined) {
            return attachedItemId;
          }
        } catch {
          // The attached file's list-item relationship can lag behind ODSP attachment.
        }
      }
      if (attached === undefined) {
        const item = (await this.readTeamItems()).find((candidate) => candidate.teamId === teamId);
        if (item !== undefined) {
          return item.itemId;
        }
      }
      await this.retryDelay(attempt);
    }
    return undefined;
  }

  /**
   * @param fileName - Team Fluid file name.
   * @returns Its ODSP drive item identifier.
   */
  private async resolveDriveItemId(fileName: string): Promise<string> {
    const response: IGraphDriveItem = await this.driveService.getByPath(
      this.storage.driveId,
      fileName
    );
    const id = this.readString(response.id);
    if (id === undefined) {
      throw new Error('Missing drive item id.');
    }
    return id;
  }

  /**
   * @param users - People projected to metadata.
   * @returns Their resolved SharePoint IDs.
   */
  private requireUserIds(users: readonly UserReference[]): readonly number[] {
    const ids = users.map((user) => user.sharePointUserId);
    if (ids.some((id) => id === undefined)) {
      throw new TeamRepositoryError(
        'metadata-sync',
        'One or more team users could not be resolved in this SharePoint site.'
      );
    }
    return ids as readonly number[];
  }

  /**
   * @param value - Expanded SharePoint person field.
   * @returns Its numeric user IDs.
   */
  private readPersonIds(value: unknown): readonly number[] {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'object' && value !== null && 'results' in value
        ? (value as { results?: unknown }).results
        : [];
    return Array.isArray(values)
      ? values
          .map((person) =>
            typeof person === 'object' && person !== null
              ? this.readNumber((person as ISharePointPersonValue).Id)
              : this.readNumber(person)
          )
          .filter((id): id is number => id !== undefined)
      : [];
  }

  /**
   * @param value - Modern or verbose response.
   * @returns Its result collection.
   */
  private unwrapResults(value: unknown): readonly unknown[] {
    if (typeof value !== 'object' || value === null) {
      return [];
    }
    const response = value as { value?: unknown; d?: { results?: unknown } };
    const results = response.value ?? response.d?.results;
    return Array.isArray(results) ? results : [];
  }

  /**
   * @param displayName - Stable field display name.
   * @returns Its validated internal name.
   */
  private field(displayName: string): string {
    const internalName = this.storage.fieldMap[displayName];
    if (internalName === undefined || !/^[A-Za-z0-9_]+$/.test(internalName)) {
      throw new TeamRepositoryError(
        'not-configured',
        'Planning Poker storage metadata is not configured correctly.'
      );
    }
    return internalName;
  }

  /** @returns The configured list REST path. */
  private listPath(): string {
    const listId = this.storage.listId.replace(/[{}]/g, '');
    return `_api/web/lists(guid'${listId}')`;
  }

  /**
   * @param itemId - SharePoint list item ID.
   * @returns Its REST path.
   */
  private listItemPath(itemId: number): string {
    return `${this.listPath()}/items(${itemId})`;
  }

  /**
   * @param value - Untrusted value.
   * @returns A non-empty string when present.
   */
  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  /**
   * @param value - Untrusted value.
   * @returns A positive integer when present.
   */
  private readNumber(value: unknown): number | undefined {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
  }

  /**
   * @param error - Unknown ODSP failure.
   * @returns A safe repository error.
   */
  private normalizeFluidError(error: unknown): TeamRepositoryError {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : undefined;
    if (status === 401 || status === 403) {
      return new TeamRepositoryError('access-denied', 'SharePoint denied access to this team.');
    }
    if (status === 404) {
      return new TeamRepositoryError('not-found', 'The team file could not be found.');
    }
    return new TeamRepositoryError(
      'disconnected',
      'The team could not connect to SharePoint collaboration services.'
    );
  }

  /**
   * @param error - Unknown Microsoft Graph drive failure.
   * @param fallbackMessage - Safe operation-specific fallback message.
   * @param fallbackCode - Stable operation-specific fallback category.
   * @returns A safe repository error preserving actionable status categories.
   */
  private normalizeDriveError(
    error: unknown,
    fallbackMessage: string,
    fallbackCode: 'disconnected' | 'recycle-failure'
  ): TeamRepositoryError {
    const status =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : undefined;
    if (status === 401 || status === 403) {
      return new TeamRepositoryError(
        'access-denied',
        'Microsoft Graph denied access to the team file.'
      );
    }
    if (status === 404) {
      return new TeamRepositoryError('not-found', 'The team file could not be found.');
    }
    return new TeamRepositoryError(fallbackCode, fallbackMessage);
  }
}

/**
 * Finds an existing logical participant without correlating anonymous state to M365 identity.
 *
 * @param participants - Current durable joined roster.
 * @param join - Incoming identity-safe join request.
 * @returns The matching logical participant, when already joined.
 */
function findJoinedParticipant(
  participants: readonly SessionParticipant[],
  join: SessionParticipantJoin
): SessionParticipant | undefined {
  return participants.find((participant) =>
    join.kind === 'Named'
      ? participant.kind === 'Named' && participant.user.objectId === join.user.objectId
      : participant.kind === 'Anonymous' && participant.id === join.participantId
  );
}

/**
 * Allocates the next unused positive anonymous alias number in current transaction state.
 *
 * @param participants - Current durable joined roster.
 * @returns The lowest unused positive alias number.
 */
function nextAnonymousAliasNumber(participants: readonly SessionParticipant[]): number {
  const used = new Set(
    participants
      .filter((participant) => participant.kind === 'Anonymous')
      .map((participant) => Number(participant.alias.replace('Participant ', '')))
  );
  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

/**
 * Detaches participant data from hydrated SharedTree nodes before reinsertion.
 *
 * @remarks SharedTree rejects inserting a node that is already parented. JSON cloning is safe for
 * this intentionally serializable domain boundary and matches the document snapshot conversion.
 *
 * @param participants - Hydrated or plain participant collection.
 * @returns Plain participant records with no SharedTree parent bindings.
 */
function cloneParticipants(
  participants: readonly SessionParticipant[]
): readonly SessionParticipant[] {
  return JSON.parse(JSON.stringify(participants)) as readonly SessionParticipant[];
}
