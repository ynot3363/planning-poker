# Fluid Framework with SharePoint Architecture

This document describes a reusable architecture for building an SPFx application that uses the Fluid Framework for real-time collaboration while storing Fluid containers in a normal SharePoint Online document library.

The pattern is useful when you want a tenant-installable SharePoint app that:

- Runs inside SharePoint as an SPFx web part.
- Uses SharePoint permissions and document libraries for storage.
- Uses Fluid Framework for real-time synchronized application state.
- Avoids a separate custom backend for collaboration.

## High-Level Architecture

The architecture has two layers:

- SharePoint/ODSP storage and metadata.
- Fluid Framework collaborative state.

SharePoint stores the actual Fluid container files and any metadata needed to find, filter, secure, or summarize those files. Fluid stores the real-time application state inside each container.

A typical deployment looks like this:

```text
SPFx Web Part
  |
  |-- SharePoint REST
  |     |-- provision/find storage library
  |     |-- create metadata columns
  |     |-- resolve ODSP drive id
  |     |-- list .fluid files
  |     |-- update file/list-item metadata
  |
  |-- Fluid ODSP Client
        |-- create/load .fluid containers
        |-- connect to Fluid delta stream
        |-- synchronize SharedTree or DDS state
```

## Recommended Responsibilities

Use SharePoint for:

- Site-scoped storage.
- Library provisioning.
- Permission inheritance and role assignments.
- Metadata columns for discovery and indexing.
- Document/file lifecycle.
- Host app context, current user, theme, and page mode.

Use Fluid for:

- Real-time co-authoring.
- Local-first collaborative mutations.
- Presence-like shared application state.
- Conflict handling through Fluid operations.
- Typed app state via `SharedTree` or another distributed data structure.

Avoid using SharePoint JSON files as the live co-authoring target. SharePoint files are fine as persisted artifacts, but Fluid is the synchronization engine. Fluid containers stored in SharePoint/ODSP are the durable collaborative files.

## Runtime Flow

1. The SPFx web part renders the React app.
2. The web part passes SPFx services into React:
   - `aadTokenProviderFactory`
   - `spHttpClient`
   - current site URL
   - current user
   - page display mode
   - theme values
   - persisted storage configuration
3. The app checks whether a storage library and ODSP drive id are already configured.
4. If not configured, the app shows a storage configuration screen.
5. A user with sufficient permissions provisions or selects a document library.
6. The app resolves the library's ODSP drive id and stores it in web part properties or another site-scoped configuration location.
7. Creating a collaborative object creates a detached Fluid container, initializes its root data, and attaches it as a `.fluid` file in the library.
8. Opening an existing object loads the Fluid container by ODSP drive item id.
9. UI changes mutate Fluid state. React listens for Fluid changes and re-renders from a plain snapshot of the shared state.
10. SharePoint metadata is updated only for searchable/indexable summary fields, not for every live collaboration operation.

## Storage Library Pattern

A common approach is to create a dedicated hidden document library for application data.

Recommended library behavior:

- Create the library only through an explicit configuration step.
- Gate provisioning to SharePoint page edit mode or an admin-only experience.
- Store the library id, ODSP drive id, server-relative URL, and web URL after provisioning.
- Hide the library from normal SharePoint navigation if it is app infrastructure.
- Add metadata columns that allow the app to list relevant Fluid files without opening every container.
- Keep metadata lightweight and denormalized.

Example metadata columns:

- `Title`: display name for the collaborative object.
- `Owners`: people who can administer the object.
- `Members`: people expected to access the object.
- `Status`: active, draft, archived, etc.
- `LastActivity`: optional app-level activity timestamp.

The `.fluid` file is still the source of truth for collaborative state. SharePoint metadata is an index and access aid.

## Provisioning Flow

Recommended provisioning steps:

1. Find or create a document library with base template `101`.
2. Wait for the library root folder to become readable.
3. Resolve the ODSP drive id for the library.
4. Create any required metadata columns.
5. Break permission inheritance only if the app needs library-specific access.
6. Assign the minimum needed SharePoint permissions.
7. Optionally hide the library from normal SharePoint UI.
8. Persist the resolved storage configuration.

Persisted configuration should include:

- SharePoint list/library id.
- ODSP drive id.
- Library title.
- Library web URL.
- Library server-relative URL.

For SPFx web parts, the web part property bag is a practical place to persist this if the configuration is specific to that web part instance. If multiple web parts or pages should share the same storage, use a site property bag entry or a normal SharePoint list item instead.

