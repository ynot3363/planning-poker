import { CURRENT_SCHEMA_VERSION, SHAREPOINT_METADATA_FIELDS } from '../domain/planningPokerDomain';
import { PLANNING_POKER_LIBRARY_TITLE, STORAGE_PROVISIONING_VERSION } from './storageTypes';
import type {
  IPlanningPokerStorageConfiguration,
  IPlanningPokerStorageService,
  ISharePointDrive,
  ISharePointField,
  ISharePointList,
  ISharePointTransport,
  IStorageServiceOptions,
  IStorageValidationResult
} from './storageTypes';
import {
  findDrive,
  isStorageConfiguration,
  normalizeCollection,
  normalizeNextLink
} from './storageUtils';

const LISTS_PATH =
  '_api/web/lists?$select=Id,Title,RootFolder/ServerRelativeUrl&$expand=RootFolder';
const MANAGE_LISTS_PERMISSION_MASK = 0x00000800;

/** Provisions and discovers the site-scoped SharePoint storage used by Planning Poker. */
export class PlanningPokerStorageService implements IPlanningPokerStorageService {
  private readonly now: () => Date;
  private readonly retryDelay: (attempt: number) => Promise<void>;

  /**
   * Creates a storage service with explicit SharePoint transport dependencies.
   *
   * @param transport - The authenticated, site-scoped SharePoint transport.
   * @param options - Site URL, metadata fields, clock, and retry dependencies.
   */
  public constructor(
    private readonly transport: ISharePointTransport,
    private readonly options: IStorageServiceOptions
  ) {
    this.now = options.now ?? (() => new Date());
    this.retryDelay =
      options.retryDelay ??
      ((attempt) => new Promise((resolve) => window.setTimeout(resolve, (attempt + 1) * 250)));
  }

  /**
   * Checks whether SharePoint reports the Manage Lists permission required for provisioning.
   *
   * @returns `true` only when the current user's effective permission mask includes Manage Lists.
   */
  public async canProvision(): Promise<boolean> {
    const response = await this.transport.get<unknown>('_api/web/effectiveBasePermissions');
    const permissions = this.parseEffectivePermissions(response);
    return permissions !== undefined && (permissions.low & MANAGE_LISTS_PERMISSION_MASK) !== 0;
  }

  /**
   * Discovers an existing Planning Poker library without creating site resources.
   *
   * @returns A fresh configuration when the library exists.
   */
  public async findConfiguration(): Promise<IPlanningPokerStorageConfiguration | undefined> {
    const list = await this.findLibrary();
    return list === undefined ? undefined : this.createConfiguration(list);
  }

  /**
   * Revalidates a property-bag configuration against the current site and schema.
   *
   * @param configuration - The untrusted persisted property value.
   * @returns A non-sensitive validation result and refreshed configuration when valid.
   */
  public async validateConfiguration(configuration: unknown): Promise<IStorageValidationResult> {
    if (!isStorageConfiguration(configuration)) {
      return { isValid: false, message: 'Saved storage settings are incomplete.' };
    }
    if (
      configuration.webAbsoluteUrl !== this.options.webAbsoluteUrl ||
      configuration.schemaVersion !== CURRENT_SCHEMA_VERSION
    ) {
      return {
        isValid: false,
        message: 'Saved storage settings are incompatible with this site or schema.'
      };
    }
    try {
      const list = await this.getList(configuration.listId);
      const result = await this.createConfiguration(list);
      if (result.driveId !== configuration.driveId) {
        return { isValid: false, message: 'The configured ODSP drive is no longer available.' };
      }
      return { isValid: true, configuration: result };
    } catch {
      return { isValid: false, message: 'The configured Planning Poker library is unavailable.' };
    }
  }

  /**
   * Creates or repairs the hidden storage library after rechecking SharePoint permissions.
   *
   * @returns The newly validated storage configuration.
   * @throws Throws when authorization is insufficient or SharePoint provisioning fails.
   */
  public async provision(): Promise<IPlanningPokerStorageConfiguration> {
    if (!(await this.canProvision())) {
      throw new Error(
        'You need site list-management permission to configure Planning Poker storage.'
      );
    }
    const discoveredList = (await this.findLibrary()) ?? (await this.createLibrary());
    const list = await this.waitForLibraryRoot(discoveredList);
    await this.ensureFields(list);
    const configuration = await this.createConfiguration(list);
    await this.hideLibrary(list);
    return configuration;
  }

