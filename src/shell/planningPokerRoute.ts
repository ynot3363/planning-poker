/** The supported top-level Planning Poker views. */
export type PlanningPokerView = 'Teams' | 'Stories' | 'Voting' | 'About';

/** Represents validated, bookmarkable Planning Poker route state. */
export interface IPlanningPokerRoute {
  /** The top-level view to render. */
  readonly view: PlanningPokerView;
  /** The validated team identifier, when a team is selected. */
  readonly teamId?: string;
  /** The validated session identifier, when a voting session is selected. */
  readonly sessionId?: string;
  /** Whether the route identifies a specific team voting session. */
  readonly focusedVoting: boolean;
}

/** Describes a safe routing fallback that should be explained to the user. */
export type PlanningPokerRouteNotice =
  | 'invalid-view'
  | 'invalid-identifier'
  | 'incomplete-voting-link';

/** Combines validated route state with an optional non-sensitive fallback reason. */
export interface IPlanningPokerRouteResult {
  /** The route that the application can render safely. */
  readonly route: IPlanningPokerRoute;
  /** The reason untrusted route values could not be used, when applicable. */
  readonly notice?: PlanningPokerRouteNotice;
}

const VIEW_PARAMETER = 'planningPokerView';
const TEAM_PARAMETER = 'planningPokerTeam';
const SESSION_PARAMETER = 'planningPokerSession';
const ROUTE_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Accepts only bounded opaque identifiers that are safe to pass to repository lookups.
 *
 * @param value - The untrusted query-string value.
 * @returns The validated identifier, or `undefined` when the value is absent or malformed.
 */
function parseIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && ROUTE_IDENTIFIER.test(value) ? value : undefined;
}

/**
 * Parses namespaced query parameters without allowing them to compete with SharePoint routing.
 *
 * @param search - The current query string, with or without a leading question mark.
 * @returns A validated route that safely falls back to the teams view.
 */
export function readPlanningPokerRoute(search: string): IPlanningPokerRouteResult {
  const parameters = new URLSearchParams(search);
  const requestedView = parameters.get(VIEW_PARAMETER);
  const requestedTeamId = parameters.get(TEAM_PARAMETER);
  const requestedSessionId = parameters.get(SESSION_PARAMETER);
  const teamId = parseIdentifier(requestedTeamId);
  const sessionId = parseIdentifier(requestedSessionId);
  const focusedVoting = teamId !== undefined && sessionId !== undefined;
  const isKnownView =
    requestedView === null ||
    requestedView === 'Teams' ||
    requestedView === 'Stories' ||
    requestedView === 'Voting' ||
    requestedView === 'About';
  let notice: PlanningPokerRouteNotice | undefined;
  if (!isKnownView) {
    notice = 'invalid-view';
  } else if (
    (requestedTeamId !== null && teamId === undefined) ||
    (requestedSessionId !== null && sessionId === undefined)
  ) {
    notice = 'invalid-identifier';
  } else if (sessionId !== undefined && teamId === undefined) {
    notice = 'incomplete-voting-link';
  } else if (requestedView === 'Voting' && (teamId === undefined) !== (sessionId === undefined)) {
    notice = 'incomplete-voting-link';
  }
  return {
    route: {
      view:
        focusedVoting || requestedView === 'Voting'
          ? 'Voting'
          : requestedView === 'Stories'
            ? 'Stories'
            : requestedView === 'About'
              ? 'About'
              : 'Teams',
      teamId,
      sessionId,
      focusedVoting
    },
    notice
  };
}

/**
 * Parses namespaced query parameters into safe Planning Poker route state.
 *
 * @param search - The current query string, with or without a leading question mark.
 * @returns The validated route, falling back to Teams when necessary.
 */
export function parsePlanningPokerRoute(search: string): IPlanningPokerRoute {
  return readPlanningPokerRoute(search).route;
}

/**
 * Writes Planning Poker route state while preserving unrelated SharePoint query parameters.
 *
 * @param currentSearch - The current query string.
 * @param route - The validated application route to write.
 * @returns The updated query string without a leading question mark.
 */
export function writePlanningPokerRoute(currentSearch: string, route: IPlanningPokerRoute): string {
  const parameters = new URLSearchParams(currentSearch);
  parameters.set(VIEW_PARAMETER, route.view);
  if (route.teamId !== undefined && ROUTE_IDENTIFIER.test(route.teamId)) {
    parameters.set(TEAM_PARAMETER, route.teamId);
  } else {
    parameters.delete(TEAM_PARAMETER);
  }
  if (route.sessionId !== undefined && ROUTE_IDENTIFIER.test(route.sessionId)) {
    parameters.set(SESSION_PARAMETER, route.sessionId);
  } else {
    parameters.delete(SESSION_PARAMETER);
  }
  return parameters.toString();
}
