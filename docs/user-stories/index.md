# Planning Poker User Story Index

This catalog defines the implementation sequence for the `PlanningPokerWebPart`.
Stories are ordered so that the data contract, SharePoint storage, and Fluid
repository exist before feature UI depends on them.

| ID     | Title                                                                | Brief description                                                                                                                               | Reuse and dependency notes                                                                                                                                                       |
| ------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-001 | Define the domain data model and SharedTree schema                   | Establish the versioned team, story, session, participant, vote, timer, and result contracts plus SharePoint metadata.                          | Foundation for every story; keep authenticated identity out of anonymous participant and vote records.                                                                           |
| US-002 | Provision PlanningPokerAppData storage                               | Discover or explicitly provision the hidden SharePoint library, metadata, permissions, ODSP drive, and persisted web part configuration.        | Depends on US-001 metadata decisions; provisioning runs only in page edit mode so properties can be saved, and hidden-library validation must select system drives.              |
| US-003 | Create and load team Fluid documents safely                          | Provide the repository that discovers, creates, validates, loads, synchronizes, and indexes one `.fluid` document per team.                     | Depends on US-001 and US-002; metadata is an index while Fluid remains the source of truth.                                                                                      |
| US-004 | Build the Microsoft 365 application shell                            | Replace the scaffold with a responsive Fluent UI shell, collapsible navigation, focused voting route, and About screen.                         | Depends on US-002 for the configuration gate; establishes the rounded, subtly elevated outer frame and shared visual rules for all UI stories.                                   |
| US-005 | Create and manage teams                                              | Let hosts create and edit teams, rosters, activity, scale, timer, and voting-mode settings while listing only hosted teams.                     | Depends on US-003 and US-004; team titles must be valid unique SharePoint file names, and timer input uses whole minutes while Fluid persists seconds.                           |
| US-006 | Deactivate and delete teams                                          | Let hosts preserve inactive teams or delete a team by sending its Fluid file to the site recycle bin.                                           | Depends on US-005; deletion is distinct from setting `isActive` to false.                                                                                                        |
| US-007 | Manage the story lifecycle                                           | Let hosts create and edit team stories and manage Ready, Pointed, and Archived tabs, including restore and re-pointing.                         | Depends on US-005; story transitions and estimate history come from US-001.                                                                                                      |
| US-008 | Import stories from CSV                                              | Provide a downloadable template, defensive CSV validation, preview, and bulk creation of Ready stories.                                         | Depends on US-007; Added By and Added On are system-owned and cannot be imported.                                                                                                |
| US-009 | Export the team story catalog                                        | Export Ready, Pointed, and Archived stories with current estimates and audit fields.                                                            | Depends on US-007; exports current story state, not individual votes.                                                                                                            |
| US-010 | Start and join a voting session                                      | Let a host create the team's only open session and let authenticated site users join through a shareable deep link.                             | Depends on US-003 through US-005 and uses the focused voting shell from US-004.                                                                                                  |
| US-011 | Manage named and anonymous participation                             | Synchronize Fluid Presence-backed participation while exposing identities in named mode and generated aliases/counts only in anonymous mode.    | Depends on US-010; disconnected Named participants remain without blocking reveal, while disconnected Anonymous participants are removed without persisting an identity mapping. |
| US-012 | Select stories and cast synchronized votes                           | Let hosts activate Ready stories and let joined participants cast or change scale-valid votes without early result disclosure.                  | Depends on US-007, US-010, and US-011; one active story round exists at a time.                                                                                                  |
| US-013 | Run the optional voting timer                                        | Give hosts synchronized start, stop, and reset controls while participants receive a read-only informational timer.                             | Depends on US-012; timer expiration never reveals results or closes voting.                                                                                                      |
| US-014 | Reveal results and assign points                                     | Reveal automatically after all connected participants vote or manually on host command, support host recovery, and assign scale-valid points.   | Depends on US-012 and optionally US-013; assignments save directly, and the inline Change points action reveals correction controls that append immutable history.               |
| US-015 | End sessions and export summaries                                    | End the session, clear the active-session marker, and export only finalized story summaries associated with its unique ID.                      | Depends on US-014; ended sessions are immutable history and never return stories to Ready automatically.                                                                         |
| US-016 | Protect story links and collaborative state from credentials         | Reject unsafe or credential-bearing story links at every boundary and prove runtime tokens never enter SharedTree.                              | Hardens US-001, US-003, US-007, US-009, US-012, and US-015; complete before relying on persisted or exported story links.                                                        |
| US-017 | Preserve anonymous identity privacy across session history           | Remove authenticated actor references from Anonymous session, round, and linked estimate-history records while preserving Named audit data.     | Supersedes the manual-reveal identity exception in US-014 and hardens US-001, US-011, US-014, and US-015.                                                                        |
| US-018 | Harden reconnect state and diagnostic redaction                      | Validate browser-restored participant IDs and ensure diagnostics cannot log credential-bearing error text.                                      | Hardens US-004 and US-011; browser reconnect tokens remain local-only and application-issued tokens remain runtime-only.                                                         |
| US-019 | Replace stale collection writes with intent-specific commands        | Mutate current SharedTree entities by intent instead of replacing collections assembled from stale UI snapshots.                                | Foundational concurrency remediation for US-005, US-007, US-010, US-012, and US-014; precedes US-020.                                                                            |
| US-020 | Make collaborative commands convergence-safe and idempotent          | Define deterministic uniqueness and retry semantics for sessions, rounds, votes, finalization, and history under concurrent Fluid clients.      | Depends on US-019; requires genuine two-container tests rather than multiple services over one synchronous fake root.                                                            |
| US-021 | Reconcile automatic reveal after collaborative changes               | Reevaluate idempotent automatic reveal after votes, Presence changes, and convergence so eligible rounds cannot remain stuck.                   | Depends on US-020 and hardens US-011 through US-014; manual zero-vote reveal is deliberately outside this story.                                                                 |
| US-022 | Synchronize SharePoint metadata conditionally                        | Use expected-state and ETag-aware metadata updates so stale clients cannot erase or overwrite newer discovery state.                            | Hardens US-003, US-005, US-010, US-014, and US-015; Fluid remains authoritative and conflicts reconcile from converged state.                                                    |
| US-023 | Preserve ended-session immutability and round transition consistency | Stop Presence writes after end and align the public transition guard with the documented Undo reveal path.                                      | Hardens US-014 and US-015; ended snapshots remain deeply immutable through disconnect, reconnect, page hide, and disposal.                                                       |
| US-024 | Validate Fluid documents before migration and use                    | Decode and validate complete persisted roots before schema upgrade or feature exposure, rejecting newer or corrupt documents non-destructively. | Hardens US-001 and US-003; application-version compatibility is checked before any stored-schema mutation.                                                                       |
| US-025 | Clean up Fluid resources and recover partial creation                | Dispose partially owned Fluid resources exactly once and make attached-but-unindexed team files recoverable.                                    | Hardens US-003 and US-005; failure-injection coverage spans create, attach, load, upgrade, snapshot, save, and metadata stages.                                                  |
| US-026 | Make team file renames retryable and reconcilable                    | Reconcile the physical drive filename, Fluid title, and metadata so retrying a failed rename repairs the file.                                  | Hardens US-003 and US-005; uses immutable Team ID as the recovery key and preserves history.                                                                                     |
| US-027 | Page complete team discovery results                                 | Follow every supported SharePoint continuation shape so discovery and lookup operations do not silently stop at the first page.                 | Hardens US-002, US-003, and US-005; all team-list consumers reuse one bounded, cancellation-aware paging path.                                                                   |
| US-028 | Share session links safely and accessibly                            | Build invitation URLs from trusted allow-listed parts and provide Web Share, clipboard, and selectable manual-copy behavior.                    | Hardens US-004 and US-010; in-page navigation may preserve unrelated parameters, but invitation links never inherit arbitrary query or fragment state.                           |
| US-029 | Make the UI multi-instance, semantic, RTL, and form-error safe       | Ensure one main landmark per instance, unique IDs, inherited direction, logical styling, and programmatically associated validation errors.     | Hardens US-004, US-005, US-008, and the focused voting UI; validate two web parts in one document and RTL/assistive-technology behavior.                                         |

