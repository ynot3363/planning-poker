# US-009: Export the Team Story Catalog

## User Story

As a team host, I want to export all team stories so I can analyze or archive the
backlog outside Planning Poker, including each story's current assigned value.

## Description

Add a host-only export of the selected team's complete Ready, Pointed, and
Archived story catalog. Export current story/audit state and current estimate
summary, not individual votes or participant data. Generate the file entirely
in the browser from a validated Fluid snapshot.

## Public API

Define an export row with these ordered columns:

- `Story ID`
- `Title`
- `Description`
- `Link`
- `Status`
- `Added By`
- `Added On`
- `Current Point Value`
- `Current Point Session ID`
- `Last Pointed On`

Expose a pure serializer and a host command that downloads
`<Team Title>-stories-<YYYY-MM-DD>.csv`.

## Acceptance Criteria

- Export All Stories is available only after a hosted team is selected and is a
  supporting command rather than competing with Add Story.
- Export includes every current story exactly once regardless of selected pivot
  and uses the canonical Ready, Pointed, or Archived status.
- Pointed stories include current assigned value, session ID, and pointed time;
  stories with no current estimate leave those cells empty.
- Historical estimates, individual votes, participant identities/aliases, and
  vote breakdowns are excluded.
- The serializer emits UTF-8 CSV with a BOM and correctly escapes commas,
  quotes, CRLF/LF, multiline descriptions, and non-ASCII text for Excel use.
- Cells beginning with spreadsheet formula control characters are neutralized
  without changing the stored story data.
- Export reads a consistent plain snapshot and does not mutate Fluid or
  SharePoint metadata.
- Empty teams may export a header-only file after clear user feedback.
- Generation failure produces an accessible error and no misleading success.
- The action and feedback meet keyboard, screen-reader, and US-004 styling
  requirements.

## Tests

- Unit-test headers, ordering, escaping, BOM, newlines, Unicode, empty values,
  file-name safety, and spreadsheet-formula neutralization.
- Test Ready, Pointed, Archived, restored, and re-pointed story fixtures.
- Assert that vote and participant fields can never appear in output rows.
- Component-test disabled, empty, populated, success, and generation-failure
  states.

## Documentation and Examples

- Document the export columns, current-estimate semantics, formula protection,
  and excluded voting-detail data.
- Add the story-catalog export workflow to the About screen.

## Dependencies

- US-001 defines story and estimate fields.
- US-007 provides host/team selection and current story snapshots.

## Implementation Notes

- Keep the serializer pure and independent of browser download APIs for testing.
- Revoke generated object URLs after download and on disposal.
