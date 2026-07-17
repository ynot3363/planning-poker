# Team Management

The Teams destination lists the current user's hosted Planning Poker teams from
SharePoint metadata, then validates the loaded Fluid team before enabling edit
operations. SharePoint library permissions remain the security boundary; the
host role controls application behavior only.

## Creating a Team

New Team opens a Fluent UI panel with the current SharePoint user selected as a
host. A valid team includes:

- a unique title that is also a valid SharePoint file name;
- at least one host;
- zero or more configured members;
- an active or inactive state;
- Fibonacci, T-shirt, or custom voting values;
- an optional timer from 1 through 60 whole minutes; and
- Named or Anonymous vote visibility.

The fixed Fibonacci values are `0`, `0.5`, `1`, `2`, `3`, `5`, and `8`. The
fixed T-shirt values are `XS`, `S`, `M`, `L`, `XL`, and `XXL`. A custom scale
might be `1`, `2`, `4`, and `8`; it must contain 2 through 20 ordered,
case-insensitively unique, non-empty values.

Configured members describe the expected roster. They do not prevent another
authenticated site user from joining a later session through its invitation
link.

Timer values are entered in minutes for team administration and converted to
seconds in the persisted Fluid settings used by synchronized voting rounds.

## Saving and Editing

Creation initializes a detached SharedTree document and attaches it as
`<Team Title>.fluid`. Edits mutate the Fluid document first. The workflow waits
for ODSP to acknowledge the mutation before renaming the file, when necessary,
and refreshing the SharePoint discovery fields.

SharePoint stores only the discovery projection: Title, Team ID, Hosts,
Participants, Is Active, Schema Version, Active Session ID, and Last Activity.
The Fluid document remains authoritative. A team listed through stale host
metadata cannot be edited unless the loaded Fluid host list also contains the
current stable identity.

The edit panel keeps a plain baseline snapshot only to render the draft and
detect conflicts. Saving runs a focused live-tree command. If another client
changed the team after that baseline, the command leaves current hosts,
configured members, settings, activity, and audit values untouched and asks the
user to reload. This prevents a stale form from restoring a removed host or
overwriting newer settings. The card-level Activate/Deactivate command owns
only `isActive`, so it preserves concurrent roster and settings work.

Inactive teams stay visible and editable, but later workflows must not start a
new voting session for them. Editing settings does not alter settings captured
by historical sessions.

## Deactivation and Deletion

Deactivate a team when it may be needed again. Deactivation changes the
reversible `isActive` setting, keeps the Fluid file and all team history in
place, and leaves the team visible to its hosts for editing and reactivation.

Delete a team only when its complete Planning Poker history should leave the
application. The confirmation names the team and explains that its stories,
votes, and session history move together because they live in the same Fluid
document. A non-empty open-session identifier blocks deletion until that voting
session is ended.

Confirmed deletion uses Microsoft Graph's drive-item delete operation, which
moves the `.fluid` file to the SharePoint site recycle bin rather than
permanently deleting it. A site administrator can restore the file only while
the tenant's recycle-bin retention policy keeps it. A restored file may require
metadata and storage-configuration validation before it appears in Planning
Poker again.

The UI and service verify the current host from authoritative Fluid state before
deletion. This host check controls application behavior; SharePoint library
permissions remain the security boundary, so the app does not claim that a
non-host with sufficient SharePoint access could not call the underlying APIs.

## Identity and People Search

People controls use SharePoint's native people-picker and `ensureuser`
endpoints. Persisted references retain the Entra object ID, claims login,
display name, and site-scoped SharePoint user ID. Display names and email text
are never used as authorization keys.

## Operational Errors

The screen gives non-sensitive recovery guidance for directory lookup,
duplicate titles, invalid settings, unavailable files, access denial,
incompatible documents, disconnected Fluid sessions, save timeouts, and
metadata synchronization failures. If the SharePoint index and Fluid hosts
disagree, reload the team or ask another current host to repair the host list.

ODSP uses a SharePoint-origin storage token and a
`https://pushchannel.1drv.ms` websocket token. When local changes appear but do
not persist, inspect the Fluid websocket and container dirty state before
assuming the tree mutation failed.

Graph-backed drive discovery, rename, and recycle operations require the SPFx
solution's delegated `Files.ReadWrite` permission to be approved by a tenant
administrator.
