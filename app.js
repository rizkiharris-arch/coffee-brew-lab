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
  if (!root.document) return;

  const document = root.document;
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const state = { data: EMPTY(), raw: null, corruptRaw: null, storageProblem: false, view: 'home', recipeId: null, versionId: null, editor: null, dirty: false, pending: null, compareFilter: 'all', confirm: null };
  // Navigation belongs to this tab's history, never to the journal's storage schema.
  const navigation = { session: uid(), index: 0, current: null, busy: false, resume: null, homeScroll: 0 };
  const countVersions = data => data.recipes.reduce((sum, recipe) => sum + recipe.versions.length, 0);
  const latest = recipe => recipe.versions[recipe.versions.length - 1];
  const today = () => { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-'); };
  function notify(message, tone = 'success') {
    $('global-message').textContent = message;
    $('global-message').dataset.tone = tone;
    $('global-message').hidden = false;
  }
  function load() {
    try {
      state.raw = root.localStorage.getItem(STORAGE_KEY);
      state.data = state.raw === null ? EMPTY() : parseBackup(state.raw);
    } catch (error) {
      state.storageProblem = true;
      state.corruptRaw = state.raw;
      $('storage-warning').textContent = 'Catatan tidak dapat dibaca. Data lama belum diubah. Buka Cadangan untuk menyimpan salinan data yang tidak terbaca, atau pulihkan file cadangan yang valid. ' + (state.raw === null ? 'Periksa izin penyimpanan situs di Chrome.' : '');
      $('storage-warning').hidden = false;
    }
  }
  function persist(next, restoring = false) {
    const clean = normalizeData(next);
    if (state.storageProblem && !restoring) fail('Penyimpanan belum dapat dibaca. Isian Anda tetap ada. Pulihkan cadangan yang valid atau periksa izin penyimpanan situs terlebih dahulu.');
    let current;
    try { current = root.localStorage.getItem(STORAGE_KEY); }
    catch { fail('Penyimpanan browser tidak dapat diakses. Isian tetap ada; periksa izin penyimpanan situs di Chrome.'); }
    if (!restoring && current !== state.raw) fail('Catatan telah berubah di tab lain. Isian Anda tetap ada. Salin catatan baru Anda sebelum memuat ulang halaman, lalu buka kembali versi terbaru.');
    const serialized = JSON.stringify(clean);
    try { root.localStorage.setItem(STORAGE_KEY, serialized); }
    catch { fail('Catatan belum tersimpan. Penyimpanan browser mungkin penuh atau diblokir. Isian tetap ada; periksa ruang HP dan izin penyimpanan situs.'); }
    state.data = clean; state.raw = serialized; state.storageProblem = false; state.corruptRaw = null;
    $('storage-warning').hidden = true;
    return clean;
  }
  function ask(title, description, confirmText = 'Lanjutkan') {
    if (state.confirm) return Promise.resolve(false);
    return new Promise(resolve => {
      const dialog = $('confirm-dialog');
      const opener = document.activeElement;
      $('dialog-title').textContent = title; $('dialog-description').textContent = description; $('dialog-confirm').textContent = confirmText;
      const finish = value => {
        if (!state.confirm) return;
        state.confirm = null;
        dialog.close();
        if (opener && opener.isConnected && !opener.closest('[hidden]')) opener.focus({ preventScroll: true });
        resolve(value);
      };
      state.confirm = finish;
      $('dialog-cancel').onclick = () => finish(false);
      $('dialog-confirm').onclick = () => finish(true);
      dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.showModal();
      $('dialog-cancel').focus();
    });
  }
  async function canLeave() {
    if (!state.dirty) return true;
    const allowed = await ask('Tinggalkan isian ini?', 'Perubahan di formulir belum disimpan. Jika kembali sekarang, perubahan ini akan dibuang.', 'Buang perubahan');
    if (allowed) state.dirty = false;
    return allowed;
  }
  function routeSnapshot() {
    return {
      app: 'Coffee Brew Lab', session: navigation.session, index: navigation.index,
      view: state.view, recipeId: state.recipeId, versionId: state.versionId,
      editor: state.editor, compareLeft: $('compare-left').value, compareRight: $('compare-right').value,
      compareFilter: state.compareFilter, scrollY: root.scrollY
    };
  }
  function rememberScroll() {
    if (!navigation.current) return;
    navigation.current = { ...navigation.current, scrollY: root.scrollY };
    if (navigation.current.view === 'home') navigation.homeScroll = root.scrollY;
    root.history.replaceState(navigation.current, '');
  }
  function syncRoute() {
    navigation.current = routeSnapshot();
    root.history.replaceState(navigation.current, '');
  }
  function showView(view, { record = 'push', scrollY = 0 } = {}) {
    if (record !== 'none') rememberScroll();
    state.view = view;
    document.body.dataset.view = view;
    document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== view + '-view'; });
    document.querySelectorAll('[data-nav]').forEach(button => {
      const active = button.dataset.nav === (view === 'backup' ? 'backup' : view === 'editor' ? 'new' : 'home');
      if (button.classList.contains('nav-button')) {
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
      }
    });
    const title = { home: 'Jurnal Seduhan', editor: 'Catat Eksperimen', detail: 'Detail Resep', compare: 'Bandingkan Versi', backup: 'Cadangan Jurnal' }[view];
    document.title = 'Coffee Brew Lab — ' + title;
    if (record === 'push') navigation.index++;
    if (record !== 'none') {
      navigation.current = { ...routeSnapshot(), scrollY };
      root.history[record === 'push' ? 'pushState' : 'replaceState'](navigation.current, '');
    }
    root.scrollTo({ top: scrollY, behavior: 'instant' });
    $('main-content').focus({ preventScroll: true });
  }
  function travelHistory(delta) {
    return new Promise(resolve => {
      navigation.resume = resolve;
      root.history.go(delta);
    });
  }
  function restoreRoute(route) {
    // History can refer to versions removed by a successfully restored backup.
    // Clear hidden comparison DOM as well, so old tasting notes cannot reappear.
    clearComparison();
    state.recipeId = route.recipeId;
    state.versionId = route.versionId;
    state.compareFilter = route.compareFilter === 'different' ? 'different' : 'all';
    try {
      if (route.view === 'editor') {
        const editor = route.editor;
        if (!editor || !['new', 'edit', 'duplicate'].includes(editor.mode)) throw new Error('Invalid editor');
        openEditor(editor.mode, editor.mode === 'new' ? null : selected().version, { record: 'none', scrollY: route.scrollY });
      } else if (route.view === 'detail' || route.view === 'compare') {
        const recipe = state.data.recipes.find(item => item.id === state.recipeId);
        if (!recipe) throw new Error('Recipe no longer available');
        if (!recipe.versions.some(version => version.id === state.versionId)) state.versionId = latest(recipe).id;
        renderDetail();
        const view = route.view === 'compare' && !prepareCompare(route.compareLeft, route.compareRight) ? 'detail' : route.view;
        showView(view, { record: 'none', scrollY: view === route.view ? route.scrollY : 0 });
      } else {
        if (route.view === 'backup') renderBackup(); else renderHome();
        showView(route.view === 'backup' ? 'backup' : 'home', { record: 'none', scrollY: route.scrollY });
      }
    } catch {
      // A restored backup may no longer contain a recipe from an older history entry.
      state.recipeId = null; state.versionId = null; state.dirty = false;
      renderHome(); showView('home', { record: 'none' });
    }
    syncRoute();
  }
  async function onHistoryChange(event) {
    if (navigation.resume) {
      const resume = navigation.resume; navigation.resume = null; resume(); return;
    }
    const target = event.state;
    if (!target || target.session !== navigation.session || !Number.isInteger(target.index)) return;
    const current = navigation.current;
    const delta = target.index - navigation.index;
    if (!delta || navigation.busy) return;
    navigation.busy = true;
    try {
      if (state.confirm || state.dirty) {
        // Return to the untouched editor before asking; cancel preserves both DOM and history.
        await travelHistory(-delta);
        if (state.confirm) { state.confirm(false); return; }
        if (!await canLeave()) return;
        await travelHistory(delta);
      }
      navigation.index = target.index;
      navigation.current = target;
      $('global-message').hidden = true;
      restoreRoute(target);
    } finally {
      navigation.busy = false;
      if (navigation.current === current) root.scrollTo({ top: current.scrollY, behavior: 'instant' });
    }
  }
  function renderHome() {
    const recipes = [...state.data.recipes].reverse();
    $('recipe-count').textContent = recipes.length;
    $('version-count').textContent = countVersions(state.data);
    $('collection-caption').textContent = recipes.length ? recipes.length + ' resep · ' + countVersions(state.data) + ' versi eksperimen' : 'Perjalanan rasa dimulai di sini';
    $('empty-state').hidden = recipes.length !== 0;
    $('home-view').classList.toggle('has-recipes', recipes.length !== 0);
    $('recipe-list').innerHTML = recipes.map(recipe => {
      const version = latest(recipe);
      const score = version.scores.overall;
      return '<article class="recipe-card"><div class="recipe-card-top"><span class="method-badge">' + escape(CATEGORIES[version.category]) + '</span><span class="version-badge">V' + version.number + '</span></div><h3><button type="button" class="card-link" data-open="' + escape(recipe.id) + '">' + escape(version.name) + '</button></h3><p class="recipe-meta">' + escape(version.beans || 'Biji kopi belum dicatat') + '</p><div class="recipe-details"><span>' + (version.coffeeGrams === null ? 'Dosis —' : escape(formatNumber(version.coffeeGrams)) + ' g') + '</span><span>' + escape(ratio(version.coffeeGrams, version.waterMl) || 'Rasio —') + '</span><span>' + escape(version.durationSeconds === null ? 'Durasi —' : formatDuration(version.durationSeconds)) + '</span><span>' + escape(version.tool || CATEGORIES[version.category]) + '</span></div><div class="recipe-footer"><span>' + escape(formatDate(version.date)) + '</span><span class="recipe-version-count">' + recipe.versions.length + ' versi</span><span class="card-rating">' + (score === null ? 'Belum dinilai' : '★ ' + score + ' / 5') + '</span></div></article>';
    }).join('');
  }
  function selected() { return findVersion(state.data, state.recipeId, state.versionId); }
  function renderDetail() {
    const { recipe, version } = selected();
    $('detail-title').textContent = version.name;
    $('detail-subtitle').textContent = [version.beans || 'Biji kopi belum dicatat', formatDate(version.date)].join(' · ');
    $('detail-method').textContent = CATEGORIES[version.category];
    $('compare-button').disabled = recipe.versions.length < 2;
    $('compare-button').title = recipe.versions.length < 2 ? 'Buat versi berikutnya untuk mulai membandingkan.' : '';
    $('compare-help').hidden = recipe.versions.length >= 2;
    $('version-tabs').innerHTML = recipe.versions.map(item => '<button type="button" class="version-tab' + (item.id === version.id ? ' is-active' : '') + '" aria-pressed="' + (item.id === version.id) + '" data-version="' + escape(item.id) + '">V' + item.number + '<span>' + escape(formatDate(item.date)) + '</span></button>').join('');
    const unit = (value, suffix) => value === null ? 'Belum dicatat' : formatNumber(value) + ' ' + suffix;
    const rows = [['Dosis kopi', unit(version.coffeeGrams, 'g')], ['Air seduh', unit(version.waterMl, 'ml')], ['Rasio kopi : air', ratio(version.coffeeGrams, version.waterMl) || 'Belum dicatat'], ['Suhu air', unit(version.temperatureC, '°C')], ['Ukuran giling', version.grind || 'Belum dicatat'], ['Durasi seduh', formatDuration(version.durationSeconds)], ['Alat / metode', version.tool || 'Belum dicatat']];
    const notes = (title, content) => '<section class="detail-card"><h2>' + escape(title) + '</h2><p class="notes-text">' + escape(content || 'Belum dicatat') + '</p></section>';
    const scores = Object.entries(SCORE_LABELS).map(([key, label]) => {
      const value = version.scores[key];
      const meter = value === null ? '' : '<span class="score-meter" aria-hidden="true">' + Array.from({ length: 5 }, (_, index) => '<span class="' + (index < value ? 'is-filled' : '') + '"></span>').join('') + '</span>';
      return '<div class="score-tile' + (key === 'overall' ? ' is-overall' : '') + '"><span class="score-name">' + escape(label) + '</span><strong class="score-value">' + (value === null ? '<span class="score-unrated">Belum dinilai</span>' : value + '<small> / 5</small>') + '</strong>' + meter + '</div>';
    }).join('');
    $('detail-content').innerHTML = '<div class="detail-grid"><section class="detail-card"><h2>Detail seduhan <span class="version-badge">V' + version.number + '</span></h2><dl class="detail-list">' + rows.map(([label, value]) => '<div><dt>' + escape(label) + '</dt><dd>' + escape(value) + '</dd></div>').join('') + '</dl></section><section class="detail-card"><h2>Karakter rasa</h2><div class="score-summary">' + scores + '</div><p class="score-hint">1 = rendah, 5 = tinggi. Intensitas bukan penilaian baik atau buruk. Nilai keseluruhan adalah preferensi Anda.</p></section>' + notes('Tasting notes', version.tastingNotes) + notes('Langkah / catatan proses', version.process) + notes('Bahan tambahan', version.ingredients) + '</div>';
  }
  function renderCompare() {
    const { recipe } = selected();
    const a = recipe.versions.find(version => version.id === $('compare-left').value);
    const b = recipe.versions.find(version => version.id === $('compare-right').value);
    if (!a || !b) return;
    const rows = compareVersions(a, b);
    const differences = rows.filter(row => row.different).length;
    $('comparison-summary').textContent = a.id === b.id ? 'Anda memilih versi yang sama. Pilih versi lain untuk menemukan perbedaan.' : differences ? differences + ' bagian berbeda antara V' + a.number + ' dan V' + b.number + '.' : 'Belum ada perbedaan isi antara kedua versi ini.';
    const visible = rows.filter(row => state.compareFilter !== 'different' || row.different);
    $('comparison-empty').hidden = visible.length !== 0;
    $('comparison-list').hidden = visible.length === 0;
    document.querySelectorAll('[data-compare-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.compareFilter === state.compareFilter)));
    $('comparison-list').innerHTML = visible.map(row => '<div class="comparison-row' + (row.different ? ' is-different' : '') + (['process', 'ingredients', 'tastingNotes'].includes(row.key) ? ' is-long' : '') + '" data-compare-key="' + row.key + '"><div class="comparison-label">' + escape(row.label) + (row.different ? '<span class="difference-tag">Berbeda</span>' : '') + '</div><div class="comparison-values"><div class="comparison-value"><small>V' + a.number + '</small><strong>' + escape(row.left) + '</strong></div><div class="comparison-value"><small>V' + b.number + '</small><strong>' + escape(row.right) + '</strong></div></div></div>').join('');
  }
  function clearComparison() {
    for (const id of ['compare-left', 'compare-right']) {
      $(id).innerHTML = ''; $(id).value = '';
    }
    $('compare-subtitle').textContent = '';
    $('comparison-summary').textContent = '';
    $('comparison-list').innerHTML = ''; $('comparison-list').hidden = true;
    $('comparison-empty').hidden = true;
  }
  function prepareCompare(leftId, rightId) {
    clearComparison();
    const { recipe } = selected();
    if (recipe.versions.length < 2) return false;
    $('compare-subtitle').textContent = latest(recipe).name + ' · Bagian yang berubah diberi penanda.';
    const options = recipe.versions.map(version => '<option value="' + escape(version.id) + '">V' + version.number + ' · ' + escape(formatDate(version.date)) + '</option>').join('');
    $('compare-left').innerHTML = options; $('compare-right').innerHTML = options;
    $('compare-left').value = recipe.versions.some(version => version.id === leftId) ? leftId : recipe.versions[Math.max(0, recipe.versions.length - 2)].id;
    $('compare-right').value = recipe.versions.some(version => version.id === rightId) ? rightId : latest(recipe).id;
    renderCompare();
    return true;
  }
  function openCompare() {
    if (navigation.busy || selected().recipe.versions.length < 2) return;
    state.compareFilter = 'all';
    if (prepareCompare()) showView('compare');
  }
  function updateRatio() {
    let value = null;
    try { value = ratio(parseDecimal($('coffee-grams').value), parseDecimal($('water-ml').value)); } catch { /* Keep the hint while typing. */ }
    $('ratio-preview').textContent = value ? 'Rasio kopi : air  ' + value + ' · Bahan tambahan tidak dihitung.' : 'Rasio kopi : air akan muncul saat dosis dan air terisi.';
  }
  const fieldIds = { name: 'recipe-name', date: 'brew-date', category: 'category', tool: 'tool', beans: 'beans', coffeeGrams: 'coffee-grams', waterMl: 'water-ml', temperatureC: 'temperature', grind: 'grind', process: 'process', ingredients: 'ingredients', tastingNotes: 'tasting-notes' };
  function clearFormErrors() {
    $('form-error').hidden = true;
    $('recipe-form').querySelectorAll('[aria-invalid]').forEach(field => {
      field.removeAttribute('aria-invalid');
      const errorId = field.id + '-error';
      const descriptions = (field.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== errorId);
      if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' ')); else field.removeAttribute('aria-describedby');
    });
    $('recipe-form').querySelectorAll('.field-error').forEach(error => error.remove());
  }
  function setScore(key, value) {
    $(key).querySelectorAll('input[type="radio"]').forEach(input => { input.checked = input.value === String(value ?? ''); });
  }
  function readScore(key) {
    const input = $(key).querySelector('input:checked');
    return !input || input.value === '' ? null : Number(input.value);
  }
  function openEditor(mode, source = null, options = {}) {
    state.editor = { mode, recipeId: state.recipeId, versionId: state.versionId };
    $('recipe-form').reset(); clearFormErrors();
    for (const [key, id] of Object.entries(fieldIds)) $(id).value = source ? source[key] ?? '' : key === 'date' ? today() : '';
    for (const key of Object.keys(SCORE_LABELS)) setScore(key, source ? source.scores[key] : null);
    if (source && source.durationSeconds !== null) {
      $('duration-hours').value = Math.floor(source.durationSeconds / 3600);
      $('duration-minutes').value = Math.floor(source.durationSeconds % 3600 / 60);
      $('duration-seconds').value = source.durationSeconds % 60;
    }
    const number = mode === 'new' ? 1 : mode === 'edit' ? source.number : Math.max(...selected().recipe.versions.map(version => version.number)) + 1;
    $('editor-version').textContent = 'V' + number;
    $('editor-eyebrow').textContent = mode === 'new' ? 'EKSPERIMEN PERTAMA' : mode === 'edit' ? 'PERBAIKI CATATAN VERSI INI' : 'SATU LANGKAH LEBIH DEKAT';
    $('editor-title').textContent = mode === 'new' ? 'Catat seduhan baru.' : mode === 'edit' ? 'Perbarui eksperimen V' + number + '.' : 'Racik eksperimen V' + number + '.';
    $('save-button').textContent = mode === 'edit' ? 'Simpan perubahan' : 'Simpan eksperimen';
    state.dirty = false; updateRatio(); showView('editor', options);
  }
  function readForm() {
    const fields = {};
    for (const [key, id] of Object.entries(fieldIds)) fields[key] = $(id).value.trim();
    if (!fields.name) fail('Isi nama resep terlebih dahulu.', 'recipe-name');
    if (!Object.hasOwn(CATEGORIES, fields.category)) fail('Pilih kategori seduhan.', 'category');
    if ($('brew-date').validity.badInput) fail('Tanggal seduh tidak valid.', 'brew-date');
    for (const [key, label, positive] of [['coffeeGrams', 'Dosis kopi', true], ['waterMl', 'Air seduh', true], ['temperatureC', 'Suhu air', false]]) {
      try { fields[key] = parseDecimal(fields[key], label, { positive }); }
      catch (error) { error.field = fieldIds[key]; throw error; }
    }
    const ids = ['duration-hours', 'duration-minutes', 'duration-seconds'];
    const values = ids.map((id, index) => {
      const text = $(id).value;
      if ($(id).validity.badInput || (text && !/^\d+$/.test(text))) fail('Isi durasi dengan bilangan bulat nol atau lebih.', id);
      const value = text === '' ? 0 : Number(text);
      if (!Number.isSafeInteger(value) || (index > 0 && value > 59)) fail(index > 0 ? 'Menit dan detik harus berada antara 0–59. Gunakan kolom Jam untuk durasi yang lebih panjang.' : 'Durasi jam tidak valid.', id);
      return value;
    });
    fields.durationSeconds = ids.every(id => $(id).value === '') ? null : values[0] * 3600 + values[1] * 60 + values[2];
    fields.scores = {};
    for (const key of Object.keys(SCORE_LABELS)) fields.scores[key] = readScore(key);
    return fields;
  }
  function formError(error) {
    $('form-error').textContent = error.message; $('form-error').hidden = false;
    if (error.field && $(error.field)) {
      const field = $(error.field), errorId = error.field + '-error';
      const message = document.createElement('p');
      message.className = 'field-error'; message.id = errorId; message.textContent = error.message;
      const target = field.closest('.field') || field.parentElement;
      target.append(message);
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), errorId].filter(Boolean).join(' '));
      (field.querySelector('input') || field).focus();
    }
    else $('form-error').scrollIntoView({ block: 'center' });
  }
  function saveForm(event) {
    event.preventDefault();
    if (navigation.busy || state.confirm) return;
    clearFormErrors();
    try {
      const fields = readForm();
      const editor = state.editor;
      let next;
      if (editor.mode === 'new') next = createRecipe(state.data, fields);
      else if (editor.mode === 'duplicate') next = duplicateVersion(state.data, editor.recipeId, editor.versionId, fields);
      else next = updateVersion(state.data, editor.recipeId, editor.versionId, fields);
      const result = persist(next);
      if (editor.mode === 'new') { const recipe = result.recipes[result.recipes.length - 1]; state.recipeId = recipe.id; state.versionId = latest(recipe).id; }
      else { state.recipeId = editor.recipeId; state.versionId = editor.mode === 'duplicate' ? latest(result.recipes.find(recipe => recipe.id === editor.recipeId)).id : editor.versionId; }
      state.dirty = false; renderHome(); renderDetail(); showView('detail', { record: 'replace' }); notify('Eksperimen V' + selected().version.number + ' tersimpan di browser ini.');
    } catch (error) { formError(error); }
  }
  function renderBackup() {
    $('backup-count').textContent = state.data.recipes.length + ' resep · ' + countVersions(state.data) + ' versi eksperimen';
    $('export-button').disabled = state.storageProblem;
    $('export-raw-button').hidden = state.corruptRaw === null;
    try {
      const last = root.localStorage.getItem(BACKUP_KEY);
      $('last-backup').textContent = last && !Number.isNaN(Date.parse(last)) ? 'Unduhan terakhir dimulai: ' + new Date(last).toLocaleString('id-ID') + '. Periksa file di Downloads.' : 'File cadangan akan diunduh ke HP Anda.';
    } catch { $('last-backup').textContent = 'File cadangan akan diunduh ke HP Anda.'; }
  }
  function download(text, filename) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    root.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function importFile(event) {
    state.pending = null; $('restore-button').disabled = true;
    const file = event.target.files[0];
    if (!file) { $('import-summary').hidden = true; return; }
    const token = file;
    $('import-summary').textContent = 'Memeriksa file…'; $('import-summary').hidden = false; $('import-summary').dataset.tone = 'info';
    try {
      if (file.size > 5 * 1024 * 1024) fail('File terlalu besar. Batas cadangan tahap awal adalah 5 MB.');
      const data = parseBackup(await file.text());
      if ($('import-file').files[0] !== token) return;
      state.pending = data;
      $('import-summary').textContent = 'File valid: ' + data.recipes.length + ' resep dan ' + countVersions(data) + ' versi. Seluruh catatan saat ini akan diganti. Cadangkan terlebih dahulu jika masih diperlukan.';
      $('import-summary').dataset.tone = 'success'; $('restore-button').disabled = false;
    } catch (error) {
      if ($('import-file').files[0] !== token) return;
      $('import-summary').textContent = error.message + ' Catatan saat ini belum diubah.'; $('import-summary').dataset.tone = 'error';
    }
  }
  async function restore() {
    if (!state.pending) return;
    const data = state.pending;
    if (!await ask('Ganti seluruh catatan?', 'Pulihkan ' + data.recipes.length + ' resep dan ' + countVersions(data) + ' versi dari file ini. Seluruh catatan saat ini akan diganti. Unduh cadangan terlebih dahulu jika belum memilikinya.', 'Ya, pulihkan')) return;
    try {
      persist(data, true); state.pending = null; state.recipeId = null; state.versionId = null;
      clearComparison(); state.compareFilter = 'all';
      $('import-file').value = ''; $('import-summary').hidden = true; $('restore-button').disabled = true;
      renderHome(); renderBackup(); notify('Cadangan berhasil dipulihkan. Semua resep dan skor tersedia di koleksi.');
    } catch (error) { notify(error.message + ' Catatan lama belum diubah.', 'error'); }
  }
  async function navigate(target) {
    if (navigation.busy || state.confirm) return;
    if ((target === 'home' && state.view === 'home') || (target === 'backup' && state.view === 'backup')) return;
    if (!await canLeave()) return;
    $('global-message').hidden = true;
    if (target === 'new') openEditor('new');
    else if (target === 'backup') { renderBackup(); showView('backup'); }
    else { renderHome(); showView('home', { scrollY: navigation.homeScroll }); }
  }
  async function backFromEditor() {
    if (navigation.busy || state.confirm) return;
    if (!await canLeave()) return;
    $('global-message').hidden = true;
    if (navigation.index > 0) root.history.back();
    else { renderHome(); showView('home', { record: 'replace', scrollY: navigation.homeScroll }); }
  }
  function backToDetail() {
    if (navigation.busy || state.confirm) return;
    if (navigation.index > 0) root.history.back();
    else { renderDetail(); showView('detail', { record: 'replace' }); }
  }
  function updateViewport() {
    const viewport = root.visualViewport;
    // Chrome normally resizes the layout viewport for the keyboard. This also handles overlay keyboards.
    const offset = viewport ? Math.max(0, root.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-offset', Math.round(offset) + 'px');
  }
  function start() {
    load(); renderHome();
    if ('scrollRestoration' in root.history) root.history.scrollRestoration = 'manual';
    const saved = root.history.state;
    if (saved && saved.app === 'Coffee Brew Lab' && typeof saved.session === 'string' && Number.isInteger(saved.index)) {
      navigation.session = saved.session; navigation.index = saved.index;
      if (saved.view === 'home') navigation.homeScroll = saved.scrollY || 0;
      if (saved.view === 'editor') showView('home', { record: 'replace' }); else restoreRoute(saved);
    } else showView('home', { record: 'replace' });
    root.addEventListener('popstate', onHistoryChange);
    let scrollFrame = null;
    root.addEventListener('scroll', () => {
      if (scrollFrame !== null || navigation.busy) return;
      scrollFrame = root.requestAnimationFrame(() => {
        scrollFrame = null;
        if (!navigation.busy) rememberScroll();
      });
    }, { passive: true });
    updateViewport();
    if (root.visualViewport) {
      root.visualViewport.addEventListener('resize', updateViewport);
      root.visualViewport.addEventListener('scroll', updateViewport);
    }
    document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); navigate('home'); });
    document.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button || navigation.busy) return;
      if (button.dataset.nav) await navigate(button.dataset.nav);
      else if (button.dataset.action === 'new') await navigate('new');
      else if (button.dataset.action === 'back') await backFromEditor();
      else if (button.dataset.action === 'detail') backToDetail();
      else if (button.dataset.open) {
        const recipe = state.data.recipes.find(item => item.id === button.dataset.open);
        if (recipe) { state.recipeId = recipe.id; state.versionId = latest(recipe).id; $('global-message').hidden = true; renderDetail(); showView('detail'); }
      } else if (button.dataset.version) {
        state.versionId = button.dataset.version; renderDetail(); syncRoute();
        const active = $('version-tabs').querySelector('[aria-pressed="true"]');
        active.focus({ preventScroll: true });
      } else if (button.dataset.compareFilter) {
        state.compareFilter = button.dataset.compareFilter === 'different' ? 'different' : 'all';
        renderCompare(); syncRoute();
      }
    });
    $('recipe-form').addEventListener('submit', saveForm);
    $('recipe-form').addEventListener('input', () => { state.dirty = true; });
    $('recipe-form').addEventListener('change', () => { state.dirty = true; });
    $('coffee-grams').addEventListener('input', updateRatio); $('water-ml').addEventListener('input', updateRatio);
    $('edit-button').addEventListener('click', () => { if (navigation.busy) return; $('global-message').hidden = true; openEditor('edit', selected().version); });
    $('duplicate-button').addEventListener('click', () => { if (navigation.busy) return; $('global-message').hidden = true; openEditor('duplicate', selected().version); });
    $('compare-button').addEventListener('click', openCompare);
    for (const id of ['compare-left', 'compare-right']) $(id).addEventListener('change', () => { renderCompare(); syncRoute(); });
    $('export-button').addEventListener('click', () => {
      try {
        const now = new Date().toISOString();
        download(serializeBackup(state.data, now), 'coffee-brew-lab-' + now.replace(/[:.]/g, '-') + '.json');
        try { root.localStorage.setItem(BACKUP_KEY, now); } catch { /* Export remains usable if only metadata fails. */ }
        renderBackup(); notify('Unduhan cadangan dimulai. Periksa folder Downloads di HP Anda.');
      } catch (error) { notify(error.message, 'error'); }
    });
    $('export-raw-button').addEventListener('click', () => { if (state.corruptRaw !== null) download(state.corruptRaw, 'coffee-brew-lab-data-perlu-diperiksa.json'); });
    $('import-file').addEventListener('change', importFile); $('restore-button').addEventListener('click', restore);
    root.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
    root.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) notify('Catatan diubah dari tab lain. Muat ulang halaman sebelum melanjutkan. Jika ada isian yang belum disimpan, salin terlebih dahulu.', 'info'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
