import { fixtureUser } from '../domain/planningPokerFixtures';
import type { PointingStory } from '../domain/planningPokerDomain';
import {
  STORY_EXPORT_COLUMNS,
  createStoryCatalogExportFileName,
  createStoryCatalogExportRows,
  serializeStoryCatalog
} from './storyCsvExport';

const readyStory: PointingStory = {
  id: 'story-ready',
  title: '=SUM(1+1)',
  description: 'Comma, quote " and\nmultiline café',
  status: 'Ready',
  estimateHistory: [],
  createdAt: '2026-07-11T12:34:56.000Z',
  createdBy: fixtureUser,
  updatedAt: '2026-07-11T12:34:56.000Z',
  updatedBy: fixtureUser
};

const pointedStory: PointingStory = {
  ...readyStory,
  id: 'story-pointed',
  title: 'Pointed story',
  link: 'https://example.com/story',
  status: 'Pointed',
  currentEstimate: '5',
  estimateHistory: [
    {
      sessionId: 'session-old',
      roundId: 'round-old',
      value: '3',
      finalizedAt: '2026-07-10T13:00:00.000Z',
      finalizedBy: fixtureUser
    },
    {
      sessionId: 'session-current',
      roundId: 'round-current',
      value: '5',
      finalizedAt: '2026-07-11T13:00:00.000Z',
      finalizedBy: fixtureUser
    }
  ]
};

describe('story catalog CSV export', () => {
  it('emits a BOM, ordered header, header-only empty export, and CRLF records', () => {
    expect(serializeStoryCatalog([])).toBe(`\uFEFF${STORY_EXPORT_COLUMNS.join(',')}\r\n`);
  });

  it('maps every lifecycle state once and includes only current estimate summary', () => {
    const archived = { ...pointedStory, id: 'story-archived', status: 'Archived' as const };
    const restored = { ...pointedStory, id: 'story-restored', status: 'Ready' as const };
    const rows = createStoryCatalogExportRows([readyStory, pointedStory, archived, restored]);

    expect(rows.map((row) => row.status)).toEqual(['Ready', 'Pointed', 'Archived', 'Ready']);
    expect(rows[0]).toMatchObject({
      currentPointValue: '',
      currentPointSessionId: '',
      lastPointedOn: ''
    });
    expect(rows[1]).toMatchObject({
      currentPointValue: '5',
      currentPointSessionId: 'session-current',
      lastPointedOn: '2026-07-11T13:00:00.000Z'
    });
    expect(Object.keys(rows[1])).not.toEqual(
      expect.arrayContaining(['estimateHistory', 'votes', 'participants', 'roundId'])
    );
    expect(serializeStoryCatalog([pointedStory])).not.toContain('session-old');
  });

  it('escapes quotes, commas, newlines, Unicode, and spreadsheet formulas without mutation', () => {
    const original = { ...readyStory };
    const csv = serializeStoryCatalog([readyStory]);

    expect(csv).toContain('"\'=SUM(1+1)"');
    expect(csv).toContain('"Comma, quote "" and\nmultiline café"');
    expect(readyStory).toEqual(original);
    for (const control of ['=', '+', '-', '@', '\t', '\r', '\n']) {
      expect(serializeStoryCatalog([{ ...readyStory, title: `${control}formula` }])).toContain(
        `"'${control}formula"`
      );
    }
  });

  it('creates safe dated filenames', () => {
    expect(createStoryCatalogExportFileName('Delivery / Team.', '2026-07-11T14:00:00.000Z')).toBe(
      'Delivery - Team-stories-2026-07-11.csv'
    );
    expect(createStoryCatalogExportFileName('   ', 'invalid')).toBe(
      'Planning-Poker-stories-unknown-date.csv'
    );
    expect(createStoryCatalogExportFileName('Team\u0001Name', '2026-07-11')).toBe(
      'Team-Name-stories-2026-07-11.csv'
    );
  });
});