## ODSP Drive Resolution

Fluid ODSP needs a drive id, not just a SharePoint list id.

Use the SPFx Microsoft Graph client for drive discovery. Resolve the current
site by its hostname and server-relative path, enumerate its document-library
drives, and match the configured SharePoint list:

```text
GET https://graph.microsoft.com/v1.0/sites/{hostname}:/{site-path}:/drives
```

The application must request the delegated Microsoft Graph `Files.ReadWrite`
permission through the SPFx solution manifest, and a tenant administrator must
approve it before Graph-backed drive discovery, rename, and recycle operations
can run.

Match by:

- `sharepointIds.listId`
- drive name
- normalized drive web URL
- normalized library root URL

Newly created libraries can take a short time to appear as Graph drives. Add retries before failing the provisioning flow. Resolve team files and attached-file `sharepointIds` through `/drives/{drive-id}` Graph endpoints; do not use SharePoint `_api/v2.1` endpoints.

## SharePoint REST Gotchas

SharePoint REST responses can use either modern JSON shapes or classic verbose OData shapes. Utility helpers should support both:

- `value`
- `d.results`
- `@odata.nextLink`
- `odata.nextLink`
- `d.__next`

Field creation can also be surprising. In some cases SharePoint ignores the requested internal name and derives the internal name from the display name. After creating a field, read it back and store/use the actual `InternalName`.

For person fields:

- Create multi-person fields with `UserMulti`.
- Use `ensureuser` to resolve people to numeric SharePoint user ids before writing person fields.
- With OData 4 requests, update multi-person fields through the
  `{InternalName}Id` field with a direct `number[]`. The classic verbose OData
  shape uses `{ results: number[] }`; do not mix the two JSON shapes.

## Fluid Container Model

Each collaborative object should map to one Fluid container.

For a SharedTree-based app, the container schema can look like:

```ts
const containerSchema = {
  initialObjects: {
    appTree: SharedTree
  }
} as const;
```

The app then creates a typed tree schema for its root state:

```ts
const schemaFactory = new SchemaFactory('contoso.app');

const AppRootSchema = schemaFactory.object('AppRoot', {
  schemaVersion: SchemaFactory.string,
  title: SchemaFactory.string,
  updatedAt: SchemaFactory.string
});
```

When creating a new object:

1. Create a detached ODSP container.
2. Get the `SharedTree` initial object.
3. Create a typed tree view.
4. Initialize the root node.
5. Attach the container as a `.fluid` file.
6. Store the returned drive item id.
7. Optionally stamp SharePoint metadata on the file's list item.

When loading:

1. Create the ODSP client with the configured drive id.
2. Load the container by item id.
3. Get the shared object.
4. Create a typed tree view.
5. Check compatibility.
6. Upgrade the stored schema whenever `canUpgrade` is true, even when `canView` is already true;
   a readable older schema may still reject writes to newly added optional fields.
7. Listen for tree changes.

## Fluid Mutation Pattern

For SharedTree, keep mutations inside transactions:

```ts
Tree.runTransaction(view, (root) => {
  root.title = nextTitle;
  root.updatedAt = new Date().toISOString();
});
```

Append new items through the SharedTree sequence insertion API. Do not rebuild a
sequence with a spread of existing hydrated tree nodes: those nodes already have
parents, and Fluid will reject their reinsertion. A plain-array fallback may be
used only inside isolated store tests.

Recommended UI pattern:

- Mutate Fluid state.
- Convert the shared tree to a plain serializable snapshot.
- Render React from that snapshot.
- Avoid rendering directly from Fluid nodes throughout the component tree.

This keeps React components simpler and makes export/debug behavior much easier.

### Command and Read-Model Separation

Plain snapshots returned by a team document handle are presentation read models.
They must never be edited into a complete replacement for `team`, `stories`, or
`sessions`. The public handle exposes intent-specific commands instead: a team
form edit or activity toggle, one story create/edit/transition/delete, one
atomic import batch, and the Lobby-to-Active transition.

Each command receives stable entity IDs, the minimum validated values, and any
observed version needed for conflict detection. Its synchronous SharedTree
transaction locates the current hydrated node, rechecks host, lifecycle,
open-round, and immutable-history rules, then patches only fields owned by that
action. Story creates and imports append detached schema values through the
sequence insertion API; they never spread hydrated nodes into a replacement
array.

