import { parse } from 'csv-parse/sync';

export const profileId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const required = ['id', 'name', 'region', 'sector', 'signal'];
export interface Profile {
  id: string;
  name: string;
  region: string;
  sector: string;
  signal: string;
  details: Record<string, string>;
}

export function readProfiles(bytes: Buffer) {
  const errors: { line: number; reason: string }[] = [];
  const profiles: Profile[] = [];
  let records: { record: string[]; info: { lines: number } }[];
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    records = parse(text, { bom: true, info: true, relax_column_count: true, skip_empty_lines: true, max_record_size: 64_000 }) as unknown as typeof records;
  } catch (error) {
    const line = Number((error as { lines?: number }).lines) || 1;
    return { profiles, errors: [{ line, reason: 'Invalid CSV syntax or UTF-8 encoding' }] };
  }
  const header = records.shift();
  const fields = header?.record.map((field) => field.trim().toLowerCase()) ?? [];
  if (fields.length > 64 || fields.some((key) => !/^[a-z][a-z0-9_]{0,63}$/.test(key))
      || new Set(fields).size !== fields.length || required.some((key) => !fields.includes(key))) {
    return { profiles, errors: [{ line: 1, reason: 'Expected unique column names including id, name, region, sector, signal' }] };
  }

  const seen = new Set<string>();
  for (const { record, info } of records) {
    const line = info.lines;
    const cells = record.map((cell) => cell.trim());
    const row = Object.fromEntries(fields.map((key, i) => [key, cells[i]]));
    if (cells.length !== fields.length || cells.some((cell) => cell.length > 4000 || cell.includes('\0'))) {
      errors.push({ line, reason: 'Unexpected column count, NUL byte, or cell longer than 4,000 characters' });
      continue;
    }
    if (!profileId.test(row.id) || seen.has(row.id) || required.some((key) => !row[key])) {
      errors.push({ line, reason: 'Missing required field or invalid or duplicate profile ID' });
      continue;
    }
    seen.add(row.id);
    const sanitized = Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [key, /^[=+@-]/.test(value) ? "'" + value : value]));
    const { id, name, region, sector, signal, ...details } = sanitized;
    profiles.push({ id, name, region, sector, signal, details });
  }
  if (records.length === 0) errors.push({ line: 2, reason: 'Provide at least one profile' });
  return { profiles, errors };
}
