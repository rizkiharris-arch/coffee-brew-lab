// Unchanged V1.0 core from b44f998da1cbe9406139d577b77ef445fbb4e343:app.js.
// Browser UI omitted; this immutable fixture checks backward JSON compatibility.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'coffee-brew-lab:data:v1';
  const BACKUP_KEY = 'coffee-brew-lab:last-backup';
  const SCORE_LABELS = {
    sweetness: 'Sweetness · kemanisan', acidity: 'Acidity · keasaman',
    bitterness: 'Bitterness · kepahitan', body: 'Body · berat di mulut',
    overall: 'Nilai keseluruhan'
  };
  const CATEGORIES = { manual: 'Manual brew', cold: 'Cold brew', other: 'Lainnya' };
  const EMPTY = () => ({ schemaVersion: 1, recipes: [] });

  class BrewError extends Error {
    constructor(message, field) { super(message); this.name = 'BrewError'; this.field = field; }
  }
  const fail = (message, field) => { throw new BrewError(message, field); };
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const uid = () => root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : 'brew-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const textValue = (value, label, max = 10000) => {
    if (value === undefined || value === null) return '';
    if (typeof value !== 'string' || value.length > max) fail(label + ' tidak valid atau terlalu panjang.');
    return value;
  };
  const numericValue = (value, label, positive = false, integer = false) => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0) || (integer && !Number.isSafeInteger(value))) {
      fail(label + ' harus berupa angka ' + (positive ? 'lebih dari nol.' : 'nol atau lebih.'));
    }
    return value;
  };
  const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

  function validateVersion(input) {
    if (!isObject(input)) fail('Versi eksperimen tidak valid.');
    if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 200) fail('Identitas versi tidak valid.');
    if (!Number.isSafeInteger(input.number) || input.number < 1) fail('Nomor versi tidak valid.');
    const name = textValue(input.name, 'Nama resep', 120).trim();
    if (!name) fail('Isi nama resep terlebih dahulu.', 'recipe-name');
    if (!Object.hasOwn(CATEGORIES, input.category)) fail('Pilih kategori seduhan.', 'category');
    const date = textValue(input.date, 'Tanggal', 10);
    if (date && !dateValid(date)) fail('Tanggal seduh tidak valid.', 'brew-date');
    if (input.scores !== undefined && !isObject(input.scores)) fail('Format skor tasting tidak valid.');
    const scores = {};
    for (const key of Object.keys(SCORE_LABELS)) {
      const value = input.scores && input.scores[key];
      if (value === undefined || value === null) scores[key] = null;
      else if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) scores[key] = value;
      else fail(SCORE_LABELS[key] + ' harus berupa bilangan bulat 1–5 atau belum dinilai.', key);
    }
    return {
      id: input.id, number: input.number, name, date, category: input.category,
      tool: textValue(input.tool, 'Alat', 200), beans: textValue(input.beans, 'Biji kopi', 200),
      coffeeGrams: numericValue(input.coffeeGrams, 'Dosis kopi', true),
      waterMl: numericValue(input.waterMl, 'Air seduh', true),
      temperatureC: numericValue(input.temperatureC, 'Suhu air'),
      grind: textValue(input.grind, 'Ukuran giling', 200),
      durationSeconds: numericValue(input.durationSeconds, 'Durasi', false, true),
      process: textValue(input.process, 'Catatan proses'),
      ingredients: textValue(input.ingredients, 'Bahan tambahan'),
      tastingNotes: textValue(input.tastingNotes, 'Tasting notes'), scores
    };
  }

  function normalizeData(input) {
    if (!isObject(input) || input.schemaVersion !== 1 || !Array.isArray(input.recipes)) {
      fail('Format cadangan tidak dikenali. Gunakan file JSON Coffee Brew Lab dengan versi format 1.');
    }
    if (input.app !== undefined && input.app !== 'Coffee Brew Lab') fail('File ini bukan cadangan Coffee Brew Lab.');
    const ids = new Set();
    const recipes = input.recipes.map(recipe => {
      if (!isObject(recipe) || typeof recipe.id !== 'string' || !recipe.id.trim() || recipe.id.length > 200 || ids.has(recipe.id)) fail('Identitas resep kosong atau berulang.');
      ids.add(recipe.id);
      if (!Array.isArray(recipe.versions) || recipe.versions.length === 0) fail('Setiap resep harus memiliki setidaknya satu versi.');
      const numbers = new Set();
      const versions = recipe.versions.map(item => {
        const version = validateVersion(item);
        if (ids.has(version.id) || numbers.has(version.number)) fail('Identitas atau nomor versi berulang.');
        ids.add(version.id); numbers.add(version.number);
        return version;
      }).sort((a, b) => a.number - b.number);
      return { id: recipe.id, versions };
    });
    return { schemaVersion: 1, recipes };
  }

  function parseBackup(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail('File tidak dapat dibaca sebagai JSON. Pilih cadangan Coffee Brew Lab yang utuh.'); }
    return normalizeData(parsed);
  }
  function serializeBackup(data, now = new Date().toISOString()) {
    const clean = normalizeData(data);
    return JSON.stringify({ app: 'Coffee Brew Lab', schemaVersion: 1, exportedAt: now, recipes: clean.recipes }, null, 2);
  }
  function createRecipe(data, fields) {
    const next = normalizeData(data);
    next.recipes.push({ id: uid(), versions: [validateVersion({ ...fields, id: uid(), number: 1 })] });
    return next;
  }
  function findVersion(data, recipeId, versionId) {
    const recipe = data.recipes.find(item => item.id === recipeId);
    const version = recipe && recipe.versions.find(item => item.id === versionId);
    if (!version) fail('Versi ini tidak ditemukan. Buka kembali resep dari koleksi.');
    return { recipe, version };
  }
  function duplicateVersion(data, recipeId, versionId, fields = {}) {
    const next = normalizeData(data);
    const { recipe, version } = findVersion(next, recipeId, versionId);
    recipe.versions.push(validateVersion({ ...version, ...fields, id: uid(), number: Math.max(...recipe.versions.map(item => item.number)) + 1 }));
    return next;
  }
  function updateVersion(data, recipeId, versionId, fields) {
    const next = normalizeData(data);
    const { recipe, version } = findVersion(next, recipeId, versionId);
    recipe.versions[recipe.versions.indexOf(version)] = validateVersion({ ...version, ...fields, id: version.id, number: version.number });
    return next;
  }
  function parseDecimal(input, label = 'Nilai', options = {}) {
    const text = String(input === undefined || input === null ? '' : input).trim();
    if (!text) return null;
    if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) fail(label + ' harus berupa angka yang valid. Gunakan koma atau titik untuk desimal.');
    const value = Number(text.replace(',', '.'));
    return numericValue(value, label, Boolean(options.positive));
  }
  const formatNumber = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 4 }).format(value);
  function ratio(coffeeGrams, waterMl) {
    if (!(coffeeGrams > 0) || !(waterMl > 0) || !Number.isFinite(waterMl / coffeeGrams)) return null;
    return '1:' + formatNumber(waterMl / coffeeGrams);
  }
  function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return 'Belum dicatat';
    const parts = [];
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
    if (hours) parts.push(hours + ' jam');
    if (minutes) parts.push(minutes + ' menit');
    if (rest || !parts.length) parts.push(rest + ' detik');
    return parts.join(' ');
  }
  function formatDate(value) {
    return value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value + 'T12:00:00')) : 'Belum dicatat';
  }
  function compareVersions(left, right) {
    const rows = [];
    const add = (key, label, a, b) => rows.push({ key, label, left: a, right: b, different: a !== b });
    const blank = value => value === null || value === undefined || value === '' ? 'Belum dicatat' : String(value);
    const unit = (value, suffix) => value === null || value === undefined ? 'Belum dicatat' : formatNumber(value) + ' ' + suffix;
    add('name', 'Nama resep', left.name, right.name);
    add('date', 'Tanggal', formatDate(left.date), formatDate(right.date));
    add('category', 'Kategori', CATEGORIES[left.category], CATEGORIES[right.category]);
    for (const [key, label] of [['tool', 'Alat / metode'], ['beans', 'Biji kopi']]) add(key, label, blank(left[key]), blank(right[key]));
    for (const [key, label, suffix] of [['coffeeGrams', 'Dosis kopi', 'g'], ['waterMl', 'Air seduh', 'ml'], ['temperatureC', 'Suhu air', '°C']]) {
      add(key, label, unit(left[key], suffix), unit(right[key], suffix));
      rows[rows.length - 1].different = left[key] !== right[key];
    }
    add('ratio', 'Rasio kopi : air', ratio(left.coffeeGrams, left.waterMl) || 'Belum dicatat', ratio(right.coffeeGrams, right.waterMl) || 'Belum dicatat');
    add('grind', 'Ukuran giling', blank(left.grind), blank(right.grind));
    add('durationSeconds', 'Durasi seduh', formatDuration(left.durationSeconds), formatDuration(right.durationSeconds));
    for (const [key, label] of [['process', 'Langkah / proses'], ['ingredients', 'Bahan tambahan'], ['tastingNotes', 'Tasting notes']]) add(key, label, blank(left[key]), blank(right[key]));
    for (const [key, label] of Object.entries(SCORE_LABELS)) {
      const a = left.scores && left.scores[key], b = right.scores && right.scores[key];
      const score = value => value === undefined || value === null ? 'Belum dinilai' : value + ' / 5';
      add(key, label, score(a), score(b));
    }
    return rows;
  }

  const core = { STORAGE_KEY, SCORE_LABELS, CATEGORIES, EMPTY, validateVersion, normalizeData, parseBackup, serializeBackup, createRecipe, duplicateVersion, updateVersion, parseDecimal, ratio, formatDuration, compareVersions };
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
