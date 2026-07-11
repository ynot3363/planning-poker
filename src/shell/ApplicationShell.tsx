import * as React from 'react';
import type { IReadonlyTheme } from '@microsoft/sp-component-base';
import type { ServiceScope } from '@microsoft/sp-core-library';
import { ActionButton, DefaultButton, IconButton } from '@fluentui/react/lib/Button';
import { initializeIcons } from '@fluentui/react/lib/Icons';
import { MessageBar, MessageBarType } from '@fluentui/react/lib/MessageBar';
import { LayerHost } from '@fluentui/react/lib/Layer';
import { TooltipHost } from '@fluentui/react/lib/Tooltip';
import type {
  IPlanningPokerRoute,
  PlanningPokerRouteNotice,
  PlanningPokerView
} from './planningPokerRoute';
import { ContentCard, PageHeading, StatusState } from './ShellPrimitives';
import { LivePersona } from './LivePersona';
import { TeamsPage } from '../teams/TeamsPage';
import type { UserReference } from '../domain/planningPokerDomain';
import type { ITeamManagementService } from '../teams/teamManagementService';
import type { IPlanningPokerPeopleService } from '../teams/sharePointPeopleService';
import { StoriesPage } from '../stories/StoriesPage';
import type { IStoryManagementService } from '../stories/storyManagement';
import { VotingPage } from '../voting/VotingPage';
import type { IVotingSessionService } from '../voting/sessionManagement';
import styles from './ApplicationShell.module.scss';

initializeIcons();

let nextShellLayerId = 0;

/** Identifies the current user without treating display data as authorization. */
export interface IPlanningPokerCurrentUser {
  /** Display name supplied by the Microsoft 365 host. */
  readonly displayName: string;
  /** Microsoft 365 user principal name used to load the live persona card. */
  readonly upn: string;
  /** SharePoint-hosted profile photo URL. */
  readonly imageUrl?: string;
}

/** Defines the configured Microsoft 365 application shell. */
export interface IApplicationShellProps {
  /** Validated application route. */
  readonly route: IPlanningPokerRoute;
  /** Whether the navigation rail is currently icon-only. */
  readonly isNavigationCollapsed: boolean;
  /** Current SharePoint theme. */
  readonly theme?: IReadonlyTheme;
  /** Configuration state supplied by the web-part boundary. */
  readonly configurationStatus: 'configured';
  /** Current user display data supplied by the Microsoft 365 host. */
  readonly currentUser: IPlanningPokerCurrentUser;
  /** SPFx service scope consumed by Microsoft 365 host components. */
  readonly serviceScope: ServiceScope;
  /** Team administration dependencies when the host has initialized US-005 services. */
  readonly teamManagement?: {
    /** Stable current identity used for host checks and defaults. */
    readonly currentUser: UserReference;
    /** Hosted-team workflow service. */
    readonly service: ITeamManagementService;
    /** SharePoint people resolver used by team forms. */
    readonly peopleService: IPlanningPokerPeopleService;
    /** Hosted story-catalog workflow service. */
    readonly storyService: IStoryManagementService;
    /** Synchronized session-entry workflow service. */
    readonly votingService: IVotingSessionService;
  };
  /** Safe initialization error when authenticated team services are unavailable. */
  readonly teamManagementError?: string;
  /** Optional reason route values fell back safely. */
  readonly routeNotice?: PlanningPokerRouteNotice;
  /** Selects a validated application route. */
  readonly onNavigate: (route: IPlanningPokerRoute) => void;
  /** Toggles expanded and icon-only navigation. */
  readonly onToggleNavigation: () => void;
}

interface INavigationItem {
  readonly view: PlanningPokerView;
  readonly label: string;
  readonly iconName: string;
}