Commands return a discriminated `applied`, `idempotent`, `conflict`, `stale`, or
`rejected` result. Services translate failures into non-sensitive recovery
guidance and wait for Fluid save acknowledgement before refreshing SharePoint
metadata. For example, an edit created from an older story `updatedAt` returns a
conflict if finalization changed that story in the meantime; it cannot restore
the older status, estimate, or history. A repeated create with the same stable
ID and creation fields is idempotent, while a different entity using that ID is
a conflict.

### Planning Poker Round Mutations

Active-story selection and vote upserts must use document-store transaction
commands rather than replacing a session assembled from a stale UI snapshot.
The transaction rechecks the open Active session, current round, participant or
host authority, story lifecycle, and immutable session scale before mutation.
Round selection captures story content and updates `activeRoundId` atomically;
votes are keyed by participant ID so changing a selection replaces one record.

React must use privacy-shaped selectors before reveal: the current participant
may see their own value, Named mode may show voted/not-voted state, and
Anonymous mode may show aggregate counts. Per-vote operations remain Fluid-only
and must not trigger SharePoint metadata writes. See
`docs/active-story-voting.md` for the complete feature contract.

Reveal, reopen, and finalization are separate transaction commands. Reveal
freezes the round, captures historical voted/missing counts, stops the timer,
and exposes only privacy-shaped results. Host-authorized reopen applies only to
the active Revealed round and preserves its votes and stopped timer. Finalization
atomically updates the round, source story, current estimate, immutable estimate
history, finalized-round index, and document Last Activity. A corrected final
estimate appends history without duplicating the finalized-round index. Refresh
SharePoint discovery metadata after the Fluid finalization is acknowledged; an
idempotent retry must not duplicate history.
See `docs/voting-results.md` for the result and assignment contract.

Ending an open session is another host-authorized transaction. It cancels an
unfinished round, records end audit fields, clears the active round and root
open-session pointer, and leaves finalized stories unchanged. Ended history is
read-only; exports derive only aggregate finalized-round summaries from captured
story snapshots. See `docs/session-completion.md`.

### Planning Poker Presence

Use Fluid Presence attendee state for session-lifetime participant bindings.
Presence publishes only opaque session and participant IDs plus Named/Anonymous
mode; it does not persist Microsoft 365 identity-to-alias mappings in
SharedTree. Service heartbeat/attendee-disconnect events keep Named roster
entries as Disconnected while excluding them from remaining-voter counts.
Anonymous attendee disconnect removes that roster entry and its active
unrevealed vote. Cache the latest attendee binding because the departing
attendee's remote state may no longer be readable when its disconnect event is
handled, and reconcile the open roster against connected Presence attendees
after Presence changes. Do not implement a parallel polling heartbeat.

## Required Libraries

For the Fluid + SharePoint ODSP pattern:

- `@fluidframework/odsp-client`
- `@fluidframework/tree`
- `@fluidframework/fluid-static`

Common imports:

```ts
import { OdspClient } from '@fluidframework/odsp-client/beta';
import { SchemaFactory, Tree, TreeViewConfiguration } from '@fluidframework/tree';
import { SharedTree } from '@fluidframework/tree/legacy';
```

For SPFx:

- `@microsoft/sp-core-library`
- `@microsoft/sp-webpart-base`
- `@microsoft/sp-http`
- `@microsoft/sp-property-pane`
- `@microsoft/sp-component-base`

For UI, SPFx 1.x solutions commonly use React 17 and Fluent UI v8. Fluent UI v9 may require extra compatibility validation depending on the SPFx version and build setup.

## ODSP Client Setup

The ODSP client needs:

- SharePoint site URL.
- ODSP drive id.
- File path, often blank when loading by item id or attaching by file name.
- Token provider.

Example shape:

```ts
const client = new OdspClient({
  connection: {
    siteUrl: webAbsoluteUrl,
    driveId,
    filePath: '',
    tokenProvider
  }
});
```

Attach example:

```ts
const itemId = await container.attach({
  fileName: `${slug}-${Date.now()}.fluid`,
  filePath: undefined
});
```

Load example:

```ts
const { container, services } = await client.getContainer(itemId, containerSchema, minFluidVersion);
```

## Token Model

ODSP Fluid needs two token paths:

- Storage token for SharePoint/ODSP file access.
- Websocket token for Fluid's delta stream.

In SPFx, the token provider can be created from:

```ts
const aadTokenProvider = await aadTokenProviderFactory.getTokenProvider();
```

