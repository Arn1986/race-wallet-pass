export const MAX_IMPORT_ROWS = 100;
export const SAMPLE_ATHLETES_CSV = `bib_number,first_name,last_name,email,start_wave,race_division,corral_letter,target_pace,tshirt_size,emergency_contact\r
1001,Alex,Rivera,athlete1@example.com,Wave A,10K,A,5:00 min/km,M,"Taylor Rivera, +971 50 000 0001"\r
1002,Sam,Chen,athlete2@example.com,Wave A,10K,A,5:15 min/km,S,+971 50 000 0002\r
1003,Jordan,Patel,athlete3@example.com,Wave B,Half Marathon,B,5:30 min/km,L,+971 50 000 0003\r
1004,Casey,Ahmed,athlete4@example.com,Wave B,Half Marathon,B,5:45 min/km,M,+971 50 000 0004\r
1005,Riley,Santos,athlete5@example.com,Wave C,Marathon,C,6:00 min/km,XL,+971 50 000 0005\r
`;

export interface ImportIssue { row: number; email?: string; error: string }
export interface AthleteRow { email: string; first_name: string; last_name: string; dynamic_data: Record<string, string> }

function headerName(raw: string): string {
  const clean = raw.replace(/^\uFEFF/, '').trim();
  const key = clean.toLowerCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = { email: 'email', email_address: 'email', firstname: 'first_name', first_name: 'first_name',
    lastname: 'last_name', last_name: 'last_name', bib: 'bib', bib_number: 'bib_number', bibnumber: 'bib_number',
    start_wave: 'start_wave', wave: 'wave', race_division: 'race_division', division: 'division', category: 'category',
    corral_letter: 'corral_letter', target_pace: 'target_pace', tshirt_size: 'tshirt_size', emergency_contact: 'emergency_contact' };
  return Object.hasOwn(aliases, key) ? aliases[key] : clean;
}

export function validateAthleteRows(rows: unknown[]): { athletes: Array<AthleteRow & { row: number }>; errors: ImportIssue[] } {
  const athletes: Array<AthleteRow & { row: number }> = [], errors: ImportIssue[] = [];
  rows.forEach((input, index) => {
    const rowNumber = index + 2;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      errors.push({ row: rowNumber, error: 'Expected an athlete row object' }); return;
    }
    const row: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      const normalized = headerName(key);
      if (Object.hasOwn(row, normalized)) { errors.push({ row: rowNumber, error: `Duplicate column: ${normalized}` }); return; }
      if (value !== null && value !== undefined && !['string', 'number', 'boolean'].includes(typeof value)) {
        errors.push({ row: rowNumber, error: `Invalid cell in ${key}` }); return;
      }
      row[normalized] = String(value ?? '').trim();
    }
    const email = (row.email || '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      errors.push({ row: rowNumber, email, error: 'A valid email is required' }); return;
    }
    if (!row.first_name || !row.last_name) {
      errors.push({ row: rowNumber, email, error: 'first_name and last_name are required' }); return;
    }
    if (new TextEncoder().encode(JSON.stringify(row)).byteLength > 100_000) {
      errors.push({ row: rowNumber, email, error: 'Athlete row is too large (maximum 100 KB)' }); return;
    }
    const dynamic_data = { ...row };
    delete dynamic_data.email; delete dynamic_data.first_name; delete dynamic_data.last_name;
    athletes.push({ row: rowNumber, email, first_name: row.first_name, last_name: row.last_name, dynamic_data });
  });
  return { athletes, errors };
}

// CSV with escaped quotes, commas/newlines inside quoted cells, Excel BOM and CRLF.
export function parseAthleteCsv(source: string): { rows: Record<string, string>[]; errors: ImportIssue[] } {
  if (source.length > 1_000_000) throw new Error('CSV is too large (maximum 1 MB)');
  const text = source.replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('Choose a CSV file containing a header and athletes');
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes(',') ? ',' : firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const records: string[][] = [];
  let fields: string[] = [], value = '', quoted = false, closed = false;
  const finishField = () => { fields.push(value.trim()); value = ''; closed = false; };
  const finishRecord = () => { finishField(); if (fields.some(field => field !== '')) records.push(fields); fields = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { value += '"'; i++; }
        else { quoted = false; closed = true; }
      } else value += c;
    } else if (c === '"') {
      if (value.trim() || closed) throw new Error(`Unexpected quote near CSV row ${records.length + 1}`);
      value = ''; quoted = true;
    } else if (c === delimiter) finishField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      finishRecord();
    } else {
      if (closed && c.trim()) throw new Error(`Unexpected text after closing quote near CSV row ${records.length + 1}`);
      if (!closed) value += c;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quoted cell');
  if (value || fields.length || closed) finishRecord();
  const headers = (records.shift() || []).map(headerName);
  if (headers.some(h => !h)) throw new Error('CSV column names cannot be blank');
  if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error('CSV contains duplicate column names');
  const missing = ['email', 'first_name', 'last_name'].filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);
  if (!records.length) throw new Error('CSV has no athlete rows');
  if (records.length > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS} athletes per file; split larger rosters`);
  const rows = records.map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} cells; expected ${headers.length}. Quote values containing commas.`);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
  return { rows, errors: validateAthleteRows(rows).errors };
}
