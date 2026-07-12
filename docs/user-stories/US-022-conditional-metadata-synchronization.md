# US-022: Synchronize SharePoint Metadata Conditionally

## User Story

As a Planning Poker collaborator, I want SharePoint discovery metadata to reject
stale projections so an older client cannot erase a newer active session or
overwrite newer team summaries.

## Description

Fluid is authoritative, but metadata updates currently patch a complete
projection with unconditional overwrite semantics. An old session-ending client
can clear `Active Session ID` after another client has prepared a new Lobby, and
stale team projections can similarly replace newer title, host, participant, or
activity values.

Introduce expected-state, ETag-aware metadata commands. On conflict, read fresh
metadata and converged Fluid state, then either retry the authoritative
projection within a bounded policy or return a typed repair state.

## Public API

- Provide typed metadata operations for setting an active session and
  `clearActiveSessionId(expectedSessionId)` or equivalent compare-and-clear
  behavior.
- Support field-scoped expected values and SharePoint item ETags for other
  discovery projections that can race.
- Return updated, already-current, precondition-conflict, throttled,
  unauthorized, and repair-required results through the repository boundary.

## Acceptance Criteria

- Clearing an ended session's metadata succeeds only when the stored Active
  Session ID still equals that session ID; it never clears a newer Lobby/Active
  session.
- Metadata writes read or retain the current list-item ETag and use a
  conditional request rather than `If-Match: *` for race-sensitive updates.
- A precondition failure reloads metadata and the converged Fluid root before a
  bounded retry or returns an actionable repair result; stale local snapshots
  are not blindly replayed.
- Team title, Hosts, Participants, Is Active, Schema Version, Active Session ID,
  and Last Activity preserve newer authoritative values during overlapping
  projections.
- Per-vote, timer-tick, and Presence mutations still do not write SharePoint
  metadata.
- Retry and user-facing errors honor throttling, cancellation, and redaction
  standards.

## Tests

- Service-test a new Lobby prepared between old-session save acknowledgement and
  metadata clear, asserting the new ID survives.
- Test stale overlapping title/host/member/activity projections, ETag success,
  precondition failure, bounded reconciliation, throttling, access denial, and
  retry exhaustion.
- Verify ordinary vote, timer, and Presence changes perform no metadata request.
- Include a live-tenant smoke scenario when an approved isolated site is
  available; keep it outside the local unit loop.

## Documentation and Examples

- Document metadata expected-state semantics, ETag flow, conflict recovery, and
  repair guidance in architecture, repository, team, and session-completion
  docs.

## Dependencies

- US-003 owns metadata projection and SharePoint transport behavior.
- US-005, US-010, US-014, and US-015 define metadata synchronization points.
- US-020 defines the converged Fluid state used during conflict repair.
- US-024 supplies the validated root used to rebuild a conflicted projection.

## Implementation Notes

- Prefer field-scoped commands over posting a stale complete projection when a
  workflow owns only one metadata fact.
- Use the actual SharePoint list-item ETag and preserve response-shape
  normalization already required by the repository.
- This story does not change library permissions or make metadata authoritative.
