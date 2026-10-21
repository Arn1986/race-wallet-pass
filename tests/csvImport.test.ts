import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_ATHLETES_CSV, parseAthleteCsv, validateAthleteRows } from '../server/csvImport.ts';

test('downloadable sample has five valid athletes and preserves quoted emergency contacts', () => {
  const result = parseAthleteCsv('\uFEFF' + SAMPLE_ATHLETES_CSV);
  assert.equal(result.rows.length, 5); assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].emergency_contact, 'Taylor Rivera, +971 50 000 0001');
});

test('Excel CSV accepts BOM, CRLF, aliases, quoted commas/newlines and escaped quotes', () => {
  const result = parseAthleteCsv('\uFEFFFirst Name,Last Name,Email,Bib Number,notes\r\n"Alex","O""Brien",TEST@EXAMPLE.COM,0012,"first line, with comma\r\nsecond line"\r\n');
  assert.equal(result.rows[0].first_name, 'Alex'); assert.equal(result.rows[0].last_name, 'O"Brien');
  assert.equal(result.rows[0].bib_number, '0012'); assert.ok(result.rows[0].notes.includes('\r\n'));
  assert.equal(validateAthleteRows(result.rows).athletes[0].email, 'test@example.com');
  const european = parseAthleteCsv('first_name;last_name;email\nAlex;Runner;test@example.com');
  assert.equal(european.rows.length, 1);
});

test('malformed files and invalid athlete rows produce visible actionable errors', () => {
  for (const text of ['', 'first_name,email\nA,a@example.com', 'first_name,last_name,email\n"Unclosed',
    'first_name,last_name,email\nA,B,a@example.com,extra', 'first_name,first_name,last_name,email\nA,A,B,a@example.com']) {
    assert.throws(() => parseAthleteCsv(text));
  }
  const invalid = parseAthleteCsv('first_name,last_name,email\nA,B,not-an-email\n,B,b@example.com');
  assert.equal(invalid.errors.length, 2); assert.equal(invalid.errors[0].row, 2); assert.equal(invalid.errors[1].row, 3);
  assert.equal(validateAthleteRows([null]).errors.length, 1);
});
