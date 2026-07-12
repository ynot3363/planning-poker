# US-018: Harden Reconnect State and Diagnostic Redaction

## User Story

As a Planning Poker maintainer, I want browser reconnect data and diagnostics
treated as untrusted boundaries so malformed credential text cannot become
collaborative identity or telemetry.

## Description

Anonymous reconnect records currently accept any non-empty participant ID from
`sessionStorage`. Same-origin tampering or corruption can therefore turn
credential-like text into a durable participant ID and later a vote reference.
Separately, the optional Microsoft 365 LivePersona loader logs the original
rejected `Error`, whose message or stack could contain a signed URL or token.

Apply the same strict opaque-ID contract used by production ID generation when
restoring browser state, and log only stable sanitized diagnostics at the live
persona boundary.

## Public API

- Reuse or expose one bounded opaque-ID/UUID validator for persisted domain and
  browser-restored participant identifiers.
- Keep anonymous reconnect-token creation, storage, and clearing browser-local;
  no reconnect-token value becomes a public domain or SharedTree field.
- Normalize LivePersona loader failures to a constant non-sensitive error and
  stable logging category without returning the original error object.

## Acceptance Criteria

- A reconnect participant ID is reused only when it exactly matches the
  production-generated identifier format and length.
- Empty, malformed, oversized, JWT-like, bearer-like, signed-URL, and otherwise
  invalid reconnect records are removed when storage permits, then a fresh
  opaque participant ID is generated.
- The browser reconnect token remains random, session-scoped, cleared after
  authoritative session end, and never enters URLs, Presence, SharedTree,
  metadata, exports, or logs.
- LivePersona load rejection preserves the normal Persona fallback while
  logging a new constant safe `Error` and category; the original message, stack,
  cause, URL, nested error, and credential text are not forwarded.
- User-facing recovery text remains useful but contains no raw browser-storage
  value or loader error.

## Tests

- Unit-test valid reconnect reuse and invalid JSON, missing fields, wrong types,
  invalid UUIDs, oversized values, JWT-shaped values, and credential sentinels.
- Assert invalid records cannot appear as participant IDs or vote references in
  a SharedTree snapshot.
- Mock LivePersona loader failures containing bearer tokens, signed URLs, and
  sensitive stack text; assert the logged `Error` and visible fallback contain
  none of those values.
- Verify reconnect state is cleared after Anonymous session completion and that
  storage failure does not break joining or ending.

## Documentation and Examples

- Update participation and diagnostics guidance with the reconnect record's
  strict format, local-only lifetime, invalid-record recovery, and logging
  redaction policy.

## Dependencies

- US-001 defines opaque persisted identifiers.
- US-004 owns the LivePersona fallback and application diagnostics surface.
- US-011 owns Anonymous reconnect and Presence behavior.
- US-016 supplies the broader application-token non-persistence regression
  boundary.

## Implementation Notes

- Validate parsed browser state before calling a join command; never repair an
  invalid identifier by truncating or partially accepting it.
- Create a fresh safe `Error` for logging instead of mutating or forwarding an
  untrusted rejection object.
- No SharePoint permission changes are included.
