import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalletWalletPayload, validateTemplateSchema } from '../server/walletPayload.ts';
import { getWalletColorPreset, WALLET_COLOR_PRESETS } from '../src/types/index.ts';

const runner = { id: 'run-1234', first_name: 'Actual', last_name: 'Runner', email: 'actual@example.com',
  dynamic_data: JSON.stringify({ bib: 0, wave: 'Wave C', category: '10K', emergency_contact: 'Actual Contact', points: 0, paid: false, custom: 'Custom field' }) };
const build = (schema: any, plan: 'free' | 'pro' = 'free', extra: any = {}) => buildWalletWalletPayload({ runner,
  template: { background_color: '#18181b', schema_definition: JSON.stringify(schema), ...extra }, raceName: 'Race', plan });

test('all six presets round-trip from both schema and legacy stored hex on Free and Pro', () => {
  for (const preset of Object.values(WALLET_COLOR_PRESETS)) {
    assert.equal(getWalletColorPreset(preset.bgHex).id, preset.id);
    for (const plan of ['free', 'pro'] as const) {
      const body = build({ colorPreset: preset.id }, plan, { background_color: '#18181b' });
      assert.equal(body.colorPreset, preset.id);
      assert.equal(body.color, undefined, 'Preview background hex must never override the chosen preset');
      assert.equal(build({}, plan, { background_color: preset.bgHex }).colorPreset, preset.id);
    }
  }
  assert.equal(getWalletColorPreset('toString').id, 'dark');
});

test('mapped fields beat old sample values, preserve zero/false and strip internal keys', () => {
  const body = build({ primaryFields: [{ key: 'points', label: '', value: '1042', changeMessage: 'Now %@ points' }],
    secondaryFields: [{ key: 'paid', label: 'PAID' }, { key: 'custom', label: 'CUSTOM' }],
    backFields: [{ key: 'email', value: 'old-sample@example.com' }, { key: 'emergency_contact', value: 'Sample Contact' },
      { label: 'RULES', value: 'Hello {{runner_name}} ({{bib}})' }] });
  assert.deepEqual(body.primaryFields, [{ label: '', value: '0', changeMessage: 'Now %@ points' }]);
  assert.equal(body.secondaryFields[0].value, 'false');
  assert.equal(body.secondaryFields[1].value, 'Custom field');
  assert.equal(body.backFields[0].value, 'actual@example.com');
  assert.equal(body.backFields[1].value, 'Actual Contact');
  assert.equal(body.backFields[2].value, 'Hello Actual Runner (0)');
  assert.ok(body.backFields.every((field: any) => !Object.hasOwn(field, 'key')));
});

test('race CSV mappings, blank labels, hidden alt text and intentionally empty arrays survive', () => {
  const body = buildWalletWalletPayload({ runner: { ...runner, dynamic_data: { BibColumn: '57', WaveColumn: 'D' } },
    raceName: 'Race', fieldMapping: JSON.stringify({ bib: 'BibColumn', wave: 'WaveColumn' }),
    template: { schema_definition: JSON.stringify({ colorPreset: 'green', barcodeAltText: '', primaryFields: [{ label: '', key: 'bib' }],
      secondaryFields: [], backFields: [] }) } });
  assert.equal(body.barcodeValue, '57'); assert.equal(body.headerFields[0].value, 'D');
  assert.equal(body.primaryFields[0].label, ''); assert.equal(body.barcodeAltText, '');
  assert.deepEqual(body.secondaryFields, []); assert.deepEqual(body.backFields, []);
});

test('paid wire fields are explicit and use documented case-sensitive names', () => {
  const body = build({ colorPreset: 'purple', color: '#123456' }, 'pro', {
    logo_image_url: 'https://example.com/logo.png', strip_image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=', background_image_url: 'https://example.com/background.png' });
  assert.equal(body.color, '#123456'); assert.equal(body.logoURL, 'https://example.com/logo.png');
  assert.equal(body.stripURL, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII='); assert.equal(body.backgroundURL, 'https://example.com/background.png');
  assert.equal(body.backgroundColor, undefined); assert.equal(body.text_color, undefined);
  assert.throws(() => build({ color: '#123456' }), /requires WalletWallet Pro/);
  assert.throws(() => build({}, 'free', { logo_image_url: 'https://example.com/logo.png' }), /logoURL requires/);
  assert.throws(() => build({}, 'pro', { logo_image_url: 'http://example.com/logo.png' }), /HTTPS/);
});

test('invalid schema input is rejected instead of silently issuing another design', () => {
  for (const raw of ['broken JSON', '[]', { colorPreset: 'pink' }, { colorPreset: ['red'] }, { barcodeFormat: 'QR_CODE' },
    { sharingProhibited: 'false' }, { backFields: {} }, { backFields: [{ label: 3 }] }]) {
    assert.throws(() => validateTemplateSchema(raw));
  }
  assert.equal(validateTemplateSchema({ sharingProhibited: false, barcodeAltText: '' }).sharingProhibited, false);
});

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=';

test('sharingProhibited is an explicit template boolean for both values', () => {
  assert.equal(build({ sharingProhibited: true }).sharingProhibited, true);
  assert.equal(build({ sharingProhibited: false }).sharingProhibited, false);
  assert.throws(() => validateTemplateSchema({ sharingProhibited: 'false' }), /boolean/);
});

test('all four optional image fields accept HTTPS or PNG, and blank fields keep Free working', () => {
  const fields = ['logoURL', 'iconURL', 'thumbnailURL', 'backgroundURL'];
  for (const field of fields) {
    const url = `https://example.com/${field}.png`;
    assert.equal(build({ [field]: url }, 'pro')[field], url);
    assert.equal(build({ [field]: png }, 'pro')[field], png);
    assert.throws(() => build({ [field]: url }), /requires WalletWallet Pro or Business/);
    assert.equal(build({ [field]: '' })[field], undefined);
    assert.equal(build({ [field]: '   ' })[field], undefined);
    assert.throws(() => validateTemplateSchema({ [field]: 'http://example.com/image.png' }), /HTTPS/);
    assert.throws(() => validateTemplateSchema({ [field]: 'data:image/svg+xml,<svg/>' }), /PNG/);
    assert.throws(() => validateTemplateSchema({ [field]: 'data:image/png;base64,UEs=' }), /not a PNG/);
  }
  const schema = Object.fromEntries(fields.map(field => [field, png]));
  const spec = build({ ...schema, sharingProhibited: true }, 'pro');
  for (const field of fields) assert.equal(spec[field], png);
  const free = build({ logoURL: '', backgroundURL: '' }, 'free', {
    logo_image_url: 'https://example.com/old-logo.png', background_image_url: 'https://example.com/old-background.png',
  });
  assert.equal(free.logoURL, undefined); assert.equal(free.backgroundURL, undefined);
});

test('image limits reject oversized files and combined templates before a provider call', () => {
  const huge = 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(1_000_000)]).toString('base64');
  assert.throws(() => validateTemplateSchema({ logoURL: huge }), /1 MB/);
  const medium = 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(700_000)]).toString('base64');
  assert.throws(() => validateTemplateSchema({ logoURL: medium, backgroundURL: medium }), /Combined template artwork/);
});
