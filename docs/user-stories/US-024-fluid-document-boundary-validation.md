# US-024: Validate Fluid Documents Before Migration and Use

## User Story

As a Planning Poker feature developer, I want every loaded Fluid document fully
decoded before migration or exposure so malformed or newer state cannot reach
business logic or be changed accidentally.

## Description

The SharedTree schema uses strings for several finite domain states, while the
load path currently checks only a shallow root shape and compares the
application version lexically. It can upgrade the stored tree schema before
rejecting a newer application document and does not invoke complete document
invariant validation.

Add a runtime decoding and cross-entity validation boundary for loaded roots.
Check application compatibility before any shared mutation, apply only explicit
supported migrations, and dispose all partially owned Fluid resources on every
rejection.

## Public API

- Expose a typed `decodePlanningPokerDocument` or equivalent boundary returning
  a validated plain domain root or structured compatibility/corruption errors.
- Expose semantic schema-version comparison and an explicit supported migration
  registry.
- Keep raw SharedTree nodes, partially decoded values, and migration internals
  private to the repository.
- Preserve typed not-found, incompatible-newer, unsupported-older,
  migration-failed, corrupt-document, and wrong-initial-object errors.

## Acceptance Criteria

- Loading verifies the expected Fluid initial object and schema identity, then
  reads enough compatible state to validate the application schema version
  before calling any stored-schema upgrade or domain mutation.
- Schema versions use semantic comparison; `1.10.0` correctly sorts after
  `1.9.0`.
- Runtime decoding validates all finite discriminants, required/optional field
  types, bounded IDs/timestamps, user-reference shapes, settings/scales, timer
  states, votes, and mode-specific participant/audit records.
- Cross-entity validation checks unique IDs, one open session, one unfinished
  round, pointer targets, participant/vote references, scale-valid values,
  finalized indexes, story/current-estimate/history consistency, and privacy
  invariants.
- Story links use the US-016 persisted-link policy without executing or
  exporting unsafe content.
- Newer, wrong-schema, malformed, or otherwise unsupported roots produce
  non-destructive recoverable errors and are not reset, upgraded, renamed, or
  metadata-stamped.
- Supported older roots use only an explicit tested migration and are validated
  again before the repository returns a handle.
- Every rejected path disposes its view, services, container, listeners, and
  timers exactly once.

## Tests

- Unit-test semantic versions and a complete matrix of invalid discriminants,
  duplicate IDs/votes, dangling pointers, mismatched participant shapes,
  invalid timers/scales, inconsistent history, privacy violations, and unsafe
  links.
- Service-test wrong initial-object key, missing root, view failure, valid
  current state, supported older state, newer state, failed migration, and
  post-migration revalidation.
- Assert no shared mutation or metadata write occurs before compatibility is
  accepted and all failure paths dispose exactly once.
- Maintain focused high coverage for the decoder and invariant modules.

## Documentation and Examples

- Update data-model, architecture, and repository documentation with validation
  ordering, error taxonomy, supported-version policy, and migration examples.

## Dependencies

- US-001 owns the domain schema and invariants.
- US-003 owns create/load and typed repository errors.
- US-016 owns credential-safe persisted story links.
- US-017 owns the Anonymous lifecycle privacy invariant.
- US-025 supplies exactly-once cleanup for every rejected load stage and should
  be implemented before this story.

## Implementation Notes

- Decode from `unknown` through explicit narrowing; do not cast a parsed root to
  the domain type before validation.
- Separate readable stored-schema compatibility from permission to mutate the
  application document.
- Validation detects corruption and compatibility; it does not make the
  accepted broad-Contribute model a tamper-proof security boundary.
