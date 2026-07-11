import type { PointingStory, StoryStatus } from '../domain/planningPokerDomain';

/** Ordered public story-catalog export columns. */
export const STORY_EXPORT_COLUMNS = [
  'Story ID',
  'Title',
  'Description',
  'Link',
  'Status',
  'Added By',
  'Added On',
  'Current Point Value',
  'Current Point Session ID',
  'Last Pointed On'
] as const;

/** One public story-catalog export row without voting or participant details. */
export interface StoryCatalogExportRow {
  readonly storyId: string;
  readonly title: string;
  readonly description: string;
  readonly link: string;
  readonly status: StoryStatus;
  readonly addedBy: string;
  readonly addedOn: string;
  readonly currentPointValue: string;
  readonly currentPointSessionId: string;
  readonly lastPointedOn: string;
}

/**
 * Maps current stories to the intentionally narrow public export contract.
 *
 * @param stories - Consistent plain story snapshot.
 * @returns One current-state row per story in source order.
 */
export function createStoryCatalogExportRows(
  stories: readonly PointingStory[]
): readonly StoryCatalogExportRow[] {
  return stories.map((story) => {
    const latestEstimate =
      story.currentEstimate === undefined
        ? undefined
        : story.estimateHistory[story.estimateHistory.length - 1];
    return {
      storyId: story.id,
      title: story.title,
      description: story.description,
      link: story.link ?? '',
      status: story.status,
      addedBy: story.createdBy.displayName,
      addedOn: story.createdAt,
      currentPointValue: story.currentEstimate ?? '',
      currentPointSessionId: latestEstimate?.sessionId ?? '',
      lastPointedOn: latestEstimate?.finalizedAt ?? ''
    };
  });
}

/**
 * Serializes the complete story catalog as an Excel-friendly UTF-8 CSV.
 *
 * @param stories - Consistent plain story snapshot.
 * @returns BOM-prefixed CSV containing only the documented export fields.
 */
export function serializeStoryCatalog(stories: readonly PointingStory[]): string {
  const lines = [STORY_EXPORT_COLUMNS.join(',')];
  for (const row of createStoryCatalogExportRows(stories)) {
    lines.push(
      [
        row.storyId,
        row.title,
        row.description,
        row.link,
        row.status,
        row.addedBy,
        row.addedOn,
        row.currentPointValue,
        row.currentPointSessionId,
        row.lastPointedOn
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * Creates a portable story-catalog export filename.
 *
 * @param teamTitle - Current team title.
 * @param timestamp - ISO timestamp used to derive the export date.
 * @returns A safe `<Team Title>-stories-<YYYY-MM-DD>.csv` filename.
 */
export function createStoryCatalogExportFileName(teamTitle: string, timestamp: string): string {
  const withoutControls = Array.from(teamTitle, (character) =>
    character.charCodeAt(0) < 32 ? '-' : character
  ).join('');
  const safeTitle = withoutControls
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  const date = /^\d{4}-\d{2}-\d{2}/.exec(timestamp)?.[0] ?? 'unknown-date';
  return `${safeTitle.length > 0 ? safeTitle : 'Planning-Poker'}-stories-${date}.csv`;
}

/**
 * Neutralizes spreadsheet formula controls, then applies standard CSV escaping.
 *
 * @param value - Untrusted story or audit text.
 * @returns One quoted safe CSV cell.
 */
function escapeCsvCell(value: string): string {
  const neutralized = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}
