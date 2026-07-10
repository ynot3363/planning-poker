# US-001: Define the Domain Data Model and SharedTree Schema

## User Story

As a Planning Poker development team, we want a versioned domain and persistence
model so we can implement every team, story, and voting workflow against one
coherent collaborative contract.

## Description

Define the canonical typed model for the `PlanningPokerWebPart` before feature
implementation begins. The model must separate searchable SharePoint metadata
from live Fluid state, support one Fluid document per team, preserve story and
session history, and prevent anonymous sessions from recording authenticated
identity mappings.

The deliverable includes the TypeScript domain contracts, SharedTree schema,
schema-version policy, transition rules, example valid documents, and a data
model document. SharePoint metadata is a denormalized discovery index; the Fluid
root is the source of truth.

This model operates under the accepted application-security constraint: site
groups receive Contribute access to the library. Host checks and hidden UI do
not prevent a technically capable contributor from altering compatible data.
Schema validation protects compatibility and detects corruption, but is not an
authorization or tamper-detection mechanism.

## Public API

Define exported domain contracts equivalent to the following concepts without
requiring these exact file names:

- `SchemaVersion`: a persisted version identifier with an explicit supported
  range and additive migration policy.
- `StoryStatus`: `Ready | Pointed | Archived`.
- `TeamScaleKind`: `Fibonacci | TShirt | Custom`.
- `VotingMode`: `Named | Anonymous`.
- `VotingSessionStatus`: `Lobby | Active | Ended`.
- `VotingRoundStatus`: `Voting | Revealed | Finalized | Cancelled`.
- `TimerStatus`: `Ready | Running | Stopped`.
- `UserReference`: Entra object ID, display name, email/login identifier, and
  optional SharePoint user ID required for person-field updates.
- `TeamSettings`:
  - ordered scale kind and values;
  - timer enabled flag and duration in seconds;
  - named or anonymous voting mode.
- `PlanningPokerTeam`:
  - immutable team ID;
  - title and description;
  - `isActive`;
  - hosts and configured members;
  - settings;
  - created/updated audit fields.
- `PointingStory`:
  - immutable story ID;
  - title, description, optional validated link, and status;
  - Added By and Added On;
  - updated audit fields;
  - optional current estimate;
  - immutable estimate history referencing session and round IDs.
- `VotingSession`:
  - immutable session ID and team ID;
  - Lobby, Active, or Ended status and audit timestamps;
  - snapshot of voting mode, scale, and timer configuration;
  - joined participants;
  - active story/round ID;
  - ordered finalized story results.
- `NamedSessionParticipant`: participant ID plus `UserReference`, join time, and
  current connection/presence state.
- `AnonymousSessionParticipant`: participant ID, generated `Participant N`
  alias, join time, and current connection/presence state with no Entra object
  ID, email, display name, SharePoint user ID, or reversible identity mapping.
- `StoryVotingRound`:
  - immutable round ID and story ID;
  - story snapshot needed for session history/export;
  - Voting, Revealed, Finalized, or Cancelled status;
  - votes keyed only by session participant ID;
  - reveal audit fields;
  - optional scale-valid assigned value and finalization audit fields.
- `VotingTimer`: configured duration, status, authoritative start/stop/reset
  timestamps, and enough state for clients to calculate a consistent remaining
  duration without per-second persisted writes.
- `PlanningPokerDocumentRoot`: schema version, team, stories, sessions, optional
  open session ID, and document audit fields.

Use string representations for scale values so numeric Fibonacci values,
T-shirt labels, and custom labels share one lossless contract. Define these
built-in ordered sets:

- Fibonacci: `0`, `0.5`, `1`, `2`, `3`, `5`, `8`.
- T-shirt: `XS`, `S`, `M`, `L`, `XL`, `XXL`.

Define SharePoint metadata contracts for the built-in `Title` field and these
additional display-name-defined columns:

| Display name | Type | Purpose |
| --- | --- | --- |
| Team ID | Single line of text | Stable lookup key independent of title changes. |
| Hosts | Person or Group, multiple | Discover teams hosted by the current user. |
| Participants | Person or Group, multiple | Denormalized configured member roster. |
| Is Active | Yes/No | Filter inactive teams without opening each Fluid file. |
| Schema Version | Single line of text | Reject unsupported documents before loading feature UI. |
| Active Session ID | Single line of text | Resolve the current Lobby or Active session for deep links. |
| Last Activity | Date and Time | Sort team documents by meaningful application activity. |

Column provisioning must specify the display name and type but not a requested
internal name or static name. Read each created field back and retain its actual
`InternalName` for updates.

## Acceptance Criteria

- A data-model document contains an entity relationship diagram or equivalent
  mapping for team, story, session, participant, round, vote, timer, and
  estimate-history ownership.
- Typed contracts and SharedTree schema definitions cover every public concept
  listed above without `any` or loosely related boolean state combinations.
- One `PlanningPokerDocumentRoot` represents one team and all of its stories and
  voting-session history.
- The model permits at most one session with Lobby or Active status per team and
  at most one Voting or Revealed round in that session.
- Ready stories may enter voting; Pointed and Archived stories may not.
- Finalizing a round records the assigned value and session ID, appends estimate
  history, and changes the story to Pointed.
- Cancelling an unfinished round retains an audit record but assigns no estimate
  and leaves the story Ready.
- Returning a Pointed story to Ready retains its estimate history and removes it
  from automatic eligibility only while it remains Pointed.
- Archiving retains story and estimate history; restoring an archived story
  returns it to Ready.
- Session scale, mode, and timer settings are snapshots so later team-setting
  changes cannot rewrite history.
- Every persisted vote references a session participant ID and scale-valid value
  without duplicating authenticated identity.
- Anonymous participant records contain only generated aliases and technical
  participant/session identifiers; no host-facing or persisted lookup can map
  those aliases to authenticated users.
- Timer state can be reconstructed consistently after refresh and does not
  control reveal or voting closure.
- The model differentiates metadata used for discovery from Fluid-owned source
  data and defines how metadata is refreshed after relevant mutations.
- Schema compatibility distinguishes supported, migratable, newer-unsupported,
  and invalid/corrupt roots and never silently replaces an incompatible root.
- The model documents the accepted security limitation that library Contribute
  access permits deliberate compatible-data manipulation despite host-only UI.

## Tests

- Unit-test all finite-state transition guards, including invalid story,
  session, and voting-round transitions.
- Test built-in and custom scale validation, ordering, duplicate rejection, and
  assigned-value validation.
- Test valid, migratable, newer, missing, and malformed schema versions.
- Test serialization and snapshot conversion for a complete example document.
- Test that anonymous participant and vote fixtures contain no authenticated
  identity fields or reverse mappings.
- Test timer reconstruction for running, stopped, reset, refreshed, and expired
  states with deterministic fake time.
- Maintain the repository's required coverage thresholds for implemented model
  and validator modules.

## Documentation and Examples

- Add `docs/data-model.md` with the entity model, ownership, metadata mapping,
  state diagrams, invariants, schema-version policy, and security limitations.
- Include example named and anonymous sessions and a story with multiple
  estimate-history entries.
- Document the metadata synchronization points and the rule that Fluid remains
  the source of truth.

## Dependencies

- `docs/architecture.md` defines the Fluid/SharePoint storage split.
- `docs/coding-standards.md` defines TypeScript, personal-data, security,
  testing, and documentation requirements.
- No feature story may define a competing persisted model; changes to this
  contract require an intentional schema-version decision.

## Implementation Notes

- Prefer schema objects and discriminated unions over client-maintained flags.
- Use immutable UUIDs for team, story, session, participant, and round IDs.
- Store ISO 8601 UTC timestamps; format them only at the presentation boundary.
- Presence/connection state may be ephemeral, but the joined participant record
  and finalized session history must survive refresh.
- A browser-scoped opaque token may help an anonymous participant reconnect to
  the same alias, but it must not contain or publish authenticated identity.
- Do not expose raw SharedTree nodes throughout React. Convert them into typed
  plain snapshots for rendering.