  /**
   * Finds the dedicated library across every paged SharePoint response.
   *
   * @returns The existing library, when present.
   */
  private async findLibrary(): Promise<ISharePointList | undefined> {
    const lists = await this.getPagedCollection<ISharePointList>(LISTS_PATH);
    return lists.find((list) => list.Title === PLANNING_POKER_LIBRARY_TITLE);
  }

  /**
   * Loads one library by its validated configuration identifier.
   *
   * @param id - The SharePoint list GUID.
   * @returns The matching SharePoint list.
   */
  private async getList(id: string): Promise<ISharePointList> {
    return this.transport.get<ISharePointList>(
      `${this.getListPath(id)}?$select=Id,Title,RootFolder/ServerRelativeUrl&$expand=RootFolder`
    );
  }

  /**
   * Creates the hidden-infrastructure document library.
   *
   * @returns The created SharePoint list.
   */
  private async createLibrary(): Promise<ISharePointList> {
    return this.transport.post<ISharePointList>('_api/web/lists', {
      BaseTemplate: 101,
      Title: PLANNING_POKER_LIBRARY_TITLE,
      Description:
        'Planning Poker application data. Hidden infrastructure, not a security boundary.',
      AllowContentTypes: false
    });
  }

  /**
   * Waits until SharePoint returns the newly created library's root folder.
   *
   * @param list - The discovered or newly created library.
   * @returns The hydrated library with a readable root folder.
   * @throws Throws when the root folder remains unavailable after bounded retries.
   */
  private async waitForLibraryRoot(list: ISharePointList): Promise<ISharePointList> {
    if (list.RootFolder?.ServerRelativeUrl !== undefined) {
      return list;
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const hydratedList = await this.getList(list.Id);
        if (hydratedList.RootFolder?.ServerRelativeUrl !== undefined) {
          return hydratedList;
        }
      } catch {
        // A new library can be temporarily unreadable while SharePoint finishes provisioning it.
      }
      await this.retryDelay(attempt);
    }
    throw new Error('The Planning Poker library root folder was not available after provisioning.');
  }

  /**
   * Creates missing discovery fields while preserving existing internal names.
   *
   * @param list - The storage library to repair.
   * @returns A promise that resolves after all required fields exist.
   */
  private async ensureFields(list: ISharePointList): Promise<void> {
    const path = `${this.getListPath(list.Id)}/fields`;
    const existing = await this.getPagedCollection<ISharePointField>(
      `${path}?$select=Title,InternalName`
    );
    for (const field of this.options.metadataFields) {
      if (!existing.some((candidate) => candidate.Title === field.displayName)) {
        await this.transport.post<ISharePointField>(
          path,
          this.createFieldBody(field.displayName, field.type)
        );
      }
    }
  }

  /**
   * Creates a SharePoint REST body for a supported metadata field type.
   *
   * @param displayName - The field title shown by SharePoint.
   * @param type - The supported metadata type.
   * @returns The SharePoint REST field definition.
   */
  private createFieldBody(displayName: string, type: string): object {
    if (type === 'UserMulti') {
      return {
        '@odata.type': '#SP.FieldUser',
        Title: displayName,
        FieldTypeKind: 20,
        AllowMultipleValues: true
      };
    }
    return {
      Title: displayName,
      FieldTypeKind: type === 'Boolean' ? 8 : type === 'DateTime' ? 4 : 2
    };
  }

  /**
   * Removes the infrastructure library from normal site navigation.
   *
   * @param list - The storage library to hide.
   * @returns A promise that resolves when SharePoint acknowledges the update.
   */
  private async hideLibrary(list: ISharePointList): Promise<void> {
    await this.transport.patch(this.getListPath(list.Id), {
      Hidden: true,
      OnQuickLaunch: false
    });
  }

  /**
   * Builds a refreshed configuration from validated SharePoint resources.
   *
   * @param list - The storage library.
   * @returns The complete configuration persisted by the web part.
   * @throws Throws when a required field, folder, or ODSP drive is missing.
   */
  private async createConfiguration(
    list: ISharePointList
  ): Promise<IPlanningPokerStorageConfiguration> {
    const fields = await this.getPagedCollection<ISharePointField>(
      `${this.getListPath(list.Id)}/fields?$select=Title,InternalName`
    );
    const fieldMap: Record<string, string> = {};
    for (const field of SHAREPOINT_METADATA_FIELDS) {
      const persistedField = fields.find((candidate) => candidate.Title === field.displayName);
      if (persistedField === undefined) {
        throw new Error(`Required metadata field ${field.displayName} is missing.`);
      }
      fieldMap[field.displayName] = persistedField.InternalName;
    }
    const drive = await this.resolveDrive(list);
    const serverRelativeUrl = list.RootFolder?.ServerRelativeUrl;
    if (serverRelativeUrl === undefined) {
      throw new Error('The Planning Poker library root folder is unavailable.');
    }
    return {
      libraryTitle: list.Title,
      listId: list.Id,
      driveId: drive.id,
      serverRelativeUrl,
      webAbsoluteUrl: this.options.webAbsoluteUrl,
      provisioningVersion: STORAGE_PROVISIONING_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      fieldMap,
      lastValidatedAt: this.now().toISOString()
    };
  }

  /**
   * Resolves the library's ODSP drive with bounded retries for propagation delay.
   *
   * @param list - The SharePoint library whose drive is required.
   * @returns The matching ODSP drive.
   * @throws Throws when the drive remains unavailable after the retry budget.
   */
  private async resolveDrive(list: ISharePointList): Promise<ISharePointDrive> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const drives = await this.getPagedCollection<ISharePointDrive>(
        '_api/v2.1/drives?$select=id,name,webUrl,sharepointIds'
      );
      const drive = findDrive(drives, list);
      if (drive !== undefined) {
        return drive;
      }
      await this.retryDelay(attempt);
    }
    throw new Error('The Planning Poker ODSP drive was not available after provisioning.');
  }

  /**
   * Follows bounded same-origin SharePoint continuation links.
   *
   * @param initialPath - The first collection endpoint.
   * @returns All normalized items across the response pages.
   * @throws Throws when SharePoint returns more than the defensive page limit.
   */
  private async getPagedCollection<T>(initialPath: string): Promise<readonly T[]> {
    const items: T[] = [];
    let nextPath: string | undefined = initialPath;
    for (let page = 0; nextPath !== undefined && page < 100; page += 1) {
      const response = await this.transport.get<unknown>(nextPath);
      items.push(...normalizeCollection<T>(response));
      nextPath = normalizeNextLink(response);
    }
    if (nextPath !== undefined) {
      throw new Error('SharePoint returned too many collection pages.');
    }
    return items;
  }

  /**
   * Narrows the modern and verbose effective-permissions response shapes.
   *
   * @param value - The untrusted SharePoint response body.
   * @returns The numeric low permission mask, or `undefined` for malformed data.
   */
  private parseEffectivePermissions(value: unknown): { readonly low: number } | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const response = value as {
      High?: unknown;
      Low?: unknown;
      d?: { EffectiveBasePermissions?: { High?: unknown; Low?: unknown } };
    };
    const permissionValue = response.d?.EffectiveBasePermissions ?? response;
    const low =
      typeof permissionValue.Low === 'number'
        ? permissionValue.Low
        : typeof permissionValue.Low === 'string'
          ? Number(permissionValue.Low)
          : Number.NaN;
    return Number.isFinite(low) ? { low } : undefined;
  }

  /**
   * Builds an OData 4 list entity path from a SharePoint list identifier.
   *
   * @param listId - The SharePoint list GUID.
   * @returns The encoded list entity path using OData 4 literal syntax.
   */
  private getListPath(listId: string): string {
    return `_api/web/lists('${encodeURIComponent(listId)}')`;
  }
}
