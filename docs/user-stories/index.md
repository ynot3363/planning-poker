# Planning Poker User Story Index

This catalog defines the implementation sequence for the `PlanningPokerWebPart`.
Stories are ordered so that the data contract, SharePoint storage, and Fluid
repository exist before feature UI depends on them.

| ID     | Title                                              | Brief description                                                                                                                          | Reuse and dependency notes                                                                                                                                          |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-001 | Define the domain data model and SharedTree schema | Establish the versioned team, story, session, participant, vote, timer, and result contracts plus SharePoint metadata.                     | Foundation for every story; keep authenticated identity out of anonymous participant and vote records.                                                              |
| US-002 | Provision PlanningPokerAppData storage             | Discover or explicitly provision the hidden SharePoint library, metadata, permissions, ODSP drive, and persisted web part configuration.   | Depends on US-001 metadata decisions; provisioning runs only in page edit mode so properties can be saved, and hidden-library validation must select system drives. |
| US-003 | Create and load team Fluid documents safely        | Provide the repository that discovers, creates, validates, loads, synchronizes, and indexes one `.fluid` document per team.                | Depends on US-001 and US-002; metadata is an index while Fluid remains the source of truth.                                                                         |
| US-004 | Build the Microsoft 365 application shell          | Replace the scaffold with a responsive Fluent UI shell, collapsible navigation, focused voting route, and About screen.                    | Depends on US-002 for the configuration gate; establishes the rounded, subtly elevated outer frame and shared visual rules for all UI stories.                      |
| US-005 | Create and manage teams                            | Let hosts create and edit teams, rosters, activity, scale, timer, and voting-mode settings while listing only hosted teams.                | Depends on US-003 and US-004; team titles must be valid unique SharePoint file names, and timer input uses whole minutes while Fluid persists seconds.              |
| US-006 | Deactivate and delete teams                        | Let hosts preserve inactive teams or delete a team by sending its Fluid file to the site recycle bin.                                      | Depends on US-005; deletion is distinct from setting `isActive` to false.                                                                                           |
| US-007 | Manage the story lifecycle                         | Let hosts create and edit team stories and manage Ready, Pointed, and Archived tabs, including restore and re-pointing.                    | Depends on US-005; story transitions and estimate history come from US-001.                                                                                         |
| US-008 | Import stories from CSV                            | Provide a downloadable template, defensive CSV validation, preview, and bulk creation of Ready stories.                                    | Depends on US-007; Added By and Added On are system-owned and cannot be imported.                                                                                   |
| US-009 | Export the team story catalog                      | Export Ready, Pointed, and Archived stories with current estimates and audit fields.                                                       | Depends on US-007; exports current story state, not individual votes.                                                                                               |
| US-010 | Start and join a voting session                    | Let a host create the team's only open session and let authenticated site users join through a shareable deep link.                        | Depends on US-003 through US-005 and uses the focused voting shell from US-004.                                                                                     |
| US-011 | Manage named and anonymous participation           | Synchronize the joined roster while exposing identities in named mode and generated aliases/counts only in anonymous mode.                 | Depends on US-010; anonymous records must never contain an authenticated identity mapping.                                                                          |
| US-012 | Select stories and cast synchronized votes         | Let hosts activate Ready stories and let joined participants cast or change scale-valid votes without early result disclosure.             | Depends on US-007, US-010, and US-011; one active story round exists at a time.                                                                                     |
| US-013 | Run the optional voting timer                      | Give hosts synchronized start, stop, and reset controls while participants receive a read-only informational timer.                        | Depends on US-012; timer expiration never reveals results or closes voting.                                                                                         |
| US-014 | Reveal results and assign points                   | Reveal automatically after all joined participants vote or manually on host command, summarize votes, and finalize a scale-valid estimate. | Depends on US-012 and optionally US-013; finalization moves the story to Pointed and preserves history.                                                             |
| US-015 | End sessions and export summaries                  | End the session, clear the active-session marker, and export only finalized story summaries associated with its unique ID.                 | Depends on US-014; ended sessions are immutable history and never return stories to Ready automatically.                                                            |

## Recommended Implementation Order

Implement the stories in numeric order. US-008 and US-009 may proceed in
parallel after US-007. US-013 may proceed alongside the core voting work after
US-012, but US-014 must integrate with the final timer contract.

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
