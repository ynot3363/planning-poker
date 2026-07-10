import type {
  IPlanningPokerStorageConfiguration,
  ISharePointDrive,
  ISharePointList
} from './storageTypes';

/**
 * Normalizes modern and verbose SharePoint collection response shapes.
 *
 * @param value - The untrusted SharePoint response body.
 * @returns The collection items, or an empty array for a malformed response.
 */
export function normalizeCollection<T>(value: unknown): readonly T[] {
  if (Array.isArray(value)) {
    return value as readonly T[];
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  const candidate = value as { value?: unknown; d?: { results?: unknown } };
  if (Array.isArray(candidate.value)) {
    return candidate.value as readonly T[];
  }
  if (Array.isArray(candidate.d?.results)) {
    return candidate.d.results as readonly T[];
  }
  return [];
}

/**
 * Reads the continuation URL from modern and verbose SharePoint response shapes.
 *
 * @param value - The untrusted SharePoint response body.
 * @returns The next-page URL when one is present.
 */
export function normalizeNextLink(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const candidate = value as {
    '@odata.nextLink'?: unknown;
    'odata.nextLink'?: unknown;
    d?: { __next?: unknown };
  };
  const nextLink =
    candidate['@odata.nextLink'] ?? candidate['odata.nextLink'] ?? candidate.d?.__next;
  return typeof nextLink === 'string' && nextLink.length > 0 ? nextLink : undefined;
}

/**
 * Normalizes a URL for case-insensitive SharePoint library comparisons.
 *
 * @param value - The URL to normalize.
 * @returns The lower-case URL without one trailing slash.
 */
export function normalizeUrl(value: string): string {
  return value.replace(/\/$/, '').toLocaleLowerCase();
}

/**
 * Finds an ODSP drive using the strongest available SharePoint identifiers.
 *
 * @param drives - The available site drives.
 * @param list - The SharePoint document library to match.
 * @returns The matching drive, when available.
 */
export function findDrive(
  drives: readonly ISharePointDrive[],
  list: ISharePointList
): ISharePointDrive | undefined {
  const listId = list.Id.toLocaleLowerCase();
  const rootUrl = list.RootFolder?.ServerRelativeUrl;
  return (
    drives.find((drive) => drive.sharepointIds?.listId?.toLocaleLowerCase() === listId) ??
    drives.find((drive) => drive.name?.toLocaleLowerCase() === list.Title.toLocaleLowerCase()) ??
    drives.find(
      (drive) =>
        rootUrl !== undefined &&
        drive.webUrl !== undefined &&
        normalizeUrl(drive.webUrl).endsWith(normalizeUrl(rootUrl))
    )
  );
}

/**
 * Validates an untrusted persisted storage configuration at the application boundary.
 *
 * @param value - The property-bag value to inspect.
 * @returns `true` when all required configuration fields have the expected shape.
 */
export function isStorageConfiguration(
  value: unknown
): value is IPlanningPokerStorageConfiguration {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const config = value as Partial<IPlanningPokerStorageConfiguration>;
  return (
    typeof config.libraryTitle === 'string' &&
    config.libraryTitle.length > 0 &&
    typeof config.listId === 'string' &&
    config.listId.length > 0 &&
    typeof config.driveId === 'string' &&
    config.driveId.length > 0 &&
    typeof config.serverRelativeUrl === 'string' &&
    config.serverRelativeUrl.startsWith('/') &&
    typeof config.webAbsoluteUrl === 'string' &&
    /^https:\/\//i.test(config.webAbsoluteUrl) &&
    typeof config.provisioningVersion === 'string' &&
    typeof config.schemaVersion === 'string' &&
    typeof config.lastValidatedAt === 'string' &&
    typeof config.fieldMap === 'object' &&
    config.fieldMap !== null
  );
}
