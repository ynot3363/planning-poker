# US-025: Clean Up Fluid Resources and Recover Partial Creation

## User Story

As a Planning Poker host, I want failed create/load attempts to release resources
and preserve a repair path so retries do not leak connections or strand
undiscoverable team files.

## Description

Create and load flows transfer ownership across an ODSP container, services,
SharedTree view, repository handle, durable save, and SharePoint metadata.
Exceptions before final ownership transfer can leak sockets/listeners. A failure
after attachment but before metadata indexing can also leave a valid `.fluid`
file that a blind retry duplicates rather than repairs.

Define explicit ownership and partial-success results. Dispose every resource
that has not been returned, and use immutable Team ID/drive item identity to
resume metadata repair for attached documents without silently deleting data.

## Public API

- Preserve idempotent `dispose()` on successful loaded handles.
- Return or throw a typed recoverable attached-but-unindexed result containing
  only the non-secret team/drive identity needed to retry metadata repair.
- Provide `repairTeamMetadata(teamIdOrDriveItemId)` or equivalent idempotent
  recovery through the repository.
- Keep container, services, view, listener, and timer ownership internal.

## Acceptance Criteria

- Create and load keep resources under one ownership guard until a complete
  handle is returned; every exception disposes all acquired resources exactly
  once in dependency-safe order.
- Failures during client creation, view creation, initialization, attach,
  schema inspection/upgrade, snapshot decoding, save acknowledgement, and
  metadata projection have explicit outcomes and no retained listeners/sockets.
- A failure before attach leaves no file and can be retried normally.
- A failure after attach never triggers blind duplicate creation or automatic
  destructive deletion; the returned error identifies a safe metadata repair
  path by immutable Team ID/drive item ID.
- Retrying repair validates the attached document, reconciles metadata, and
  returns the original team without changing team ID, content, or history.
- Abandoning a repair handle still disposes local Fluid resources; no token or
  personal diagnostic content enters the recovery record.
- Repeated dispose/repair calls are idempotent and safe during web-part teardown.

## Tests

- Inject failures before/after every create, initialize, attach, view, upgrade,
  decode, save, and metadata stage; assert exactly-once cleanup and listener
  removal.
- Test attached-file metadata failure followed by successful repair and verify
  that only one file/team exists.
- Test repair rejection for mismatched Team ID, incompatible/corrupt document,
  access denial, and deleted file without destructive fallback.
- Verify successful handles retain resources until their own idempotent dispose.

## Documentation and Examples

- Document resource ownership transfer, partial-creation recovery, support
  diagnostics, and the no-automatic-delete policy.
- Add a sequence diagram for pre-attach failure, post-attach metadata failure,
  and recovery.

## Dependencies

- US-003 owns Fluid create/load/metadata lifecycle.
- US-005 owns the team-creation experience and retry UI.
- Reuse the current repository validation seam for recovery; US-024 later
  strengthens that seam with complete decoding and migration ordering without
  changing this story's ownership contract.

## Implementation Notes

- Use `try`/`finally` ownership transfer rather than duplicating cleanup in each
  catch branch.
- Preserve only opaque non-secret identifiers in recovery errors; never include
  token providers, request headers, or raw response bodies.
- Recycle/delete remains the explicit US-006 host workflow, not error cleanup.
