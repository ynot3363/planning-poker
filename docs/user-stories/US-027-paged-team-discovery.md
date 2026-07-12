# US-027: Page Complete Team Discovery Results

## User Story

As a host in a site with many Planning Poker teams, I want discovery to follow
all SharePoint result pages so every team I host can be found and managed.

## Description

Team metadata discovery currently unwraps only the first SharePoint response and
ignores continuation links. Listing, duplicate-title checks, immutable Team ID
lookup, rename repair, and other repository operations can therefore miss valid
files after the first page.

Add one reusable bounded paging path that supports modern and verbose SharePoint
response shapes, validates continuation URLs, and preserves cancellation and
typed error behavior.

## Public API

- Keep existing hosted-team list and lookup operations while making paging an
  internal transport/repository concern.
- Provide a reusable private or repository-scoped async paging utility for
  `value`, `d.results`, `@odata.nextLink`, `odata.nextLink`, and `d.__next`.
- Accept an `AbortSignal` or existing cancellation contract for multi-page
  requests.

## Acceptance Criteria

- Team discovery follows every supported continuation shape until no next link
  remains and returns each drive/list item once.
- Hosted-team filtering, Team ID lookup, duplicate-title checks, rename/delete
  resolution, and metadata repair all consume the complete paged result set.
- Continuation URLs are accepted only for the configured SharePoint origin and
  expected REST endpoint family; cross-origin or malformed links are rejected.
- Paging is limited to 100 pages, detects repeated continuation links, and
  returns a typed safety-limit error if another continuation remains rather than
  looping or returning a misleading partial result.
- Duplicate drive/list records or Team IDs across pages are deduplicated
  deterministically and final result ordering is stable and documented.
- Existing query filters, selected fields, and ordering remain correct across
  continuation requests.
- Cancellation stops further pages and no partial list is represented as a
  complete successful discovery result.
- Throttling and `Retry-After` handling use the repository's bounded retry
  policy without logging request credentials.

## Tests

- Service-test single and multiple pages for all modern/verbose continuation
  shapes, empty intermediate/final pages, and duplicate records.
- Test a hosted team and Team ID located only on a later page, plus duplicate
  title detection across page boundaries.
- Test cross-origin/malformed/repeated links, safety limits, throttling,
  cancellation, malformed bodies, and later-page authorization failure.
- Add an approved large-library live smoke test outside the ordinary unit loop
  when a tenant fixture is available.

## Documentation and Examples

- Update architecture/repository guidance with supported response shapes,
  paging limits, cancellation, and failure semantics.

## Dependencies

- US-002 defines SharePoint response normalization and storage configuration.
- US-003 owns team discovery and immutable Team ID lookup.
- US-005, US-006, US-025, and US-026 consume complete discovery results.

## Implementation Notes

- Centralize paging rather than adding separate loops to each consumer.
- Preserve server-provided continuation encoding; validate its origin/path
  before requesting it.
- Do not expand library permissions or treat a missing first-page record as
  authorization evidence.