Storage tokens should target the SharePoint origin:

```ts
const storageResource = new URL(webAbsoluteUrl).origin;
```

The websocket token commonly targets:

```ts
https://pushchannel.1drv.ms
```

Example token provider shape:

```ts
const getToken = async (resource: string, refresh: boolean) => ({
  token: await aadTokenProvider.getToken(resource, !refresh),
  fromCache: !refresh
});

const tokenProvider = {
  fetchStorageToken: async (_siteUrl: string, refresh: boolean) =>
    getToken(storageResource, refresh),
  fetchWebsocketToken: async (_siteUrl: string, refresh: boolean) =>
    getToken('https://pushchannel.1drv.ms', refresh)
};
```

## Token Gotcha

Storage tokens and websocket tokens fail independently.

It is possible for a Fluid container to be created or loaded successfully while the websocket connection fails later with:

```text
connect_document_error
Invalid token. Unable to validate token.
```

When this happens, local edits may appear in the UI, but the container can stay dirty and changes may not persist after refresh.

Symptoms:

- `container.isDirty` remains true.
- Save waits time out.
- Browser warns about unsaved changes on refresh.
- Changes appear locally but disappear after reload.
- Websocket frames show `Invalid token. Unable to validate token.`

When diagnosing "Fluid did not save" bugs, inspect the websocket traffic before assuming the SharedTree mutation code is wrong.

## Save and Connection Behavior

Fluid is local-first. A successful local mutation means the local tree changed. It does not guarantee that ODSP has acknowledged the operation.

Apps should track:

- Container connection state.
- Dirty state.
- Last saved time.
- Save timeout state.
- Token or websocket errors where possible.

A useful save helper waits for the container to become clean, reconnects if disconnected, and times out gracefully if the connection cannot flush operations.

## Permissions Model

There are usually two permission layers:

- SharePoint file/library permissions.
- Application-level roles stored in metadata or Fluid state.

SharePoint permissions decide who can read or write the `.fluid` file. Application-level roles decide who can see or use specific controls in the UI.

Do not treat UI-enforced roles or hidden buttons as a security boundary. If a user has write access to the Fluid file, assume they may be technically capable of manipulating stored collaborative data. Use SharePoint permissions for real access control.

## Metadata vs Fluid State

Store in SharePoint metadata:

- Data needed to find or filter files without opening them.
- Ownership/host/member summaries.
- Status fields.
- Last modified summaries.
- Lightweight display names.

Store in Fluid:

- Live collaborative state.
- Data that changes frequently during collaboration.
- Ordered collections.
- Votes, cursors, timers, session state, whiteboard state, document state, etc.

Avoid writing every collaborative mutation back into SharePoint metadata. That defeats much of the benefit of Fluid and increases throttling risk.

## Generic Smoke Test Checklist

1. Add the SPFx web part to a SharePoint page.
2. Run storage configuration as a user with library creation permissions.
3. Confirm the document library exists.
4. Confirm metadata columns exist.
5. Confirm the ODSP drive id was resolved and persisted.
6. Create a new Fluid object.
7. Confirm a `.fluid` file appears in the library.
8. Update app state.
9. Wait for the container to become clean.
10. Refresh and confirm state persists.
11. Open the same object in two browser sessions.
12. Confirm real-time updates flow between sessions.
13. Disconnect/reconnect or refresh one session and confirm state recovers.
14. Inspect websocket traffic if state does not persist.

## Common Failure Modes

- Library exists but ODSP drive id is not available yet.
- Direct list-drive endpoint returns `apiNotFound`.
- Field internal names differ from requested names.
- User/person fields fail because people were not resolved with `ensureuser`.
- Users can read the page but cannot write the storage library.
- Storage token works but websocket token fails.
- Container remains dirty and local edits vanish after reload.
- Schema compatibility fails after a breaking tree schema change.

## Production Hardening Recommendations

- Add a diagnostics panel for connection state, dirty state, drive id, item id, and last save result.
- Keep provisioning explicit and permission-gated.
- Persist configuration once and avoid re-running setup for normal users.
- Add retry logic around newly created libraries and drive discovery.
- Treat SharePoint metadata as an index, not the live collaboration model.
- Version SharedTree schemas intentionally.
- Prefer additive schema changes where possible.
- Show users when edits are still syncing.
- Review library permissions with tenant/security owners before rollout.
- Add automated tests for snapshot conversion, imports/exports, and permission-independent business logic.