const NAVIGATION_ITEMS: readonly INavigationItem[] = [
  { view: 'Teams', label: 'Teams', iconName: 'Group' },
  { view: 'Stories', label: 'Stories', iconName: 'PageList' },
  { view: 'Voting', label: 'Voting', iconName: 'CheckboxComposite' },
  { view: 'About', label: 'About', iconName: 'Info' }
];

const ROUTE_NOTICE_TEXT: Readonly<Record<PlanningPokerRouteNotice, string>> = {
  'invalid-view': 'That Planning Poker destination is not available. Teams was opened instead.',
  'invalid-identifier':
    'The voting link contains an invalid team or session identifier. A safe view was opened instead.',
  'incomplete-voting-link':
    'The voting link is incomplete. Ask the session host for a link containing both team and session identifiers.'
};

/**
 * Renders temporary feature guidance while later user stories supply business screens.
 *
 * @param props - Placeholder title and supporting explanation.
 * @param props.title - Visible empty-state title.
 * @param props.description - Visible next-step guidance.
 * @returns The shared empty-state card.
 */
function FeaturePlaceholder(props: {
  readonly title: string;
  readonly description: string;
}): React.ReactElement {
  return (
    <ContentCard>
      <StatusState kind="empty" title={props.title} description={props.description} />
    </ContentCard>
  );
}

/**
 * Renders the complete help content required by the shell contract.
 *
 * @returns The About destination content.
 */
function AboutView(): React.ReactElement {
  return (
    <div className={styles.cardGrid}>
      <ContentCard label="Stories and sessions">
        <h2>Stories and sessions</h2>
        <p>
          Hosts create or import stories and organize them as Ready, Pointed, or Archived. Restoring
          an archived story or returning a pointed story to Ready keeps its estimate history. Only
          Ready stories can enter a new voting round. Hosts can download the CSV template, preview a
          completed file locally, and confirm one all-or-nothing bulk import. Archive preserves a
          story history, while Delete permanently removes it after confirmation. Export all stories
          downloads the current catalog and estimates without votes or participant details.
        </p>
      </ContentCard>
      <ContentCard label="Named and anonymous voting">
        <h2>Named and anonymous voting</h2>
        <p>
          Named voting shows participant identities after reveal. Anonymous voting uses generated
          aliases and never stores a reversible mapping from an alias to an authenticated user.
          SharePoint permissions remain the real access boundary.
        </p>
      </ContentCard>
      <ContentCard label="Results and exports" tone="success">
        <h2>Results and exports</h2>
        <p>
          The host reveals votes and deliberately assigns a valid estimate. Story and ended-session
          exports contain the documented summaries; session-result exports exclude participant
          identities and individual vote records.
        </p>
      </ContentCard>
      <ContentCard label="Host and participant capabilities" tone="warning">
        <h2>Host and participant capabilities</h2>
        <p>
          Hosts manage teams, stories, sessions, reveal, final estimates, and completion.
          Participants join active sessions and cast votes. Hiding host controls is application
          behavior, not a substitute for SharePoint authorization.
        </p>
      </ContentCard>
      <ContentCard label="Team configuration">
        <h2>Team configuration</h2>
        <p>
          A team needs a valid SharePoint file title and at least one host. Configured members are
          the expected roster, but they do not prevent another authenticated site user from joining
          through a session link.
        </p>
      </ContentCard>
      <ContentCard label="Scales, timer, and activity">
        <h2>Scales, timer, and activity</h2>
        <p>
          Choose the fixed Fibonacci or T-shirt scale, or arrange two to twenty unique custom values
          such as 1, 2, 4, and 8. The optional timer supports 1 to 60 minutes. Inactive teams remain
          editable but cannot start new voting sessions.
        </p>
      </ContentCard>
      <ContentCard label="Action guidance">
        <h2>Action guidance</h2>
        <p>
          Each screen emphasizes one primary next action. Supporting actions use quieter treatments,
          and destructive actions always require a clearly explained confirmation.
        </p>
      </ContentCard>
    </div>
  );
}

