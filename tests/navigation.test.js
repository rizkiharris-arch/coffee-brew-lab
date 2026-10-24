'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../app.js');

// These tests execute the real route/render functions with small DOM/history stubs.
// They verify stale-route recovery; they are not browser, layout or Android tests.
function harness() {
  const nodes = new Map();
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    let html = '';
    const element = {
      id, value: '', textContent: '', hidden: false, disabled: false,
      dataset: {}, attributes: {}, classList: { toggle() {}, contains() { return false; } },
      focus() {}, setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = value;
        if (id === 'compare-left' || id === 'compare-right') {
          this.value = /<option value="([^"]*)"/.exec(value)?.[1] || '';
        }
      }
    };
    nodes.set(id, element);
    return element;
  }
  const views = ['home', 'editor', 'detail', 'compare', 'backup'].map(view => node(view + '-view'));
  const filters = ['all', 'different'].map(value => {
    const button = node('filter-' + value);
    button.dataset.compareFilter = value;
    return button;
  });
  const replacements = [], pushes = [];
  let storageAccesses = 0;
  const context = vm.createContext({
    module: { exports: {} },
    document: {
      body: { dataset: {} },
      getElementById: node,
      querySelectorAll(selector) {
        if (selector === '.view') return views;
        if (selector === '[data-compare-filter]') return filters;
        return [];
      }
    },
    scrollY: 0,
    scrollTo({ top }) { context.scrollY = top; },
    history: {
      replaceState(route) { replacements.push(JSON.parse(JSON.stringify(route))); },
      pushState(route) { pushes.push(route); }
    },
    localStorage: {
      getItem() { storageAccesses++; throw new Error('Routes must not read journal storage'); },
      setItem() { storageAccesses++; throw new Error('Routes must not write journal storage'); }
    }
  });
  const source = readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const startup = "  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();";
  assert.equal(source.split(startup).length, 2, 'test harness must replace only the startup call');
  vm.runInContext(source.replace(startup,
    '  root.testUI = { state, navigation, restoreRoute, prepareCompare };'), context);
  const api = context.testUI;
  api.navigation.index = 7;
  return { api, node, replacements, pushes, storageAccesses: () => storageAccesses };
}

function data(versionNumbers) {
  return core.normalizeData({ schemaVersion: 1, recipes: [{ id: 'recipe-a', versions: versionNumbers.map(number => ({
    id: 'version-' + number, number, name: 'V60 version ' + number,
    category: 'manual', coffeeGrams: 15, waterMl: 225 + number
  })) }] });
}
function route(overrides = {}) {
  return { view: 'compare', recipeId: 'recipe-a', versionId: 'version-1',
    compareLeft: 'version-1', compareRight: 'version-2', compareFilter: 'all', scrollY: 240, ...overrides };
}
function populateOldCompare(h) {
  h.api.state.data = data([1, 2]);
  h.api.restoreRoute(route());
  assert.equal(h.api.state.view, 'compare');
  assert.match(h.node('comparison-list').innerHTML, /data-compare-key=/);
}
function assertComparisonCleared(h) {
  assert.equal(h.node('compare-left').value, '');
  assert.equal(h.node('compare-right').value, '');
  assert.equal(h.node('compare-left').innerHTML, '');
  assert.equal(h.node('compare-right').innerHTML, '');
  assert.equal(h.node('comparison-list').innerHTML, '');
  assert.equal(h.node('comparison-summary').textContent, '');
  assert.equal(h.node('compare-subtitle').textContent, '');
}
function assertNoStorageOrHistoryPush(h, expectedView) {
  assert.equal(h.storageAccesses(), 0);
  assert.equal(h.pushes.length, 0, 'route recovery replaces the existing entry rather than adding one');
  assert.equal(h.api.navigation.index, 7);
  assert.equal(h.replacements.at(-1).index, 7);
  assert.equal(h.replacements.at(-1).view, expectedView);
}

test('old compare history becomes detail after restoring the same recipe with one version', () => {
  const h = harness(); populateOldCompare(h);
  h.api.state.data = data([1]);
  const before = JSON.stringify(h.api.state.data);
  h.api.restoreRoute(route());
  assert.equal(h.api.state.view, 'detail');
  assert.equal(h.api.state.versionId, 'version-1');
  assert.equal(h.node('compare-view').hidden, true);
  assert.equal(h.node('detail-view').hidden, false);
  assert.equal(h.node('compare-button').disabled, true);
  assert.equal(h.node('compare-help').hidden, false);
  assertComparisonCleared(h);
  assert.equal(JSON.stringify(h.api.state.data), before);
  assertNoStorageOrHistoryPush(h, 'detail');
});

test('a removed selected version recovers to the remaining version of the same recipe', () => {
  const h = harness(); populateOldCompare(h);
  h.api.state.data = data([1]);
  h.api.restoreRoute(route({ versionId: 'version-2' }));
  assert.equal(h.api.state.view, 'detail');
  assert.equal(h.api.state.versionId, 'version-1');
  assert.equal(h.node('detail-title').textContent, 'V60 version 1');
  assertComparisonCleared(h);
  assertNoStorageOrHistoryPush(h, 'detail');
});

test('a recipe absent from the restored backup returns home and clears stale comparison', () => {
  const h = harness(); populateOldCompare(h);
  h.api.state.data = core.EMPTY();
  h.api.restoreRoute(route());
  assert.equal(h.api.state.view, 'home');
  assert.equal(h.api.state.recipeId, null);
  assert.equal(h.api.state.versionId, null);
  assert.equal(h.node('home-view').hidden, false);
  assertComparisonCleared(h);
  assertNoStorageOrHistoryPush(h, 'home');
});

test('missing version selections in a valid comparison recover to the latest two versions', () => {
  const h = harness(); populateOldCompare(h);
  h.api.state.data = data([3, 5, 8]);
  h.api.restoreRoute(route({ versionId: 'version-2' }));
  assert.equal(h.api.state.view, 'compare');
  assert.equal(h.api.state.versionId, 'version-8');
  assert.equal(h.node('compare-left').value, 'version-5');
  assert.equal(h.node('compare-right').value, 'version-8');
  assert.equal((h.node('comparison-list').innerHTML.match(/data-compare-key=/g) || []).length, 19);
  assertNoStorageOrHistoryPush(h, 'compare');
});

test('valid historical pairs retain their chosen order and allow the same version', () => {
  const h = harness();
  h.api.state.data = data([1, 2, 3]);
  h.api.restoreRoute(route({ versionId: 'version-3', compareLeft: 'version-3', compareRight: 'version-1' }));
  assert.equal(h.api.state.view, 'compare');
  assert.equal(h.node('compare-left').value, 'version-3');
  assert.equal(h.node('compare-right').value, 'version-1');
  h.api.restoreRoute(route({ compareLeft: 'version-1', compareRight: 'version-1' }));
  assert.match(h.node('comparison-summary').textContent, /versi yang sama/);
  assert.equal((h.node('comparison-list').innerHTML.match(/data-compare-key=/g) || []).length, 19);
  assertNoStorageOrHistoryPush(h, 'compare');
});

test('preparing comparison for a single version reports failure and clears the old DOM', () => {
  const h = harness(); populateOldCompare(h);
  h.api.state.data = data([1]);
  assert.equal(h.api.prepareCompare('version-1', 'version-2'), false);
  assertComparisonCleared(h);
  assert.equal(h.storageAccesses(), 0);
});
