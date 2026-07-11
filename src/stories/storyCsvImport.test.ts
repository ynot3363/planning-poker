import {
  STORY_CSV_MAX_BYTES,
  STORY_CSV_MAX_ROWS,
  createStoryCsvTemplate,
  parseStoryCsv,
  validateStoryCsvFile
} from './storyCsvImport';

describe('story CSV import contract', () => {
  it('creates an Excel-friendly versioned template header', () => {
    expect(createStoryCsvTemplate()).toContain(
      '\uFEFFTitle,Description,Link\r\n[Example] Replace or remove this row'
    );
  });

  it('rejects non-CSV and oversized files before reading them', () => {
    expect(validateStoryCsvFile({ name: 'stories.txt', size: STORY_CSV_MAX_BYTES + 1 })).toEqual([
      'Choose a file with the .csv extension.',
      'The CSV file must be 5 MB or smaller.'
    ]);
    expect(validateStoryCsvFile({ name: 'STORIES.CSV', size: STORY_CSV_MAX_BYTES })).toEqual([]);
  });

  it('parses BOM, CRLF, quoted commas, escaped quotes, and multiline text', () => {
    const preview = parseStoryCsv(
      '\uFEFF Title ,DESCRIPTION,link\r\n"Story, one","Line 1\nLine ""two""",https://example.com/1\r\n'
    );
    expect(preview.fileErrors).toEqual([]);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        values: {
          title: 'Story, one',
          description: 'Line 1\nLine "two"',
          link: 'https://example.com/1'
        },
        errors: {}
      })
    ]);
  });

  it('ignores blank lines while preserving uploaded row numbers', () => {
    const preview = parseStoryCsv('Title,Description,Link\n\nFirst,,\n\nSecond,,');
    expect(preview.rows.map((row) => row.rowNumber)).toEqual([3, 5]);
  });

  it('rejects duplicate, missing, and unsupported headers', () => {
    expect(parseStoryCsv('Title,Title,Added By\nOne,Two,Ada').fileErrors.join(' ')).toContain(
      'duplicate column'
    );
    expect(parseStoryCsv('Title,Title,Added By\nOne,Two,Ada').fileErrors.join(' ')).toContain(
      'unsupported CSV columns'
    );
    expect(parseStoryCsv('Title,Title,Added By\nOne,Two,Ada').fileErrors.join(' ')).toContain(
      'required CSV columns'
    );
  });

  it('uses story validation and keeps unsafe-looking content inert', () => {
    const preview = parseStoryCsv(
      'Title,Description,Link\n,"<script>alert(1)</script>",javascript:alert(1)\n=SUM(1+1),<b>text</b>,'
    );
    expect(preview.rows[0].errors).toMatchObject({
      title: expect.any(String),
      link: expect.any(String)
    });
    expect(preview.rows[1].values).toEqual({
      title: '=SUM(1+1)',
      description: '<b>text</b>',
      link: ''
    });
  });

  it('allows duplicate titles but warns for exact duplicate rows', () => {
    const preview = parseStoryCsv('Title,Description,Link\nSame,One,\nSame,Two,\nSame,One,');
    expect(preview.invalidCount).toBe(0);
    expect(preview.warningCount).toBe(2);
    expect(preview.rows[0].warnings).toHaveLength(1);
    expect(preview.rows[2].warnings).toHaveLength(1);
  });

  it('reports malformed quoted records without returning a partial valid import', () => {
    const preview = parseStoryCsv('Title,Description,Link\nStory,"unterminated,');
    expect(preview.fileErrors).toEqual(['Row 2 contains an unterminated quoted value.']);
    expect(parseStoryCsv('Title,Description,Link\nSto"ry,,').rows[0].errors.row).toContain(
      'quote inside an unquoted value'
    );
    expect(parseStoryCsv('Title,Description,Link\nStory,,,Extra').rows[0].errors.row).toBe(
      'Expected 3 columns but found 4.'
    );
  });

  it('stops and reports files above the row limit', () => {
    const rows = Array.from(
      { length: STORY_CSV_MAX_ROWS + 1 },
      (_value, index) => `Story ${index},,`
    );
    const preview = parseStoryCsv(`Title,Description,Link\n${rows.join('\n')}`);
    expect(preview.rows).toHaveLength(STORY_CSV_MAX_ROWS);
    expect(preview.fileErrors).toContain('The CSV file cannot contain more than 1,000 data rows.');
  });
});
