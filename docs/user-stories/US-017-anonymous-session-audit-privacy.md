# US-017: Preserve Anonymous Identity Privacy Across Session History

## User Story

As a participant in Anonymous voting, I want the complete persisted session
lifecycle to omit authenticated actor identities so historical records preserve
the privacy behavior promised when I joined.

## Description

Anonymous joins and automatic reveal already avoid persisting an identity
mapping, but manual reveal, finalization/correction, ending, and linked estimate
history can write full host `UserReference` values into session-related state.
This does not identify a voter, but it conflicts with the stricter documented
contract that Anonymous session and round records contain no authenticated
identity values.

Make voting mode determine the persisted audit shape for every lifecycle
command. Authorization still uses the current host identity at command time;
Anonymous persistence records timestamps, reasons, and non-personal audit facts
without retaining the actor. Named sessions keep their existing identity audit.

## Public API

- Preserve the existing host-authorized reveal, reopen, finalize, correct, and
  end commands.
- Keep session and round actor references optional and make
  `EstimateHistoryEntry.finalizedBy` optional. Enforce mode-dependent invariants
  so Anonymous records cannot contain those `UserReference` values.
- Expose privacy-shaped snapshots and exports only; do not introduce an alias,
  participant, or authenticated-identity lookup API for Anonymous sessions.

## Acceptance Criteria

- Preparing, starting, joining, manually or automatically revealing, reopening,
  finalizing, correcting, and ending an Anonymous session never writes display
  name, email/login, Entra object ID, SharePoint user ID, or another reversible
  authenticated identity into that session or its rounds.
- Estimate-history entries produced by an Anonymous session omit authenticated
  actor references while retaining immutable session/round IDs, assigned value,
  and timestamp.
- Command-time host authorization remains required for manual reveal,
  finalization, correction, reopening, and ending; omitting the actor from
  persistence does not broaden capabilities.
- Named sessions continue recording the documented actor references.
- Bump the application document schema from `1.0.0` to `1.1.0`. After US-024
  validates a readable `1.0.0` root, an explicit idempotent migration removes
  session `createdBy`, `updatedBy`, and `endedBy`, round `revealedBy` and
  `finalizedBy`, and matching estimate-history `finalizedBy` values from
  Anonymous records before writing `1.1.0`.
- The migration preserves all timestamps, reveal reasons, assigned values,
  session/round references, votes, and non-identity history. Normal team and
  story administrative audit fields remain outside the Anonymous session actor
  contract.
- Privacy-shaped results and CSV exports remain aggregate-only and contain no
  new identity, alias, participant ID, or individual-vote fields.
- Documentation no longer treats manual host reveal as an exception to the
  Anonymous persisted-identity rule.

## Tests

- Run the complete Anonymous lifecycle through manual reveal, automatic reveal,
  reopen, finalization, correction, and end, then recursively inspect the
  session, rounds, linked story estimate history, snapshots, and exports for
  forbidden identity fields and values.
- Verify the same lifecycle in Named mode retains expected actor audit data.
- Test host authorization independently from persisted actor projection.
- Test `1.0.0` Anonymous migration field-by-field, repeated idempotent migration,
  unchanged Named records, and newer/invalid rejection without destructive
  reset.

## Documentation and Examples

- Update the data model, participation, voting-results, session-completion, and
  About/privacy guidance with the mode-specific audit contract.
- Document that Anonymous mode is an application persistence/presentation
  promise, not network anonymity from Microsoft 365 or tenant administrators.

## Dependencies

- US-001 defines persisted audit and privacy contracts.
- US-011 defines Anonymous participation and Presence boundaries.
- US-014 and US-015 own reveal, estimate history, correction, and ending.
- US-024 governs complete load validation and migration ordering.

## Implementation Notes

- Centralize the decision that projects an audit actor from voting mode so every
  lifecycle command applies the same rule.
- Retain timestamps and reason enums as non-personal audit facts.
- This story supersedes the prior documented manual-reveal host-identity
  exception; it does not change the accepted SharePoint library permission
  trade-off.
