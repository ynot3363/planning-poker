import * as React from 'react';
import type { ServiceScope } from '@microsoft/sp-core-library';
import { DefaultButton, PrimaryButton } from '@fluentui/react/lib/Button';
import { LivePersona } from '../shell/LivePersona';
import { RoleGuard } from '../shell/RoleGuard';
import type { VotingResultsPresentation } from './results';
import styles from './VotingPage.module.scss';

/** Props for privacy-shaped revealed results and host assignment controls. */
export interface IVotingResultsPanelProps {
  readonly results: VotingResultsPresentation;
  readonly scaleValues: readonly string[];
  readonly isHost: boolean;
  readonly disabled: boolean;
  readonly selectedEstimate: string | undefined;
  readonly assignedValue: string | undefined;
  readonly isChangingEstimate: boolean;
  readonly serviceScope: ServiceScope;
  readonly webAbsoluteUrl: string | undefined;
  readonly onSelectEstimate: (value: string) => void;
  readonly onAssignEstimate: () => void;
  readonly onUndoReveal: () => void;
  readonly onStartChangingEstimate: () => void;
  readonly onCancelChangingEstimate: () => void;
}

/**
 * Renders accessible post-reveal results without crossing the session privacy boundary.
 *
 * @param props - Result projection, host capabilities, and estimate assignment state.
 * @returns Aggregate results, optional named rows, and host-only assignment controls.
 */
export function VotingResultsPanel(props: IVotingResultsPanelProps): React.ReactElement {
  return (
    <section className={styles.resultsPanel} aria-labelledby="voting-results-heading">
      <h3 id="voting-results-heading">Results</h3>
      <p>
        {props.results.reason} reveal · {props.results.votedCount} voted ·{' '}
        {props.results.missingCount} missing
      </p>
      <table className={styles.resultsTable}>
        <caption>Vote breakdown</caption>
        <thead>
          <tr>
            <th scope="col">Estimate</th>
            <th scope="col">Votes</th>
            <th scope="col">Percentage</th>
          </tr>
        </thead>
        <tbody>
          {props.results.breakdown.map((row) => (
            <tr key={row.value}>
              <th scope="row">{row.value}</th>
              <td>{row.count}</td>
              <td>{row.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {props.results.mode === 'Named' && (
        <table className={styles.resultsTable}>
          <caption>Named participant results</caption>
          <thead>
            <tr>
              <th scope="col">Participant</th>
              <th scope="col">Vote</th>
            </tr>
          </thead>
          <tbody>
            {props.results.rows.map((row) => (
              <tr key={row.participantId}>
                <th scope="row">
                  <LivePersona
                    displayName={row.displayName}
                    upn={row.upn}
                    imageUrl={createUserPhotoUrl(props.webAbsoluteUrl, row.upn)}
                    serviceScope={props.serviceScope}
                    ariaLabel={`${row.displayName}, revealed voter`}
                  />
                </th>
                <td>{row.value ?? 'Missing'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.assignedValue !== undefined && (
        <div className={styles.assignedEstimateRow}>
          <p className={styles.assignedEstimate} role="status">
            Final estimate: {props.assignedValue}
          </p>
          <RoleGuard allowed={props.isHost && !props.isChangingEstimate}>
            <DefaultButton disabled={props.disabled} onClick={props.onStartChangingEstimate}>
              Change points
            </DefaultButton>
          </RoleGuard>
        </div>
      )}
      <RoleGuard
        allowed={props.isHost && (props.assignedValue === undefined || props.isChangingEstimate)}
      >
        <fieldset className={styles.finalEstimateFieldset} disabled={props.disabled}>
          <legend>
            {props.assignedValue === undefined ? 'Final estimate' : 'Change final estimate'}
          </legend>
          <div className={styles.voteScale}>
            {props.scaleValues.map((value) => (
              <DefaultButton
                key={value}
                aria-label={`Select ${value} as final estimate`}
                aria-pressed={props.selectedEstimate === value}
                className={props.selectedEstimate === value ? styles.selectedVote : undefined}
                onClick={() => props.onSelectEstimate(value)}
              >
                {value}
              </DefaultButton>
            ))}
          </div>
        </fieldset>
        <div className={styles.finalEstimateActions}>
          <PrimaryButton
            disabled={
              props.disabled ||
              props.selectedEstimate === undefined ||
              props.selectedEstimate === props.assignedValue
            }
            onClick={props.onAssignEstimate}
          >
            {props.assignedValue === undefined ? 'Assign points' : 'Save points'}
          </PrimaryButton>
          {props.assignedValue === undefined && (
            <DefaultButton disabled={props.disabled} onClick={props.onUndoReveal}>
              Undo reveal
            </DefaultButton>
          )}
          {props.assignedValue !== undefined && (
            <DefaultButton disabled={props.disabled} onClick={props.onCancelChangingEstimate}>
              Cancel
            </DefaultButton>
          )}
        </div>
      </RoleGuard>
    </section>
  );
}

/**
 * Builds the same-site SharePoint user-photo endpoint for a revealed named voter.
 *
 * @param webAbsoluteUrl - Current SharePoint web URL.
 * @param upn - Normalized Microsoft 365 principal name.
 * @returns The encoded profile photo URL when host context is available.
 */
function createUserPhotoUrl(webAbsoluteUrl: string | undefined, upn: string): string | undefined {
  return webAbsoluteUrl === undefined || upn.length === 0
    ? undefined
    : `${webAbsoluteUrl.replace(/\/$/, '')}/_layouts/15/userphoto.aspx?size=S&accountname=${encodeURIComponent(upn)}`;
}