/**
 * Renders the selected shell destination without implementing later feature stories.
 *
 * @param props - Validated shell state and callbacks.
 * @returns The content for the selected destination.
 */
function ShellView(
  props: IApplicationShellProps & { readonly panelLayerHostId: string }
): React.ReactElement {
  if (props.route.view === 'About') {
    return <AboutView />;
  }
  if (props.route.view === 'Voting' && props.route.focusedVoting) {
    if (props.teamManagement !== undefined) {
      return (
        <VotingPage
          service={props.teamManagement.votingService}
          teamId={props.route.teamId}
          sessionId={props.route.sessionId}
          onOpenSession={(teamId, sessionId) =>
            props.onNavigate({ view: 'Voting', teamId, sessionId, focusedVoting: true })
          }
        />
      );
    }
    return (
      <StatusState
        kind="error"
        title="Voting could not be initialized"
        description={
          props.teamManagementError ?? 'Verify the collaboration connection and reload the page.'
        }
      />
    );
  }
  if (props.route.view === 'Stories') {
    if (props.teamManagement !== undefined) {
      return (
        <StoriesPage
          currentUser={props.teamManagement.currentUser}
          service={props.teamManagement.storyService}
          selectedTeamId={props.route.teamId}
          panelLayerHostId={props.panelLayerHostId}
          onSelectTeam={(teamId) =>
            props.onNavigate({ view: 'Stories', teamId, focusedVoting: false })
          }
          onNavigateTeams={() => props.onNavigate({ view: 'Teams', focusedVoting: false })}
        />
      );
    }
    return (
      <StatusState
        kind="error"
        title="Stories could not be initialized"
        description={
          props.teamManagementError ?? 'Verify the collaboration connection and reload the page.'
        }
      />
    );
  }
  if (props.route.view === 'Voting') {
    if (props.teamManagement !== undefined) {
      return (
        <VotingPage
          service={props.teamManagement.votingService}
          onOpenSession={(teamId, sessionId) =>
            props.onNavigate({ view: 'Voting', teamId, sessionId, focusedVoting: true })
          }
        />
      );
    }
    return (
      <StatusState
        kind="error"
        title="Voting could not be initialized"
        description={
          props.teamManagementError ?? 'Verify the collaboration connection and reload the page.'
        }
      />
    );
  }
  if (props.teamManagement !== undefined) {
    return <TeamsPage {...props.teamManagement} panelLayerHostId={props.panelLayerHostId} />;
  }
  if (props.teamManagementError !== undefined) {
    return (
      <StatusState
        kind="error"
        title="Teams could not be initialized"
        description={props.teamManagementError}
      />
    );
  }
  return (
    <FeaturePlaceholder
      title="No teams to show yet"
      description="Team creation and management will appear here after the team workflow is added."
    />
  );
}

/**
 * Returns the heading description for a validated route.
 *
 * @param route - The selected validated route.
 * @returns Concise guidance for the route heading.
 */
function getViewDescription(route: IPlanningPokerRoute): string {
  if (route.focusedVoting) {
    return 'Collaborate on the current story without leaving the session context.';
  }
  if (route.view === 'About') {
    return 'Learn how Planning Poker works for hosts and participants.';
  }
  if (route.view === 'Stories') {
    return 'Prepare and organize the work your team will estimate.';
  }
  if (route.view === 'Voting') {
    return 'Join a synchronized estimation session from a host-provided link.';
  }
  return 'Create and manage the teams that estimate work together.';
}

/**
 * Renders the responsive, accessible Microsoft 365 application shell.
 *
 * @param props - Validated route, host context, state, and navigation callbacks.
 * @returns The configured application shell.
 */
