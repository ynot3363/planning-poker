# US-014: Reveal Results and Assign Points

## User Story

As a voting-session host, I want to reveal the team's votes and record the
agreed estimate so the story receives a transparent, deliberate point value.

## Description

Reveal a Voting round automatically when every connected eligible participant has
voted or manually when a host selects Reveal Results. Revealing freezes voting
and displays a summary breakdown. Named mode may associate each joined person
with their revealed vote; Anonymous mode displays only aggregate value counts
and percentages. The host then records the team's chosen scale value rather than
having the application calculate a final estimate automatically.

## Public API

Provide typed commands/selectors for:

- `canAutoReveal(round, connectedParticipants)`;
- host `revealResults(roundId)`;
- host `undoReveal(roundId)` for the current Revealed round;
- idempotent automatic reveal after the final required vote;
- named and anonymous post-reveal result projections;
- host `finalizeEstimate(roundId, scaleValue)`;
- host revision of a finalized estimate through the same scale-valid assignment contract;
- aggregate count/percentage/missing-voter summary;
- immutable estimate-history creation.

## Acceptance Criteria

- Automatic reveal requires at least one connected eligible participant and one
  valid current-round vote from every connected participant. Disconnected Named
  participants remain visible but do not block reveal; disconnected Anonymous
  participants are removed by US-011 Presence handling.
- The final required vote reveals exactly once under concurrent clients.
- A host may choose Reveal Results before all participants vote; the reveal
  records voted and missing counts and is synchronized for all clients.
- Reveal Results is a primary host action when manual reveal is meaningful and
  is not available to participants.
- Revealing changes the round to Revealed, freezes all votes, stops the optional
  timer, records reveal actor/time/reason, and does not assign points yet.
- A host may undo the current reveal before finalization. Reopening preserves
  submitted votes and the stopped timer, clears reveal audit fields, and cannot
  make results that participants already saw private again.
- Named mode displays each joined participant's revealed choice plus aggregate
  counts. Anonymous mode displays only aggregate value counts, percentages, and
  total/missing counts; no identity or alias list is shown.
- Breakdown values with votes follow session scale order; zero-count choices are
  omitted from the results table.
- The host selects the final estimate only from the session scale snapshot. The
  application does not use average, median, majority, or another automatic rule
  as the decision.
- Selecting a scale value and choosing Assign points saves immediately without
  a separate confirmation dialog. Finalization changes the round to Finalized,
  changes the story from Ready to Pointed, sets current estimate, appends
  immutable estimate history with session/round IDs, and updates Last Activity
  in one transaction.
- Finalization is idempotent for the same value. A host may change a finalized
  value while the session remains Active; the story and round receive the new
  value and immutable estimate history retains both the original assignment and
  the correction.
- Finalized results place Change points inline to the right of the assigned
  estimate. The correction scale remains hidden until the host chooses Change
  points; Save points applies the selected correction directly and Cancel closes
  the picker without changing the estimate.
- The finalized story disappears from later eligible-story selectors. A later
  host action from US-007 may return it to Ready without erasing history.
- Participants joining after reveal may view the revealed result but do not
  become eligible to vote in that completed round.
- Result cards/charts include equivalent text/table information, do not rely on
  color alone, and meet keyboard, zoom, high-contrast, and screen-reader needs.

## Tests

- Unit-test all-voted calculation, zero participants, manual/automatic reveal,
  concurrent idempotency, scale-ordered breakdowns, percentages, missing votes,
  privacy projections, and finalization guards.
- Test named output with identities and anonymous output recursively for absence
  of identity and alias rows.
- Service-test atomic story/round/history mutation, reveal undo, finalized-value
  correction, and retry after save failure.
- Multi-client component tests verify final-vote reveal, manual early reveal,
  reveal undo, frozen votes, shared breakdown, final assignment and correction,
  and story ineligibility.
- Accessibility-test breakdown tables/cards, direct assignment, and the
  expandable correction controls.

## Documentation and Examples

- Explain automatic versus manual reveal, frozen votes, named/anonymous result
  differences, reveal recovery, and host-selected or corrected final estimates.
- Add examples for unanimous, split, early reveal with missing voters, named,
  anonymous, and finalized states.

## Dependencies

- US-011 defines eligible joined participants and privacy projections.
- US-012 provides votes and active round state.
- US-013 provides optional timer stop behavior.
- US-007 owns later re-pointing behavior.

## Implementation Notes

- Compute percentages from vote counts and define zero-vote behavior explicitly;
  do not persist redundant percentages.
- Keep reveal and finalization as separate transactions and visible states.
- Reopening is allowed only from the active Revealed round. Finalized corrections
  append history and must not duplicate `finalizedRoundIds`.
- Do not update SharePoint metadata with individual values or vote breakdowns.
