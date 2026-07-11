import { validateStoryForm } from './storyManagement';
import type { StoryFormErrors, StoryFormValues } from './storyManagement';

/** Version of the public story-import CSV contract. */
export const STORY_CSV_VERSION = '1.0';
/** Maximum accepted upload size. */
export const STORY_CSV_MAX_BYTES = 5 * 1024 * 1024;
/** Maximum number of nonblank data rows. */
export const STORY_CSV_MAX_ROWS = 1000;
/** Ordered public import columns. */
export const STORY_CSV_COLUMNS = ['Title', 'Description', 'Link'] as const;

/** Minimal file metadata checked before reading an untrusted upload. */
export interface StoryCsvFileDescriptor {
  readonly name: string;
  readonly size: number;
}

/** One traceable parsed CSV row. */
export interface StoryCsvPreviewRow {
  readonly rowNumber: number;
  readonly values: StoryFormValues;
  readonly errors: StoryFormErrors & { readonly row?: string };
  readonly warnings: readonly string[];
}

/** Complete safe preview of an uploaded CSV. */
export interface StoryCsvPreview {
  readonly version: typeof STORY_CSV_VERSION;
  readonly rows: readonly StoryCsvPreviewRow[];
  readonly fileErrors: readonly string[];
  readonly validCount: number;
  readonly invalidCount: number;
  readonly warningCount: number;
}

/** @returns An Excel-friendly UTF-8 template with the exact supported header. */
export function createStoryCsvTemplate(): string {
  return `\uFEFF${STORY_CSV_COLUMNS.join(',')}\r\n[Example] Replace or remove this row,"Supports commas, quotes, and multiple lines",https://example.com/story\r\n`;
}

/**
 * Rejects an upload before its contents are read.
 *
 * @param file - Untrusted file metadata.
 * @returns Actionable file-level errors.
 */
export function validateStoryCsvFile(file: StoryCsvFileDescriptor): readonly string[] {
  const errors: string[] = [];
  if (!file.name.toLocaleLowerCase().endsWith('.csv')) {
    errors.push('Choose a file with the .csv extension.');
  }
  if (file.size > STORY_CSV_MAX_BYTES) {
    errors.push('The CSV file must be 5 MB or smaller.');
  }
  return errors;
}

/**
 * Parses and validates untrusted CSV text without interpreting its content as markup or code.
 *
 * @param content - UTF-8 CSV text read locally in the browser.
 * @returns A traceable preview and file-level contract errors.
 */
export function parseStoryCsv(content: string): StoryCsvPreview {
  const parsed = parseCsvRecords(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
  const fileErrors = [...parsed.errors];
  const header = parsed.records[0];
  if (header === undefined) {
    fileErrors.push('The CSV file is empty.');
    return createPreview([], fileErrors);
  }
  const headerMap = validateHeader(header.values, fileErrors);
  if (headerMap === undefined) {
    return createPreview([], fileErrors);
  }
  const rows: StoryCsvPreviewRow[] = [];
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const record of parsed.records.slice(1)) {
    if (record.values.every((value) => value.trim().length === 0)) {
      continue;
    }
    if (rows.length >= STORY_CSV_MAX_ROWS) {
      fileErrors.push('The CSV file cannot contain more than 1,000 data rows.');
      break;
    }
    const values: StoryFormValues = {
      title: record.values[headerMap.Title] ?? '',
      description: record.values[headerMap.Description] ?? '',
      link: record.values[headerMap.Link] ?? ''
    };
    const columnError =
      record.values.length === STORY_CSV_COLUMNS.length
        ? undefined
        : `Expected ${STORY_CSV_COLUMNS.length} columns but found ${record.values.length}.`;
    const errors: StoryCsvPreviewRow['errors'] = {
      ...validateStoryForm(values),
      ...(record.error === undefined && columnError === undefined
        ? {}
        : { row: record.error ?? columnError })
    };
    const key = JSON.stringify([values.title, values.description, values.link]);
    const isDuplicate = seen.has(key);
    seen.add(key);
    if (isDuplicate) {
      duplicates.add(key);
    }
    rows.push({
      rowNumber: record.rowNumber,
      values,
      errors,
      warnings: isDuplicate ? ['Exact duplicate of an earlier row.'] : []
    });
  }
  if (duplicates.size > 0) {
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const key = JSON.stringify([row.values.title, row.values.description, row.values.link]);
      if (duplicates.has(key) && row.warnings.length === 0) {
        rows[index] = { ...row, warnings: ['Exact duplicate also appears later in the file.'] };
      }
    }
  }
  return createPreview(rows, fileErrors);
}

