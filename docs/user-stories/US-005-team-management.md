# US-005: Create and Manage Teams

## User Story

As a product owner or scrum master, I want to configure teams I host so each
team has the right members, point scale, timer, and voting behavior.

## Description

Build the Teams destination for host administration. A user sees only teams for
which their current Entra/SharePoint identity appears in the Hosts metadata and
validated Fluid team record. Hosts can create a team, edit its descriptive
information and roster, activate/deactivate it, and configure voting defaults.

Configured members form the expected team roster, but membership does not block
an authenticated site user invited through a session link from joining that
session. Host-only controls are application behavior under the accepted library
Contribute permission model.

## Public API

Provide typed form and mutation contracts for:

- title and description;
- multiple required hosts;
- multiple optional configured members;
- `isActive`;
- scale kind and ordered values;
- timer enabled and duration in whole minutes;
- named or anonymous voting mode;
- create, update, cancel, and validation results.

Custom scale values are trimmed, case-insensitively unique, ordered non-empty
labels. Require at least two and allow at most twenty values. Timer duration is
required only when enabled and supports 1 through 60 whole minutes. The form
converts minutes to the US-001 persisted seconds contract.

## Acceptance Criteria

- The Teams screen lists only teams the current user hosts, including inactive
  teams with a clear inactive state.
- Empty state guidance explains what teams do and makes New Team the primary
  action.
- New Team opens an accessible panel or page with the current user selected as a
  host by default.
- Title and description are editable; title is required and satisfies US-003
  unique SharePoint file-name rules.
- Multiple hosts and configured members can be resolved with Fluent UI
  people/persona controls; duplicate people are prevented.
- At least one host is always required. A host cannot remove themselves when
  that would leave the team with no host.
- Built-in Fibonacci and T-shirt choices render their fixed US-001 values and do
  not include `?`.
- Custom selection exposes ordered add, edit, remove, and reorder controls and
  enforces the custom-value rules.
- Hosts can enable/disable the timer and set a valid duration when enabled.
- Hosts can select Named or Anonymous voting and receive concise explanatory
  text about what participants will see.
- Hosts can set `isActive`; inactive teams remain manageable but cannot start a
  new voting session.
- Save creates or updates the Fluid team transactionally, waits for durable save
  acknowledgement, and then refreshes Title, Hosts, Participants, Is Active,
  Schema Version, and Last Activity metadata.
- Renaming uses the US-003 repository and does not change the team ID or history.
- If metadata and Fluid host lists disagree, host actions require the current
  user in the loaded Fluid host list and surface a repair-oriented error rather
  than silently broadening access.
- People-picker failures, duplicate title, validation, concurrency, connection,
  save timeout, and metadata-sync failures have useful non-sensitive states.
- Cards, personas, command buttons, dropdowns, toggles, panels, and dialogs use
  the shared Microsoft 365 visual and accessibility patterns from US-004.
- The screen states that host-only UI is not a SharePoint security boundary
  under the configured library permission model.

## Tests

- Unit-test form validation, built-in/custom scales, title/file-name rules,
  timer limits, host invariants, and metadata projection.
- Component-test empty, loading, populated, inactive, create, edit, validation,
  save, failure, and retry states with keyboard and screen-reader queries.
- Service-test create, rename, update, save acknowledgement, and metadata-sync
  ordering.
- Test that a metadata-only false positive cannot enable host mutations after
  the loaded Fluid host check fails.

## Documentation and Examples

- Add About/help content for team roles, configured members, scales, timer,
  named/anonymous behavior, activity, and title/file-name restrictions.
- Add examples for built-in scales, custom-scale editing, inactive teams, and
  multiple hosts/members.

## Dependencies

- US-001 defines team/settings contracts.
- US-003 provides team discovery and durable mutations.
- US-004 provides the application shell and shared design patterns.

## Implementation Notes

- Keep people resolution and SharePoint `ensureuser` calls in a service.
- Store stable identity keys and refresh display data without treating display
  name or email as an authorization key.
- Snapshot settings when a later session starts; editing a team must not mutate
  historical sessions.
