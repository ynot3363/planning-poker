# US-013: Run the Optional Voting Timer

## User Story

As a voting-session host, I want to start, stop, and reset a synchronized timer
so participants have a shared pacing aid without the timer controlling results.

## Description

Add the optional per-round informational timer from the session settings
snapshot. Hosts receive controls; participants receive a read-only remaining
time and status. Persist timestamp-based state transitions rather than writing
every second. Expiration has no effect on votes, reveal, finalization, or the
session lifecycle.

## Public API

Provide typed commands and selectors for:

- `startTimer(roundId)`;
- `stopTimer(roundId)` preserving calculated remaining duration;
- `resetTimer(roundId)` restoring configured duration and Ready state;
- remaining seconds and Ready/Running/Stopped/Expired presentation state derived
  from the US-001 persisted timer contract and a clock abstraction.

## Acceptance Criteria

- Teams with timer disabled render no timer controls and no misleading timer
  placeholder in the voting experience.
- A newly selected round initializes the timer to the session-snapshot duration
  in Ready state; it does not start automatically.
- Hosts can start, stop, resume, and reset. Participants see the same status and
  remaining time but no enabled timer commands.
- Start/stop/reset are accepted only for a current Active-session round and are
  transactionally guarded against stale or duplicate commands.
- Running clients calculate countdown locally from an authoritative start time
  and remaining-at-start value; Fluid is not mutated every second.
- Stop persists the consistently calculated remaining duration. Resume starts
  from it. Reset restores the full configured duration.
- Refresh, delayed subscription, reconnect, and clients with reasonable local
  clock skew converge using the authoritative state/timestamp contract.
- Reaching zero displays an accessible expired/zero state and optional amber
  warning but does not reveal results, lock/change votes, assign points, select
  another story, or end the session.
- Reveal/finalization stops the current timer for history/display, and a new
  round receives a fresh timer.
- Time is displayed with a screen-reader-friendly label; updates are not
  announced every second, and reduced-motion/high-contrast settings are
  respected.

## Tests

- Unit-test Ready, start, tick derivation, stop, resume, reset, expire, refresh,
  reveal-stop, invalid command, and clock-skew scenarios using fake time.
- Component-test host controls, participant read-only state, disabled team
  setting, warning state, keyboard behavior, and non-disruptive announcements.
- Multi-client tests verify synchronized commands without per-second Fluid
  operations.
- Regression-test that zero never invokes reveal or vote closure.

## Documentation and Examples

- Explain timer configuration, controls, synchronization, and its strictly
  informational behavior in the About experience.
- Add Ready, Running, Stopped, Expired, disabled, host, and participant examples.

## Dependencies

- US-001 defines reconstructable timer state.
- US-005 configures timer defaults.
- US-012 supplies the active voting round.

## Implementation Notes

- Inject a clock into pure timer selectors and commands.
- Use one local interval per mounted timer view and always clean it up.
- Do not persist formatted time strings.
- Consume the persisted seconds produced by US-005's whole-minute team input;
  voting timer state and countdown selectors remain second-based.
