# US-019: Replace Stale Collection Writes with Intent-Specific Commands

## User Story

As a Planning Poker collaborator, I want each command to mutate the latest
shared entity by intent so another client's accepted work is not erased by a
stale screen snapshot.

## Description

Several team, story, import, and session-start flows assemble a complete object
or collection from a plain UI snapshot and replace the corresponding SharedTree
subtree. If two clients act from the same base, the later replacement can erase
the other client's story, participant join, host change, finalization, or
estimate history.

Replace broad setters with domain commands that locate current hydrated nodes,
recheck invariants, and mutate only the fields or sequence entries owned by the
requested action. Plain snapshots remain read models, never write payloads for
an authoritative collection.

## Public API

- Add typed store commands for focused team-field/settings/roster changes,
  individual story create/edit/transition/delete, atomic multi-story import,
  and Lobby-to-Active session transition.
- Each command accepts stable entity IDs plus the minimum validated values and
  returns a typed applied, idempotent, conflict, stale, or rejected result.
- Remove or make private public `replaceTeam`, `replaceStories`,
  `replaceSessions`, and equivalent whole-subtree mutation entry points.
- Preserve plain serializable snapshots and subscriptions as read-only
  presentation APIs.

## Acceptance Criteria

- Every affected command finds its target in the current live tree inside the
  mutation transaction and rechecks host, status, open-round, and immutable
  audit/history rules before writing.
- Creating or importing stories inserts new schema nodes through the SharedTree
  sequence API and never reparents hydrated nodes or replaces unrelated stories.
- Editing one story changes only editable content and cannot overwrite a
  concurrently finalized status, current estimate, or history.
- Team edits patch explicitly owned fields and cannot restore a concurrently
  removed host or overwrite unrelated settings without a surfaced conflict.
- Starting a Lobby changes only that authoritative session and cannot replace a
  participant join or another session's history.
- Bulk CSV import is atomic for the submitted rows while preserving stories
  added or changed by other clients.
- Stale commands fail with actionable non-sensitive state or safely rebase;
  they never report success after dropping converged work.
- SharePoint metadata is refreshed only after the relevant Fluid mutation is
  acknowledged and remains a discovery projection.

## Tests

- Unit-test every intent command's validation, entity lookup, immutable-field
  preservation, and typed conflict result.
- Use two independent Fluid clients with controllable operation delivery to
  cover concurrent story create/import/edit/finalize, team roster/settings
  edits, Lobby start/join, and history preservation.
- Assert unrelated entities are deeply unchanged after each command and no
  accepted concurrent addition disappears after convergence and reload.
- Retain isolated plain-array fakes only for unit seams; do not represent them
  as distributed-concurrency coverage.

## Documentation and Examples

- Update architecture and repository lifecycle documentation with the
  command/read-model separation and examples of focused tree mutation.
- Document typed stale/conflict recovery for Teams, Stories, and Voting screens.

## Dependencies

- US-001 defines entity ownership and immutable fields.
- US-003 owns the repository and live SharedTree handle.
- US-005, US-007, US-008, US-010, and US-014 supply affected command behavior.
- US-020 builds convergence-safe uniqueness and idempotence on this focused
  mutation boundary.

## Implementation Notes

- Keep transaction callbacks synchronous and mutate hydrated nodes directly.
- Do not accept a complete `PlanningPokerDocumentRoot` or collection assembled
  from UI state as a mutation command.
- Preserve the accepted library permission model; this story addresses lost
  updates, not authorization against a capable contributor.
