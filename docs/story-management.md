# Story Management

The Stories destination manages one selected hosted team's story catalog from
its authoritative Fluid document. Choose a hosted team before adding or changing
stories. Users without a hosted team must create one from the Teams destination
first.

## Lifecycle

- **Ready** stories can be selected by a future voting round.
- **Pointed** stories show their current assigned estimate and retain every
  finalized estimate-history entry.
- **Archived** stories leave the active backlog without losing their content,
  audit fields, current estimate, or estimate history.

Restore moves an Archived story to Ready. Re-point moves a Pointed story back to
Ready so it can enter a new voting round. Neither operation erases the previous
estimate or its session and round references. A story used by an unfinished
round in a Lobby or Active session cannot be edited or moved until that round is
finalized or the session ends.

## Story Content and Audit

Hosts can add and edit a required title, multiline description, and optional
link in every lifecycle state. Links must be either:

- an `https:` URL such as `https://dev.azure.com/example/project/_workitems/edit/42`;
- a SharePoint-relative path beginning with `/`, such as
  `/sites/delivery/Lists/Backlog/DispForm.aspx?ID=42`; or
- blank.

Unchecked protocols, protocol-relative links, and script URLs are rejected.
Rendered links open in a new tab with `noopener noreferrer`.

Added By and Added On are populated by the application when a story is created.
They are read-only and remain unchanged during edits, imports, archive, restore,
or re-point operations. Updated audit fields and the document Last Activity
timestamp change only after an explicit durable mutation.

## Examples and Empty States

Long titles and descriptions wrap within responsive story cards. Each Ready,
Pointed, and Archived pivot shows its count and an explanatory empty state when
no stories match. Archive requires confirmation because it removes a story from
the active backlog, while restore and re-point remain explicit labeled actions.

Delete is a separate permanent action available in every lifecycle state. Its
confirmation explains that the story content, current estimate, and estimate
history will be removed. Delete is blocked while the story belongs to an
unfinished round; use Archive whenever historical estimation records should be
retained.

Story mutations run through Fluid transactions, wait for ODSP save
acknowledgement, and publish synchronized snapshots to other open clients.
SharePoint metadata remains a team-discovery index and does not duplicate the
story catalog.

## CSV Import

Select a hosted team and choose **Download template** to create an Excel-friendly
UTF-8 CSV containing the supported header. Add as many as 1,000 story rows, save
the file as `.csv`, replace or remove the clearly marked example row, choose
**Upload CSV**, review every row, and confirm the import. The file remains in the
browser and is never sent to an external parser.

| Column      | Required value | Default | Validation                                      |
| ----------- | -------------- | ------- | ----------------------------------------------- |
| Title       | Yes            | None    | Same required-title rule as Add Story           |
| Description | No             | Blank   | Imported and rendered as inert plain text       |
| Link        | No             | Blank   | HTTPS or SharePoint-relative path beginning `/` |

The header must contain only `Title`, `Description`, and `Link`; matching is
trimmed and case-insensitive. Files may include a UTF-8 BOM, quoted commas,
escaped quotes, and quoted multiline descriptions. Blank rows are ignored.
Uploads are limited to 5 MB and 1,000 nonblank rows. Exact duplicate rows receive
a warning, while duplicate titles remain valid. Any invalid row disables import.
One confirmation creates all previewed stories as Ready with a common Added On
time and the current host as Added By, or creates none.
