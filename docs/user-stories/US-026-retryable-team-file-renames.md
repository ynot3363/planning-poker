# US-026: Make Team File Renames Retryable and Reconcilable

## User Story

As a team host, I want retrying a failed rename to repair the physical Fluid file
name so the team title, SharePoint metadata, and drive item cannot remain
silently inconsistent.

## Description

The current workflow saves the new title in Fluid before calling Microsoft
Graph to rename the `.fluid` file. If Graph fails, retrying the same title sees
no Fluid title change and skips the physical rename, allowing metadata and the
drive filename to diverge permanently.

Make rename idempotence depend on the actual drive item name and immutable Team
ID, not only the before/after Fluid title comparison. Surface partial projection
state and reconcile it on retry without altering history.

## Public API

- Make `renameTeamDocument(teamId, expectedTitle)` idempotently compare and
  reconcile the current Fluid title, actual drive filename, and Title metadata.
- Return renamed, already-aligned, partially-applied, conflict,
  duplicate/invalid-title, inaccessible, and repair-required results.
- Provide a safe retry/reconcile action to the Teams experience without exposing
  drive IDs or transport details to ordinary users.

## Acceptance Criteria

- Rename validates the requested SharePoint filename and uniqueness before
  mutation and preserves the immutable Team ID.
- The workflow reads the actual current drive item filename; matching Fluid text
  alone never suppresses a needed Graph rename.
- If Fluid title succeeds and Graph rename fails, the UI reports a recoverable
  partial state and retrying the same title attempts the physical rename.
- Successful retry aligns `<Team Title>.fluid`, Fluid team title, and Title
  metadata without duplicating a team or changing stories, sessions, votes, or
  history.
- Conflicting concurrent rename requests have a documented deterministic or
  explicit user-resolution path and cannot stamp metadata for an unverified
  filename.
- Save acknowledgement, Graph throttling/error normalization, conditional
  metadata behavior, cancellation, and non-sensitive diagnostics follow
  repository standards.

## Tests

- Service-test first Graph rename failure followed by same-title retry and
  assert the original drive item is repaired.
- Cover metadata failure after Graph success, already-aligned retry, actual-name
  mismatch, duplicate title, invalid filename, access denial, throttling,
  deletion, and concurrent different-title requests.
- Assert immutable Team ID and complete team/story/session history are unchanged
  except for title/audit fields owned by rename.

## Documentation and Examples

- Update team-management and repository docs with partial rename state, retry,
  conflict, and support-repair guidance.

## Dependencies

- US-003 owns Graph drive-item operations and repository errors.
- US-005 owns title validation and team edit UX.
- US-019 supplies intent-specific team mutation and stale-edit protection.
- US-022 supplies conditional metadata synchronization.
- US-025 supplies partial-operation ownership/recovery patterns.

## Implementation Notes

- Resolve the drive item by immutable Team ID or the known validated item ID,
  then compare its actual `name` property.
- Do not roll back by replacing a stale whole team snapshot.
- Do not request broader Graph permissions; the existing delegated
  `Files.ReadWrite` scope remains the approved boundary.