## Recommended Implementation Order

Implement US-001 through US-015 in numeric order. US-008 and US-009 may proceed
in parallel after US-007. US-013 may proceed alongside the core voting work
after US-012, but US-014 must integrate with the final timer contract.

For audit remediation, implement US-016 before exporting or rendering existing
story links. Implement US-025 before US-024 and any migration work. Implement
US-019 before US-020, then US-021. US-022, US-023, and US-026 through US-029 may
proceed in parallel when their stated dependencies are respected.

## Cross-Cutting Decisions

- The solution uses SPFx 1.23.2, React 17, Fluent UI v8, and Fluid Framework
  2.111 as currently pinned by the repository.
- `PlanningPokerAppData` is a hidden site library containing one Fluid document per
  team. The file name is the team title plus `.fluid`.
- SharePoint metadata supports discovery; the Fluid document is the source of
  truth for team, story, and session state.
- Site-permission groups receive at least Contribute on the hidden library. Host
  restrictions are application behavior, not a tamper-proof authorization
  boundary. Schema validation detects incompatible data but does not prove that
  compatible data was not deliberately altered.
- Team administrative screens list only teams where the current user is a host.
  Configured members and authenticated site users invited by a voting link may
  join a session.
- Story states are Ready, Pointed, and Archived. Team activity is a separate
  boolean and team deletion sends the Fluid file to the site recycle bin.
- Fibonacci values are `0`, `0.5`, `1`, `2`, `3`, `5`, and `8`. T-shirt values
  are `XS`, `S`, `M`, `L`, `XL`, and `XXL`. Neither scale includes `?`.
- A team has at most one Lobby or Active voting session. An anonymous session
  publishes only aliases such as `Participant 1` and never stores a link from
  an alias to the authenticated user.
- Application-issued AAD, ODSP storage, and websocket tokens are runtime-only
  values and must never be copied into SharedTree. Credential-bearing story and
  invitation URLs are rejected or rebuilt before persistence, rendering, or
  sharing.
- Anonymous session, round, and session-linked estimate-history records omit
  authenticated actor references. Named sessions retain their documented audit
  identities.
- Local SharedTree transactions are not distributed locks. Collaborative
  uniqueness and idempotence require deterministic convergent state plus real
  two-container validation.
