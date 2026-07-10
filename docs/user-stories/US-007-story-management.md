# US-007: Manage the Story Lifecycle

## User Story

As a team host, I want to create, edit, archive, restore, and re-ready stories so
the team votes only on the correct backlog while retaining estimation history.

## Description

Build the Stories destination around an explicit hosted-team selector and the
standard Ready, Pointed, and Archived states. Only hosts may administer stories.
Added By and Added On are system audit values. A story may be voted on only while
Ready; finalization moves it to Pointed, and a host may later return it to Ready
for a new session without erasing prior estimates.

## Public API

Provide typed commands for:

- create story with title, description, and optional link;
- edit story content without implicitly changing status;
- archive a Ready or Pointed story;
- restore an Archived story to Ready;
- return a Pointed story to Ready for re-pointing;
- select hosted team and status tab;
- validate/normalize an optional story URL.

## Acceptance Criteria

- The screen lists only hosted teams and requires a team selection before story
  commands are available.
- A user who hosts no teams sees a clear message that they must create a team
  first, with navigation to Teams when available.
- Ready, Pointed, and Archived pivots show counts and only the corresponding
  stories; Pointed rows show the current assigned value.
- Add Story is the primary action for a selected hosted team and opens an
  accessible form using Fluent UI controls.
- Title is required; description is multiline; link is optional and accepts
  only approved SharePoint-relative or `https:` URLs.
- Added By and Added On are populated from current context/time, displayed
  read-only, and never changed during edits, import, archive, restore, or
  re-pointing.
- Hosts can edit story title, description, and link in any state without
  silently changing status or estimate history.
- Archive is available for Ready or Pointed stories after confirmation and
  preserves all content and estimate history.
- Restore changes Archived to Ready. Re-point changes Pointed to Ready. Both are
  explicit commands and retain every historical estimate/session reference.
- Archived and Pointed stories cannot be selected for voting. Only Ready stories
  are returned by the voting-eligibility selector.
- A story currently used by an open voting round cannot be edited, archived,
  restored, or re-readied until that round is finalized or the session ends.
- Mutations use Fluid transactions, update document/Last Activity state, wait
  for durable save acknowledgement, and synchronize across open clients.
- Tables/cards, pivots, command bars, panels, dialogs, links, empty states, and
  status badges follow US-004 theming and WCAG 2.2 AA behavior.
- Story links open in a new tab with `noopener noreferrer` and never allow
  script or unchecked protocols.

## Tests

- Unit-test URL validation and every allowed/disallowed story transition.
- Test that edit operations preserve Added By, Added On, status, current
  estimate, and history unless an explicit status command changes them.
- Component-test no-host, no-team-selected, empty tabs, populated tabs, add,
  edit, archive, restore, re-point, validation, blocked active round, and save
  failure states.
- Two-client service/component tests verify synchronized creation, editing, and
  status changes without broad snapshots.
- Run accessibility tests for pivots, tables, panels, confirmation dialogs, and
  status announcements.

## Documentation and Examples

- Add help content explaining Ready, Pointed, Archived, restore, and re-pointing
  while preserving estimation history.
- Provide examples for long titles/descriptions, valid links, empty states, and
  every status tab.

## Dependencies

- US-001 defines story states and estimate history.
- US-005 supplies hosted-team selection.
- US-004 supplies visual and interaction patterns.
- US-010 through US-014 consume Ready stories and control open-round guards.

## Implementation Notes

- Derive tab contents from one typed story collection; do not maintain three
  divergent copies.
- Use stable story IDs as row keys and session references, never array indexes.
- Preserve historical estimates as append-only records even when the current
  estimate changes after re-pointing.
