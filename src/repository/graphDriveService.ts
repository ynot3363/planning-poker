import type { MSGraphClientV3 } from '@microsoft/sp-http';
import type { ISharePointDrive } from '../storage/storageTypes';

/** Minimal Graph drive-item shape required by team discovery and metadata synchronization. */
export interface IGraphDriveItem {
  readonly id?: unknown;
  readonly listItem?: { readonly id?: unknown };
  readonly sharepointIds?: { readonly listItemId?: unknown };
}

/** Result of moving a drive item into the SharePoint recycle bin. */
export interface IRecycleDriveItemResult {
  /** Recycle-bin identifier when the backing API supplies one. */
  readonly recycleBinItemId?: string;
}

/** Defines the Microsoft Graph drive mutations used by Planning Poker. */
export interface IPlanningPokerDriveService {
  /**
   * Lists the document-library drives belonging to one SharePoint site.
   *
   * @param webAbsoluteUrl - Absolute URL of the current SharePoint web.
   * @returns Every drive returned across Graph continuation pages.
   */
  listSiteDrives(webAbsoluteUrl: string): Promise<readonly ISharePointDrive[]>;
  /**
   * Gets a known document-library drive directly, including hidden libraries.
   *
   * @param driveId - Persisted SharePoint document-library drive ID.
   * @returns The requested Graph drive projection.
   */
  getDrive(driveId: string): Promise<ISharePointDrive>;
  /**
   * Resolves one item from its path relative to the configured drive root.
   *
   * @param driveId - Configured SharePoint document-library drive ID.
   * @param fileName - File name relative to the drive root.
   * @returns The requested Graph drive-item projection.
   */
  getByPath(driveId: string, fileName: string): Promise<IGraphDriveItem>;
  /**
   * Resolves one item from its immutable drive-item identifier.
   *
   * @param driveId - Configured SharePoint document-library drive ID.
   * @param driveItemId - ODSP drive item ID.
   * @returns The requested Graph drive-item projection.
   */
  get(driveId: string, driveItemId: string): Promise<IGraphDriveItem>;
  /**
   * Renames one drive item without changing its immutable item identifier.
   *
   * @param driveId - Configured SharePoint document-library drive ID.
   * @param driveItemId - ODSP drive item ID returned by Fluid attachment or discovery.
   * @param fileName - Validated next file name including the `.fluid` extension.
   * @returns A promise that resolves when Graph acknowledges the rename.
   */
  rename(driveId: string, driveItemId: string, fileName: string): Promise<void>;
  /**
   * Moves one drive item to the SharePoint recycle bin.
   *
   * @param driveId - Configured SharePoint document-library drive ID.
   * @param driveItemId - ODSP drive item ID.
   * @returns The optional recycle-bin identifier supplied by the backing API.
   */
  recycle(driveId: string, driveItemId: string): Promise<IRecycleDriveItemResult>;
}

/** Uses SPFx's authenticated Microsoft Graph v3 client for drive discovery and mutations. */
export class GraphDriveService implements IPlanningPokerDriveService {
  /** @param client - SPFx-provided Microsoft Graph v3 client. */
  public constructor(private readonly client: MSGraphClientV3) {}

  /** @inheritdoc */
  public async listSiteDrives(webAbsoluteUrl: string): Promise<readonly ISharePointDrive[]> {
    const webUrl = new URL(webAbsoluteUrl);
    const sitePath = webUrl.pathname === '/' ? '' : webUrl.pathname.replace(/\/$/, '');
    const initialPath =
      sitePath.length === 0
        ? `/sites/${webUrl.hostname}/drives`
        : `/sites/${webUrl.hostname}:${sitePath}:/drives`;
    const drives: ISharePointDrive[] = [];
    let nextPath: string | undefined = initialPath;
    for (let page = 0; nextPath !== undefined && page < 100; page += 1) {
      const request = this.client.api(nextPath);
      const pageRequest =
        page === 0
          ? request.version('v1.0').select('id,name,webUrl,sharepointIds,system')
          : request;
      const response = (await pageRequest.get()) as {
        readonly value?: unknown;
        readonly '@odata.nextLink'?: unknown;
      };
      if (Array.isArray(response.value)) {
        drives.push(...(response.value as ISharePointDrive[]));
      }
      nextPath =
        typeof response['@odata.nextLink'] === 'string' ? response['@odata.nextLink'] : undefined;
    }
    if (nextPath !== undefined) {
      throw new Error('Microsoft Graph returned too many drive pages.');
    }
    return drives;
  }

  /** @inheritdoc */
  public async getByPath(driveId: string, fileName: string): Promise<IGraphDriveItem> {
    return this.client
      .api(`/drives/${encodeURIComponent(driveId)}/root:/${encodeURIComponent(fileName)}`)
      .version('v1.0')
      .select('id,sharepointIds')
      .get() as Promise<IGraphDriveItem>;
  }

  /** @inheritdoc */
  public async getDrive(driveId: string): Promise<ISharePointDrive> {
    return this.client
      .api(`/drives/${encodeURIComponent(driveId)}`)
      .version('v1.0')
      .select('id,name,webUrl,sharepointIds,system')
      .get() as Promise<ISharePointDrive>;
  }

  /** @inheritdoc */
  public async get(driveId: string, driveItemId: string): Promise<IGraphDriveItem> {
    return this.request(driveId, driveItemId)
      .select('id,sharepointIds')
      .get() as Promise<IGraphDriveItem>;
  }

  /** @inheritdoc */
  public async rename(driveId: string, driveItemId: string, fileName: string): Promise<void> {
    await this.request(driveId, driveItemId).patch({ name: fileName });
  }

  /** @inheritdoc */
  public async recycle(driveId: string, driveItemId: string): Promise<IRecycleDriveItemResult> {
    const response = (await this.request(driveId, driveItemId).delete()) as unknown;
    if (typeof response === 'object' && response !== null && 'id' in response) {
      const id = (response as { readonly id?: unknown }).id;
      if (typeof id === 'string' && id.trim().length > 0) {
        return { recycleBinItemId: id.trim() };
      }
    }
    return {};
  }

  /**
   * @param driveId - Configured drive ID.
   * @param driveItemId - Target drive item ID.
   * @returns A Graph v1.0 request for the target item.
   */
  private request(driveId: string, driveItemId: string): ReturnType<MSGraphClientV3['api']> {
    return this.client
      .api(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(driveItemId)}`)
      .version('v1.0');
  }
}
