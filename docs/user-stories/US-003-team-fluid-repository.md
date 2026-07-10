# US-003: Create and Load Team Fluid Documents Safely

## User Story

As a Planning Poker feature developer, I want a typed team repository so feature
screens can discover, create, load, and mutate collaborative team documents
without duplicating SharePoint or Fluid integration logic.

## Description

Build the service boundary over SharePoint metadata and the Fluid ODSP client.
Each team owns one `.fluid` file in `PlanningPokerAppData`; its file name is the
team title followed by `.fluid`. Metadata supports listing and selection, while
the validated SharedTree root owns authoritative team, story, and session state.

Before exposing any document, validate container/root availability, schema
identity, and supported version. Incompatible or corrupt content must produce a
specific recoverable UI error and must never be overwritten automatically.

## Public API

Expose typed operations equivalent to:

- `listHostedTeams(currentUser)` returning metadata summaries.
- `createTeamDocument(initialTeam)` returning team ID, drive item ID, and a
  connected repository handle.
- `loadTeamDocument(teamIdOrDriveItemId)` returning a validated typed snapshot
  and mutation interface.
- `renameTeamDocument(teamId, nextTitle)`.
- `updateTeamMetadata(teamSnapshot)`.
- `deleteTeamDocument(teamId)` for the later recycle-bin workflow.
- `subscribe(listener)` and idempotent `dispose()` methods for Fluid changes.
- Typed errors for not configured, not found, access denied, incompatible
  schema, corrupt document, duplicate/invalid title, disconnected, and save
  timeout states.

## Acceptance Criteria

- The repository consumes only the validated US-002 storage configuration.
- Creating a team initializes a detached container from the US-001 schema,
  attaches it as `<Team Title>.fluid`, and stamps all discovery metadata.
- Team titles are required, unique case-insensitively within the library, and
  rejected when they contain SharePoint-invalid file-name characters or reserved
  names; the UI receives a field-level error rather than an altered hidden slug.
- Renaming a team safely renames the `.fluid` file and updates `Title` metadata
  without changing the immutable team ID.
- Hosted-team discovery uses the Hosts metadata field and defensively verifies
  the current user against the loaded team before enabling host actions.
- A direct voting link may load a known team/session for an authenticated site
  user even when that team is absent from the hosted-team list.
- Loading checks the expected Fluid initial object, SharedTree schema identity,
  and supported schema version before returning feature state.
- Newer, incompatible, missing-root, and corrupt documents show distinct,
  actionable errors and are not reset, migrated, renamed, or deleted silently.
- Supported additive migrations are explicit, tested, transactionally applied,
  and update both root and metadata schema versions.
- Mutations use Fluid transactions, UI snapshots are plain serializable values,
  and subscriptions refresh React without exposing live tree nodes throughout
  the component hierarchy.
- The repository tracks connection, dirty, last-saved, and save-timeout state;
  local mutation success is not reported as durable save success until the
  container becomes clean.
- Metadata updates occur only for discovery fields and are not performed for
  every vote or timer tick.
- Every subscription, container listener, timer, and pending request is cleaned
  up idempotently.

## Tests

- Unit-test file-title validation, metadata mapping, snapshot conversion, error
  normalization, and hosted-team filtering.
- Service-test detached creation, attach, load, rename, metadata refresh,
  supported migration, save acknowledgement, disconnect, retry, and disposal
  using deterministic fakes.
- Test invalid initial-object keys, wrong schema identity, missing root, newer
  schema, malformed state, and failed migration without destructive recovery.
- Integration-smoke-test create, persist, refresh, and two-client synchronized
  mutation against an approved SharePoint test site when credentials are
  available; keep live-tenant tests outside the ordinary unit-test loop.

## Documentation and Examples

- Document the repository lifecycle, token audiences, metadata synchronization
  points, error taxonomy, and diagnostics available to support personnel.
- Add a sequence example for create/attach and load/validate/subscribe.

## Dependencies

- US-001 supplies the domain and SharedTree schema.
- US-002 supplies the library, field map, drive ID, and persisted configuration.
- The repository's supported Fluid packages and architecture document govern
  ODSP client and token-provider usage.

## Implementation Notes

- Use the SharePoint origin for storage tokens and the documented push-channel
  audience for websocket tokens.
- Prefer lookup by immutable Team ID metadata; use drive item ID when a trusted
  deep link already contains it.
- Validate and allow-list `https:` and approved SharePoint-relative story links
  at the boundary in later story mutations.
- Add diagnostics for team ID, item ID, drive ID, connection, dirty state, and
  last save without logging tokens or unnecessary personal data.
