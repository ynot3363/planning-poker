# US-002: Provision PlanningPokerAppData Storage

## User Story

As a SharePoint site owner, I want to configure the Planning Poker data library so
the web part has a predictable hidden storage location and reusable ODSP
configuration.

## Description

At initialization, discover a site library titled `PlanningPokerAppData`. If it is
missing or its saved configuration is invalid, render a dedicated configuration
experience instead of the application. Provisioning is explicit and available
only when SharePoint reports that the current user can create/manage lists.

Provision a hidden document library, the metadata from US-001, and library-level
permissions that preserve higher roles while granting every SharePoint group
with a site-level role at least Contribute on the library. This deliberately
means host-only behavior is not enforced by SharePoint permissions.

Resolve the ODSP drive by enumerating site drives and persist all reusable
identifiers in the web part property bag. Never depend only on a library title
or a direct list-drive endpoint.

## Public API

Expose typed contracts equivalent to:

- `IPlanningPokerStorageConfiguration` with library title, list ID, ODSP drive ID,
  server-relative URL, absolute web URL, schema/provisioning version, and last
  validated timestamp.
- `IStorageDiscoveryService.findConfiguration()`.
- `IStorageProvisioningService.canProvision()`.
- `IStorageProvisioningService.provision()`.
- `IStorageProvisioningService.validateConfiguration(configuration)`.
- A typed field map containing each metadata display name and actual internal
  name returned by SharePoint.
- Web part properties that persist the complete storage configuration and can
  safely read older or incomplete property values.

## Acceptance Criteria

- `onInit()` validates saved storage configuration and tries to discover the
  well-known library before rendering the main React application.
- A valid `PlanningPokerAppData` library is reused; initialization never creates a
  second library automatically.
- When the library is missing, the web part shows an accessible configuration
  screen explaining why storage is required.
- The create button is disabled when the current user lacks SharePoint's
  list-management permission, and the screen states that someone with Edit
  permissions to the site must configure the web part.
- Permission capability comes from SharePoint base permissions at the time of
  provisioning, not page mode, group names, or a client-maintained role.
- Provisioning creates a document library with base template `101`, waits until
  its root folder is readable, and hides it from normal navigation and library
  UI entry points supported by SharePoint.
- Metadata columns match US-001. Field creation supplies display name and type
  only, never a requested internal/static name, and reads back the actual
  `InternalName` used for later updates.
- Provisioning breaks library permission inheritance while copying existing
  assignments, enumerates SharePoint groups with site-level roles, grants any
  group below Contribute the Contribute role on the library, and never lowers a
  stronger existing assignment.
- The implementation documents that hiding the library is discoverability
  reduction, not security.
- ODSP resolution enumerates the site's v2 drive collection, matches by list ID
  with URL/name fallbacks, and uses bounded retry for propagation delay.
- Successful provisioning persists list ID, drive ID, title, server-relative
  URL, absolute web URL, provisioning version, and field mapping in the web
  part's property bag before entering the application.
- Missing, deleted, moved, inaccessible, or incompatible saved configuration
  returns to the configuration experience with a useful non-sensitive error.
- Partial provisioning can be retried idempotently without creating duplicate
  libraries, fields, or role assignments.

## Tests

- Unit-test modern and verbose SharePoint response normalization, paging, and
  drive matching.
- Test permission checks for allowed, denied, and failed responses.
- Test existing-library reuse and idempotent recovery after failures at library,
  field, permission, drive, and property-save stages.
- Test actual internal-name capture when SharePoint encodes or changes a field
  name.
- Test that stronger permissions are preserved and lower group permissions are
  upgraded without duplicate role assignments.
- Component-test configuration loading, unauthorized, provisioning, retry,
  success, and error states with keyboard and accessible status announcements.

## Documentation and Examples

- Document required site permission, created library settings, fields, role
  changes, property-bag values, and recovery steps.
- Include an operational note explaining the accepted security-through-obscurity
  posture and how administrators can locate the hidden library if recovery is
  required.

## Dependencies

- US-001 defines metadata and schema/provisioning versions.
- `docs/architecture.md` defines provisioning, ODSP discovery, and response
  normalization patterns.
- SPFx `SPHttpClient`, page context, property APIs, and ODSP-compatible token
  acquisition are required.

## Implementation Notes

- Keep provisioning in a SharePoint service; React must not build REST URLs.
- Match drives by `sharepointIds.listId` first, then normalized URL or name.
- Treat the well-known title as discovery input but persist immutable IDs after
  discovery.
- Do not place tokens, personal data, or secrets in web part properties.
