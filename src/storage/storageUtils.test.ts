import { CURRENT_SCHEMA_VERSION } from '../domain/planningPokerDomain';
import {
  findDrive,
  isStorageConfiguration,
  normalizeCollection,
  normalizeNextLink
} from './storageUtils';

describe('SharePoint storage response utilities', () => {
  it('normalizes modern and verbose collection pages', () => {
    expect(normalizeCollection<number>({ value: [1, 2] })).toEqual([1, 2]);
    expect(normalizeCollection<number>({ d: { results: [3] } })).toEqual([3]);
    expect(normalizeCollection<number>({ unexpected: true })).toEqual([]);
    expect(normalizeNextLink({ '@odata.nextLink': 'https://example.test/page-2' })).toBe(
      'https://example.test/page-2'
    );
    expect(normalizeNextLink({ d: { __next: '/page-2' } })).toBe('/page-2');
  });

  it('prefers immutable list identifiers when matching an ODSP drive', () => {
    const drive = findDrive(
      [
        { id: 'wrong', name: 'PlanningPokerAppData' },
        { id: 'right', sharepointIds: { listId: 'LIST-ID' } }
      ],
      { Id: 'list-id', Title: 'PlanningPokerAppData' }
    );

    expect(drive?.id).toBe('right');
  });

  it('rejects incomplete or non-HTTPS persisted configuration', () => {
    const valid = {
      libraryTitle: 'PlanningPokerAppData',
      listId: 'list-id',
      driveId: 'drive-id',
      serverRelativeUrl: '/sites/example/PlanningPokerAppData',
      webAbsoluteUrl: 'https://example.sharepoint.com/sites/example',
      provisioningVersion: '1.0.0',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      fieldMap: {},
      lastValidatedAt: '2026-07-10T00:00:00.000Z'
    };

    expect(isStorageConfiguration(valid)).toBe(true);
    expect(isStorageConfiguration({ ...valid, webAbsoluteUrl: 'http://example.test' })).toBe(false);
    expect(isStorageConfiguration({ ...valid, driveId: '' })).toBe(false);
  });
});
