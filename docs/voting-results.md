# Voting Results and Estimate Assignment

Revealing and assigning an estimate are separate synchronized transitions. The
round remains active in `Revealed` state between them so every client can review
the same result before a host records the team's decision.

## Reveal

The final required vote automatically reveals when at least one connected
participant exists and every connected participant has voted. Disconnected
Named participants remain visible but do not block reveal; Anonymous Presence
removes disconnected participants before eligibility is calculated. A host may
also select **Reveal Results** after at least one vote to reveal early.
Eligibility combines the synchronized roster state with live Fluid Presence so
a connected attendee still blocks reveal while a delayed roster update catches up.

Reveal freezes voting, records whether it was Automatic or Manual, captures the
voted and missing counts, and stops the optional timer. Named sessions associate
the revealed value or `Missing` state with each participant present at reveal.
Anonymous sessions expose only scale-ordered counts, percentages, voted count,
and missing count. Percentages use the number of submitted votes as the
denominator and are zero when no votes exist.

Automatic reveal never persists a participant or authenticated client as the
reveal actor in either voting mode. Its timestamp, counts, reason, and timer
stop derive deterministically from canonical persisted votes, so simultaneous
final votes or reconciliation attempts converge to the same non-personal audit
state. Manual host reveal remains a separate command and may record the host
already present in the team's host configuration.

The automatic eligibility command also runs after Named disconnects, Anonymous
participant-and-vote removal, Presence roster reconciliation, and converged
tree changes. It returns typed applied, already-revealed, not-eligible, stale,
or rejected outcomes and mutates only for the first eligible `Voting` state.
At least one connected participant must remain; every connected participant's
canonical vote must match the session scale. Reconnects and late joins cannot
reopen or add votes to an already Revealed round.

A host may select **Undo reveal** only while the current round is Revealed. The
round returns to Voting, reveal metadata is cleared, and existing votes plus the
stopped timer are preserved. Participants may change their selections, but undo
cannot retract results they already saw. Undo also records the canonical vote
operation baseline, preventing the unchanged votes from immediately triggering
another Automatic reveal. A changed vote clears that condition; the host may
always reveal manually.

The shared transition validator treats this as an explicit `undo-reveal`
recovery context. Standard transitions do not allow `Revealed -> Voting`, and
even the recovery context cannot reopen Finalized or Cancelled rounds or any
round in Ended history. The host command rechecks that the session is the
authoritative open Active session and that the Revealed round is still current.

## Final Estimate

Only a current host can choose the final estimate, and the choice must come from
the session's immutable scale snapshot. Choosing **Assign points** immediately
performs one Fluid transaction that:

- changes the round from `Revealed` to `Finalized`;
- records the assigned value and finalization audit fields;
- changes the source story from `Ready` to `Pointed`;
- updates the story's current estimate;
- appends one immutable history entry containing session and round IDs; and
- clears the active round so another Ready story can begin.

The transaction carries a stable operation ID. Retrying that operation is
idempotent and cannot duplicate history or the finalized-round index. While the
session remains Active, a host may
use the inline, right-aligned **Change points** action beside the assigned
estimate. The scale picker remains hidden until that action is selected;
**Save points** immediately applies the correction, while **Cancel** closes the
picker without mutation. The round and story receive the corrected value while
a new immutable history operation names the prior assignment it supersedes and
preserves the audit trail; the finalized-round index is not duplicated. If two
clients submit sibling corrections from the same prior assignment, the smallest
operation ID by code-unit order becomes canonical, independent of timestamps or
delivery order. SharePoint metadata is refreshed only after Fluid save
acknowledgement. If metadata refresh fails, retrying the same operation does not
duplicate history and retries the metadata projection.
