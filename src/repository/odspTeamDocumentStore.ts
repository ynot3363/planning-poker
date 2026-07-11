import type { IFluidContainer } from '@fluidframework/fluid-static';
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
  UserReference,
  VotingSession
} from '../domain/planningPokerDomain';
import { PlanningPokerDocumentRootSchema } from '../domain/planningPokerSchema';
import type {
  IPlanningPokerStorageConfiguration,
  ISharePointTransport
} from '../storage/storageTypes';
import type { IGraphDriveItem, IPlanningPokerDriveService } from './graphDriveService';
import { TeamRepositoryError, projectTeamMetadata } from './teamRepository';
import type { HostedTeamSummary, ITeamDocumentStore, TeamDocumentHandle } from './teamRepository';

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
  readonly driveItemId?: string;
}

interface ITreeRootView {
  readonly compatibility: {
    readonly canInitialize: boolean;
    readonly canView: boolean;
  };
  root: unknown;
  initialize(content: unknown): void;
  dispose(): void;
}

interface IMutableDocumentRoot {
  team: PlanningPokerTeam;
  stories: readonly PointingStory[];
  sessions: readonly VotingSession[];
  openSessionId?: string;
  updatedAt: string;
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
          document.sessions = [...document.sessions, session];
          document.openSessionId = session.id;
          document.updatedAt = updatedAt;
        });
        return selectedSessionId;
      },
      waitForSaved: () => this.waitForSaved(container),
      subscribe: (listener) => {
        const root = untypedView.root as TreeNode;
        let isSubscribed = true;
        const unsubscribe = Tree.on(root, 'treeChanged', listener);
        container.on('connected', listener);
        container.on('disconnected', listener);
        return (): void => {
          if (isSubscribed) {
            isSubscribed = false;
            unsubscribe();
            container.off('connected', listener);
            container.off('disconnected', listener);
          }
        };
      },
      dispose: () => {
        if (!isDisposed) {
          isDisposed = true;
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
    const response = await this.transport.get<unknown>(
      `${this.listPath()}/items?$select=Id,Title,File/Name,${this.field('Team ID')},${this.field(
        'Is Active'
      )},${this.field('Active Session ID')},${hostField}/Id&$expand=File,${hostField}`
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
