'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../app.js');

// Pinned production core, independent of Git refs and subprocess availability.
const v1 = require('./fixtures/v1-core.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const copy = value => structuredClone(value);
const now = '2026-10-24T12:00:00.000Z';
const scoreKeys = ['sweetness', 'acidity', 'bitterness', 'body', 'overall'];
const versionKeys = ['id', 'number', 'name', 'date', 'category', 'tool', 'beans',
  'coffeeGrams', 'waterMl', 'temperatureC', 'grind', 'durationSeconds', 'process',
  'ingredients', 'tastingNotes', 'scores'];
const fields = {
  name: 'V60 Ethiopia pagi', date: '2026-10-23', category: 'manual',
  tool: 'Hario V60', beans: 'Ethiopia Guji · Natural', coffeeGrams: 15.5,
  waterMl: 232.5, temperatureC: 92, grind: '20 klik', durationSeconds: 165,
  process: 'Blooming 30 detik.\nTuang dalam tiga tahap.', ingredients: 'Es 80 g',
  tastingNotes: 'Floral, manis madu, akhir bersih.',
  scores: { sweetness: 4, acidity: 3, bitterness: 2, body: 3, overall: 5 }
};
const fullVersion = { id: 'v1-full', number: 1, ...fields };
const fullBackup = {
  app: 'Coffee Brew Lab', schemaVersion: 1, exportedAt: now,
  recipes: [{ id: 'r-full', versions: [fullVersion] }]
};
const minimalBackup = {
  schemaVersion: 1,
  recipes: [{ id: 'r-min', versions: [{ id: 'v-min', number: 1, name: 'Cold brew', category: 'cold' }] }]
};

test('the storage key and normalized V1 wire shape remain unchanged', () => {
  assert.equal(core.STORAGE_KEY, 'coffee-brew-lab:data:v1');
  const data = core.normalizeData(fullBackup);
  assert.deepEqual(Object.keys(data), ['schemaVersion', 'recipes']);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(Object.keys(data.recipes[0]), ['id', 'versions']);
  assert.deepEqual(Object.keys(data.recipes[0].versions[0]), versionKeys);
  assert.deepEqual(Object.keys(data.recipes[0].versions[0].scores), scoreKeys);
  assert.deepEqual(core.CATEGORIES, { manual: 'Manual brew', cold: 'Cold brew', other: 'Lainnya' });
});

for (const [label, fixture] of [['full', fullBackup], ['minimal', minimalBackup], ['empty', { schemaVersion: 1, recipes: [] }]]) {
  test(`${label} V1 fixture imports unchanged and the V1.1 export is readable by V1.0`, () => {
    const original = JSON.stringify(fixture);
    const current = core.parseBackup(original);
    assert.deepEqual(current, plain(v1.parseBackup(original)));
    const exported = core.serializeBackup(current, now);
    assert.equal(exported, v1.serializeBackup(v1.parseBackup(original), now));
    assert.deepEqual(plain(v1.parseBackup(exported)), current);
    assert.deepEqual(core.parseBackup(exported), current);
    const envelope = JSON.parse(exported);
    assert.deepEqual(Object.keys(envelope), ['app', 'schemaVersion', 'exportedAt', 'recipes']);
    assert.equal(envelope.app, 'Coffee Brew Lab');
    assert.equal(envelope.exportedAt, now);
    assert.equal(JSON.stringify(fixture), original, 'normalization must not mutate the imported object');
  });
}

test('missing optional fields stay empty strings or null, never invented scores', () => {
  const version = core.normalizeData(minimalBackup).recipes[0].versions[0];
  for (const key of ['date', 'tool', 'beans', 'grind', 'process', 'ingredients', 'tastingNotes']) assert.equal(version[key], '');
  for (const key of ['coffeeGrams', 'waterMl', 'temperatureC', 'durationSeconds']) assert.equal(version[key], null);
  assert.deepEqual(version.scores, Object.fromEntries(scoreKeys.map(key => [key, null])));
});

test('creating a recipe creates distinct recipe/version IDs and leaves its input intact', () => {
  const empty = core.EMPTY();
  const result = core.createRecipe(empty, fields);
  assert.deepEqual(empty, { schemaVersion: 1, recipes: [] });
  const recipe = result.recipes[0];
  assert.equal(recipe.versions[0].number, 1);
  assert.ok(recipe.id && recipe.versions[0].id);
  assert.notEqual(recipe.id, recipe.versions[0].id);
  assert.deepEqual(recipe.versions[0].scores, fields.scores);
  assert.deepEqual(result, core.normalizeData(result));
});

test('editing keeps recipe ID, version ID and number without creating a version', () => {
  const data = core.normalizeData(fullBackup);
  const before = copy(data);
  const next = core.updateVersion(data, 'r-full', 'v1-full', { name: 'Updated', scores: { ...fields.scores, overall: null } });
  assert.deepEqual(data, before);
  assert.equal(next.recipes[0].id, 'r-full');
  assert.equal(next.recipes[0].versions.length, 1);
  const updated = next.recipes[0].versions[0];
  assert.equal(updated.id, 'v1-full');
  assert.equal(updated.number, 1);
  assert.equal(updated.name, 'Updated');
  assert.equal(updated.scores.overall, null);
  assert.equal(updated.scores.sweetness, 4);
});

test('duplicating an older selected version uses that source and max(number) + 1', () => {
  const first = core.normalizeData(fullBackup);
  const second = core.duplicateVersion(first, 'r-full', 'v1-full', { temperatureC: 90, tastingNotes: 'V2 only' });
  const secondBefore = copy(second);
  const third = core.duplicateVersion(second, 'r-full', 'v1-full', { waterMl: 240 });
  const versions = third.recipes[0].versions;
  assert.deepEqual(first.recipes[0].versions, [fullVersion]);
  assert.deepEqual(second, secondBefore);
  assert.deepEqual(versions.map(item => item.number), [1, 2, 3]);
  assert.equal(new Set(versions.map(item => item.id)).size, 3);
  assert.equal(versions[2].temperatureC, 92);
  assert.equal(versions[2].tastingNotes, fields.tastingNotes);
  assert.equal(versions[2].waterMl, 240);
  const gapped = copy(first);
  gapped.recipes[0].versions[0].number = 7;
  assert.equal(core.duplicateVersion(gapped, 'r-full', 'v1-full').recipes[0].versions[1].number, 8);
});

test('normalization sorts version numbers without changing input order', () => {
  const data = copy(fullBackup);
  const v2 = { ...copy(fullVersion), id: 'v2-full', number: 2 };
  data.recipes[0].versions = [v2, copy(fullVersion)];
  const normalized = core.normalizeData(data);
  assert.deepEqual(normalized.recipes[0].versions.map(item => item.number), [1, 2]);
  assert.deepEqual(data.recipes[0].versions.map(item => item.number), [2, 1]);
});

test('all tasting scores accept null and integers 1–5, with independent overall', () => {
  for (const key of scoreKeys) {
    for (const value of [null, 1, 2, 3, 4, 5]) {
      const data = { ...fullVersion, scores: { ...fields.scores, [key]: value } };
      assert.equal(core.validateVersion(data).scores[key], value);
    }
    for (const value of [0, 6, -1, 2.5, '3', '', NaN, Infinity]) {
      assert.throws(() => core.validateVersion({ ...fullVersion, scores: { ...fields.scores, [key]: value } }));
    }
  }
  const version = core.validateVersion({ ...fullVersion, scores: { sweetness: 1, acidity: 1, bitterness: 1, body: 1, overall: 5 } });
  assert.equal(version.scores.overall, 5);
});

test('decimal comma/dot, blank versus zero and positive-only parameters retain V1 meaning', () => {
  for (const value of ['15,5', '15.5', ' 15,5 ']) assert.equal(core.parseDecimal(value, 'Dosis', { positive: true }), 15.5);
  assert.equal(core.parseDecimal(',5'), 0.5);
  assert.equal(core.parseDecimal('.5'), 0.5);
  assert.equal(core.parseDecimal(''), null);
  assert.equal(core.parseDecimal('   '), null);
  assert.equal(core.parseDecimal('0'), 0);
  assert.throws(() => core.parseDecimal('0', 'Dosis', { positive: true }));
  for (const input of ['-1', '1e3', '1,2.3', 'NaN', 'Infinity', '12 g']) assert.throws(() => core.parseDecimal(input));
  for (const key of ['coffeeGrams', 'waterMl']) {
    assert.equal(core.validateVersion({ ...fullVersion, [key]: null })[key], null);
    for (const value of [0, -1, '15', Infinity]) assert.throws(() => core.validateVersion({ ...fullVersion, [key]: value }));
  }
  assert.equal(core.validateVersion({ ...fullVersion, temperatureC: 0 }).temperatureC, 0);
});

test('ratio is derived only from coffee/water and duration supports cold brew and explicit zero', () => {
  assert.equal(core.ratio(15, 225), '1:15');
  assert.equal(core.ratio(15.5, 232.5), '1:15');
  for (const [coffee, water] of [[null, 225], [15, null], [0, 225], [15, 0]]) assert.equal(core.ratio(coffee, water), null);
  const withIngredients = { ...fullVersion, ingredients: 'Susu 100 ml dan es 80 g' };
  assert.equal(core.ratio(withIngredients.coffeeGrams, withIngredients.waterMl), '1:15');
  assert.equal(core.formatDuration(43200), '12 jam');
  assert.equal(core.formatDuration(3661), '1 jam 1 menit 1 detik');
  assert.equal(core.formatDuration(0), '0 detik');
  assert.equal(core.formatDuration(null), 'Belum dicatat');
  assert.equal(core.validateVersion({ ...fullVersion, durationSeconds: 43200 }).durationSeconds, 43200);
  for (const value of [-1, 1.5, '60', Infinity]) assert.throws(() => core.validateVersion({ ...fullVersion, durationSeconds: value }));
});

test('comparison retains all 19 attributes, null values and same-version behavior', () => {
  const expected = ['name', 'date', 'category', 'tool', 'beans', 'coffeeGrams', 'waterMl',
    'temperatureC', 'ratio', 'grind', 'durationSeconds', 'process', 'ingredients',
    'tastingNotes', ...scoreKeys];
  const same = core.compareVersions(fullVersion, fullVersion);
  assert.deepEqual(same.map(row => row.key), expected);
  assert.equal(same.length, 19);
  assert.ok(same.every(row => !row.different));
  const changed = {
    ...fullVersion, name: 'Cold brew baru', date: '2026-10-24', category: 'cold',
    tool: 'Botol', beans: 'Blend', coffeeGrams: 60, waterMl: 600, temperatureC: 25,
    grind: 'Coarse', durationSeconds: 43200, process: 'Rendam', ingredients: '',
    tastingNotes: 'Cokelat', scores: { sweetness: 5, acidity: 2, bitterness: 3, body: 4, overall: 4 }
  };
  assert.ok(core.compareVersions(fullVersion, changed).every(row => row.different));
  assert.deepEqual(core.compareVersions(fullVersion, changed), plain(v1.compareVersions(fullVersion, changed)));
  const minimal = core.normalizeData(minimalBackup).recipes[0].versions[0];
  assert.ok(core.compareVersions(minimal, minimal).every(row => !row.different));
  assert.equal(core.compareVersions(minimal, minimal).find(row => row.key === 'overall').left, 'Belum dinilai');
  const rounded = core.compareVersions(fullVersion, { ...fullVersion, coffeeGrams: 15.50000001 });
  assert.equal(rounded.find(row => row.key === 'coffeeGrams').different, true);
});

test('invalid JSON, schemas, categories, dates and duplicate identities are rejected', () => {
  assert.throws(() => core.parseBackup('{not json}'));
  for (const value of [null, [], {}, { schemaVersion: 2, recipes: [] }, { schemaVersion: 1, recipes: {} }, { ...fullBackup, app: 'Other app' }]) {
    assert.throws(() => core.normalizeData(value));
  }
  for (const change of [{ name: '' }, { category: 'espresso' }, { date: '2026-02-30' }, { date: '23/10/2026' }, { number: 0 }, { id: '' }, { scores: [] }]) {
    assert.throws(() => core.validateVersion({ ...fullVersion, ...change }));
  }
  assert.equal(core.validateVersion({ ...fullVersion, date: '' }).date, '');
  assert.equal(core.validateVersion({ ...fullVersion, date: '2024-02-29' }).date, '2024-02-29');
  const duplicate = copy(fullBackup);
  duplicate.recipes.push(copy(duplicate.recipes[0]));
  assert.throws(() => core.normalizeData(duplicate));
  for (const second of [{ ...fullVersion, id: 'another' }, { ...fullVersion, number: 2 }, { ...fullVersion, id: 'r-full', number: 2 }]) {
    const data = copy(fullBackup);
    data.recipes[0].versions.push(second);
    assert.throws(() => core.normalizeData(data));
  }
  assert.throws(() => core.normalizeData({ schemaVersion: 1, recipes: [{ id: 'empty', versions: [] }] }));
});

test('maximum text lengths and user-supplied markup survive JSON round-trip as text', () => {
  const version = {
    ...fullVersion, name: 'N'.repeat(120), beans: 'B'.repeat(200), tool: 'T'.repeat(200),
    grind: 'G'.repeat(200), process: 'P'.repeat(10000), ingredients: 'I'.repeat(10000),
    tastingNotes: '<script>alert("test")</script>\n<&> “kopi”'
  };
  const data = { schemaVersion: 1, recipes: [{ id: 'long', versions: [version] }] };
  assert.deepEqual(core.parseBackup(core.serializeBackup(data, now)).recipes[0].versions[0], version);
  for (const [key, limit] of [['name', 120], ['beans', 200], ['tool', 200], ['grind', 200], ['process', 10000], ['ingredients', 10000], ['tastingNotes', 10000]]) {
    assert.throws(() => core.validateVersion({ ...fullVersion, [key]: 'x'.repeat(limit + 1) }));
  }
});

test('loading the CommonJS core without a DOM never reads or writes localStorage', () => {
  let calls = 0;
  const storage = new Proxy({}, { get() { calls++; throw new Error('unexpected storage access'); } });
  const sandbox = { module: { exports: {} }, localStorage: storage };
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), sandbox);
  assert.equal(calls, 0);
  assert.equal(typeof sandbox.module.exports.parseBackup, 'function');
});