interface ParsedRecord {
  readonly rowNumber: number;
  readonly values: readonly string[];
  readonly error?: string;
}

/**
 * Splits RFC-4180-style records while retaining source line numbers.
 *
 * @param content - CSV text without a byte-order mark.
 * @returns Parsed records and structural file errors.
 */
function parseCsvRecords(content: string): {
  readonly records: readonly ParsedRecord[];
  readonly errors: readonly string[];
} {
  const records: ParsedRecord[] = [];
  const errors: string[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let recordRow = 1;
  let row = 1;
  let recordError: string | undefined;
  let dataRowCount = 0;
  let rowLimitExceeded = false;
  const finishField = (): void => {
    fields.push(field);
    field = '';
    afterQuote = false;
  };
  const finishRecord = (): void => {
    finishField();
    const record = {
      rowNumber: recordRow,
      values: fields,
      ...(recordError ? { error: recordError } : {})
    };
    records.push(record);
    if (records.length > 1 && fields.some((value) => value.trim().length > 0)) {
      dataRowCount++;
      rowLimitExceeded = dataRowCount > STORY_CSV_MAX_ROWS;
    }
    fields = [];
    recordError = undefined;
    recordRow = row + 1;
  };
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (inQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
        if (character === '\n') {
          row++;
        }
      }
      continue;
    }
    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') {
      recordError = 'Unexpected text appears after a closing quote.';
      field += character;
      continue;
    }
    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n') {
      finishRecord();
      if (rowLimitExceeded) {
        break;
      }
      row++;
      recordRow = row;
    } else if (character === '\r') {
      if (content[index + 1] === '\n') {
        index++;
      }
      finishRecord();
      if (rowLimitExceeded) {
        break;
      }
      row++;
      recordRow = row;
    } else {
      if (character === '"') {
        recordError = 'A quote inside an unquoted value must be escaped.';
      }
      field += character;
    }
  }
  if (inQuotes) {
    errors.push(`Row ${recordRow} contains an unterminated quoted value.`);
  }
  if (field.length > 0 || fields.length > 0) {
    finishRecord();
  }
  return { records, errors };
}

/**
 * Validates and maps the public CSV header.
 *
 * @param values - Parsed header fields.
 * @param errors - Mutable file-error collection.
 * @returns Column indexes when the header is valid.
 */
function validateHeader(
  values: readonly string[],
  errors: string[]
): { readonly Title: number; readonly Description: number; readonly Link: number } | undefined {
  const normalized = values.map((value) => value.trim().toLocaleLowerCase());
  const supported = STORY_CSV_COLUMNS.map((value) => value.toLocaleLowerCase());
  const duplicate = normalized.find((value, index) => normalized.indexOf(value) !== index);
  const unsupported = normalized.filter((value) => supported.indexOf(value) < 0);
  const missing = supported.filter((value) => normalized.indexOf(value) < 0);
  if (duplicate !== undefined) {
    errors.push(`The CSV header contains the duplicate column "${duplicate}".`);
  }
  if (unsupported.length > 0) {
    errors.push(`Remove unsupported CSV columns: ${unsupported.join(', ')}.`);
  }
  if (missing.length > 0) {
    errors.push(`Add the required CSV columns: ${missing.join(', ')}.`);
  }
  if (errors.length > 0) {
    return undefined;
  }
  return {
    Title: normalized.indexOf('title'),
    Description: normalized.indexOf('description'),
    Link: normalized.indexOf('link')
  };
}

/**
 * Calculates safe preview summary counts.
 *
 * @param rows - Validated traceable rows.
 * @param fileErrors - File-level errors.
 * @returns The complete versioned preview.
 */
function createPreview(
  rows: readonly StoryCsvPreviewRow[],
  fileErrors: readonly string[]
): StoryCsvPreview {
  const invalidCount = rows.filter((row) => Object.keys(row.errors).length > 0).length;
  return {
    version: STORY_CSV_VERSION,
    rows,
    fileErrors,
    validCount: rows.length - invalidCount,
    invalidCount,
    warningCount: rows.reduce((count, row) => count + row.warnings.length, 0)
  };
}
