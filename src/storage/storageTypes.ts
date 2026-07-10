import type { SharePointMetadataField } from '../domain/planningPokerDomain';

/** The dedicated SharePoint library title. */
export const PLANNING_POKER_LIBRARY_TITLE = 'PlanningPokerAppData';
/** The version of the provisioning contract used by this client. */
export const STORAGE_PROVISIONING_VERSION = '1.0.0';

/** Maps stable metadata display names to actual SharePoint internal names. */
export interface IStorageFieldMap {
  /** The resolved internal name for a metadata display name. */
  readonly [displayName: string]: string;
}

/** Defines the site-scoped storage configuration persisted by the web part. */
export interface IPlanningPokerStorageConfiguration {
  /** The SharePoint library title. */
  readonly libraryTitle: string;
  /** The SharePoint list GUID. */
  readonly listId: string;
  /** The ODSP drive identifier used by Fluid. */
  readonly driveId: string;
  /** The library root's server-relative URL. */
  readonly serverRelativeUrl: string;
  /** The HTTPS URL of the owning SharePoint web. */
  readonly webAbsoluteUrl: string;
  /** The provisioning contract version. */
  readonly provisioningVersion: string;
  /** The compatible Planning Poker document schema version. */
  readonly schemaVersion: string;
  /** The resolved metadata internal names. */
  readonly fieldMap: IStorageFieldMap;
  /** The ISO timestamp of the most recent SharePoint validation. */
  readonly lastValidatedAt: string;
}

/** Describes the result of validating persisted storage configuration. */
export interface IStorageValidationResult {
  /** Whether the saved configuration is currently usable. */
  readonly isValid: boolean;
  /** The refreshed configuration when validation succeeds. */
  readonly configuration?: IPlanningPokerStorageConfiguration;
  /** A non-sensitive explanation when validation fails. */
  readonly message?: string;
}

/** Defines explicit storage provisioning operations available to the UI. */
export interface IStorageProvisioningService {
  /** @returns Whether the current user has the SharePoint permission required to provision. */
  canProvision(): Promise<boolean>;
  /** @returns The configured storage after provisioning. @throws When authorization or provisioning fails. */
  provision(): Promise<IPlanningPokerStorageConfiguration>;
}

/** Defines read-only discovery and validation operations. */
export interface IStorageDiscoveryService {
  /** @returns Existing site configuration, when the storage library is present. */
  findConfiguration(): Promise<IPlanningPokerStorageConfiguration | undefined>;
  /** @param configuration - The untrusted persisted value. @returns Its current validation result. */
  validateConfiguration(configuration: unknown): Promise<IStorageValidationResult>;
}

/** Combines discovery and provisioning operations for Planning Poker storage. */
export interface IPlanningPokerStorageService
  extends IStorageProvisioningService,
    IStorageDiscoveryService {}

/** Represents the SharePoint list fields consumed by storage discovery. */
export interface ISharePointList {
  /** The SharePoint list GUID. */
  readonly Id: string;
  /** The SharePoint list title. */
  readonly Title: string;
  /** The optionally expanded library root folder. */
  readonly RootFolder?: { readonly ServerRelativeUrl?: string };
}

/** Represents a SharePoint metadata field returned by REST. */
export interface ISharePointField {
  /** The field display title. */
  readonly Title: string;
  /** The actual persisted internal name. */
  readonly InternalName: string;
}

/** Represents an ODSP drive returned by the SharePoint drives endpoint. */
export interface ISharePointDrive {
  /** The ODSP drive identifier. */
  readonly id: string;
  /** The optional drive display name. */
  readonly name?: string;
  /** The optional absolute drive URL. */
  readonly webUrl?: string;
  /** The optional identifiers that connect the drive to SharePoint. */
  readonly sharepointIds?: { readonly listId?: string };
}

/** Abstracts authenticated SharePoint JSON requests for service testing. */
export interface ISharePointTransport {
  /** @param path - A scoped endpoint or continuation URL. @returns The parsed JSON body. */
  get<T>(path: string): Promise<T>;
  /** @param path - A scoped endpoint. @param body - The optional request body. @returns The parsed response. */
  post<T>(path: string, body?: unknown): Promise<T>;
  /** @param path - A scoped entity endpoint. @param body - The update body. @returns The parsed response. */
  patch<T>(path: string, body: unknown): Promise<T>;
}

/** Defines site and deterministic dependencies for the storage service. */
export interface IStorageServiceOptions {
  /** The HTTPS URL of the current SharePoint web. */
  readonly webAbsoluteUrl: string;
  /** The lightweight metadata fields required for discovery. */
  readonly metadataFields: readonly SharePointMetadataField[];
  /** An injectable clock used for deterministic tests. */
  readonly now?: () => Date;
  /** An injectable bounded propagation delay. */
  readonly retryDelay?: (attempt: number) => Promise<void>;
}