export function ApplicationShell(props: IApplicationShellProps): React.ReactElement {
  const mainRegion = React.useRef<HTMLElement>(null);
  const [panelLayerHostId] = React.useState(
    () => `planning-poker-panel-layer-${nextShellLayerId++}`
  );
  const previousRoute = React.useRef(props.route);
  React.useEffect(() => {
    if (previousRoute.current !== props.route) {
      mainRegion.current?.focus();
      previousRoute.current = props.route;
    }
  }, [props.route]);

  const handleViewSelection = (view: PlanningPokerView): void => {
    props.onNavigate({ view, focusedVoting: false });
  };
  const handleLeaveFocusedVoting = (): void => {
    props.onNavigate({ view: 'Voting', focusedVoting: false });
  };
  const headingId = `planning-poker-${props.route.view.toLocaleLowerCase()}-heading`;
  const isFocused = props.route.focusedVoting;
  return (
    <div
      className={`${styles.shell} ${isFocused ? styles.focusedShell : ''}`}
      data-configuration={props.configurationStatus}
      data-theme={props.theme?.isInverted === true ? 'dark' : 'light'}
      dir="auto"
    >
      {!isFocused && (
        <aside
          className={`${styles.navigationRail} ${
            props.isNavigationCollapsed ? styles.navigationCollapsed : ''
          }`}
        >
          <div className={styles.navigationHeader}>
            {!props.isNavigationCollapsed && (
              <span className={styles.productName}>Planning Poker</span>
            )}
            <TooltipHost
              content={props.isNavigationCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              <IconButton
                iconProps={{
                  iconName: props.isNavigationCollapsed ? 'DoubleChevronRight' : 'DoubleChevronLeft'
                }}
                ariaLabel={
                  props.isNavigationCollapsed ? 'Expand navigation' : 'Collapse navigation'
                }
                onClick={props.onToggleNavigation}
              />
            </TooltipHost>
          </div>
          <nav aria-label="Planning Poker">
            <ul className={styles.navigationList}>
              {NAVIGATION_ITEMS.map((item) => {
                const isSelected = props.route.view === item.view;
                return (
                  <li key={item.view}>
                    {props.isNavigationCollapsed ? (
                      <TooltipHost content={item.label}>
                        <IconButton
                          className={isSelected ? styles.navigationSelected : undefined}
                          iconProps={{ iconName: item.iconName }}
                          ariaLabel={item.label}
                          aria-current={isSelected ? 'page' : undefined}
                          onClick={() => handleViewSelection(item.view)}
                        />
                      </TooltipHost>
                    ) : (
                      <ActionButton
                        className={`${styles.navigationButton} ${
                          isSelected ? styles.navigationSelected : ''
                        }`}
                        iconProps={{ iconName: item.iconName }}
                        aria-current={isSelected ? 'page' : undefined}
                        onClick={() => handleViewSelection(item.view)}
                      >
                        {item.label}
                      </ActionButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={styles.currentUser}>
            <LivePersona
              className={styles.currentUserPersona}
              displayName={props.currentUser.displayName}
              upn={props.currentUser.upn}
              imageUrl={props.currentUser.imageUrl}
              serviceScope={props.serviceScope}
              hideDetails={props.isNavigationCollapsed}
            />
          </div>
        </aside>
      )}
      <main
        ref={mainRegion}
        className={styles.mainContent}
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <PageHeading
          id={headingId}
          title={isFocused ? 'Focused voting' : props.route.view}
          description={getViewDescription(props.route)}
          actions={
            isFocused ? (
              <DefaultButton iconProps={{ iconName: 'Back' }} onClick={handleLeaveFocusedVoting}>
                Leave session
              </DefaultButton>
            ) : undefined
          }
        />
        {props.routeNotice !== undefined && (
          <MessageBar
            className={styles.routeNotice}
            messageBarType={MessageBarType.warning}
            isMultiline
            delayedRender={false}
          >
            {ROUTE_NOTICE_TEXT[props.routeNotice]}
          </MessageBar>
        )}
        <ShellView {...props} panelLayerHostId={panelLayerHostId} />
      </main>
      <LayerHost id={panelLayerHostId} className={styles.panelLayerHost} />
    </div>
  );
}
