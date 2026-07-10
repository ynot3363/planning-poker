# US-008: Import Stories from CSV

## User Story

As a team host, I want to download a CSV template and bulk import stories so I
can prepare a pointing backlog without entering every story manually.

## Description

Add a host-only CSV workflow to the Stories screen. Hosts download an
Excel-friendly template, upload a completed file, review row-level validation,
and confirm one atomic import into the selected team. Imported stories always
start Ready; audit fields are supplied by the application.

Treat CSV content as untrusted. Limit file size and row count, parse quoted and
multiline values correctly, validate every field through the same domain rules
as individual creation, and never execute file content.

## Public API

Define a versioned CSV contract with these columns in order:

1. `Title` (required)
2. `Description` (optional)
3. `Link` (optional)

Provide typed operations for template generation, file parsing, row validation,
preview, and atomic import. Added By, Added On, Story ID, Status, point value,
and session history are not accepted as import columns.

## Acceptance Criteria

- Download Template is a secondary action for a selected hosted team and
  produces a UTF-8 CSV with the exact supported header and one clearly marked
  example row or accompanying instructions.
- Upload CSV accepts `.csv` only, enforces a documented maximum of 5 MB and
  1,000 data rows, and reports file-level errors before parsing excessive data.
- The parser supports UTF-8 BOM, quoted commas, escaped quotes, CRLF/LF, and
  quoted multiline descriptions.
- Header matching is trimmed and case-insensitive but rejects missing required,
  duplicate, and unsupported columns with an actionable message.
- Every row uses US-007 title and link validation; blank rows are ignored and
  row numbers remain traceable to the uploaded file.
- A preview reports valid count, invalid count, warnings, and row-level field
  errors without exposing raw unsafe markup.
- Duplicate titles are allowed because story title is not an identifier, but
  exact duplicate rows in the same upload receive a warning.
- Import remains disabled while any row is invalid. Confirming an all-valid
  preview creates all stories in one Fluid transaction or creates none.
- Every imported story receives a generated ID, Ready status, current user as
  Added By, and a common application-generated Added On timestamp.
- The import waits for durable Fluid save acknowledgement, updates Last
  Activity once, announces success, and refreshes the Ready pivot.
- Cancel, parsing failure, save timeout, and disconnected states do not create
  partial stories and allow the host to recover without reloading the page.
- The upload, preview table, validation summary, and confirmation flow are
  keyboard and screen-reader accessible and use US-004 visual patterns.

## Tests

- Unit-test template output and parser fixtures for BOM, delimiters, quotes,
  multiline text, blank lines, malformed rows, headers, limits, and URLs.
- Test formula-like text and HTML/script-looking content as inert story text.
- Test row-number preservation, exact-duplicate warnings, and atomic domain
  conversion.
- Component-test download, file selection, validation summary, preview,
  confirmation, cancellation, success, and failure states.
- Service-test that one transaction creates all valid stories and rolls back on
  a mutation error.

## Documentation and Examples

- Add import instructions and a table defining each supported column, limit,
  encoding, default, and validation rule.
- Provide downloadable template behavior in the About experience.

## Dependencies

- US-007 owns story validation, creation, host checks, and Ready state.
- US-004 provides panels, tables, messages, and action hierarchy.

## Implementation Notes

- Prefer a reviewed, pinned parser compatible with the SPFx/ES5 build when it
  materially reduces CSV edge-case risk; otherwise implement and heavily test a
  focused parser.
- Clear selected file objects and parser buffers after completion/disposal.
- Do not send uploaded content to an external service.
