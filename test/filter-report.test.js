import assert from 'node:assert/strict';
import test from 'node:test';
import { filterReadiness, filterRecord, filterSummary } from '../lib/filter-report.js';

function record(sequence = 1) {
  return { sequence, action: sequence === 1 ? 'filter_apply' : 'filter_reset',
    status: 'passed', durationMs: 123, selectionVerified: true,
    spinnerSeen: true, spinnerCleared: true, rendererChanged: true, widgetsReady: true };
}
test('filter records exclude identities and require UI refresh and persisted selection evidence', () => {
  assert.deepEqual(filterRecord({ ...record(), value: 'PRIVATE', label: 'PRIVATE' }), record());
  for (const change of [
    { action: 'global_reset' }, { sequence: 3 }, { durationMs: -1 }, { durationMs: NaN },
    { selectionVerified: false }, { spinnerSeen: false }, { spinnerCleared: false },
    { rendererChanged: false }, { widgetsReady: false },
  ]) assert.throws(() => filterRecord({ ...record(), ...change }));
});
test('filter completion requires both passed actions in order, not just a restoration', () => {
  const apply = filterRecord(record());
  const reset = filterRecord(record(2));
  assert.equal(filterSummary([apply, reset]).complete, true);
  assert.equal(filterSummary([apply]).complete, false);
  assert.equal(filterSummary([reset, apply]).complete, false);
  const failed = filterRecord({ ...record(), status: 'failed', spinnerSeen: false });
  const summary = filterSummary([failed, reset]);
  assert.equal(summary.complete, false);
  assert.equal(summary.restorationVerified, true);
});

test('filter guard diagnostics allow only predefined non-sensitive reasons', () => {
  const failure = { ...record(), status: 'failed', durationMs: 0,
    stage: 'prepare', guardReason: 'option_count', originalCaptured: false };
  assert.deepEqual(filterRecord({ ...failure, secret: 'PRIVATE' }), failure);
  for (const change of [{ stage: 'PRIVATE' }, { guardReason: 'PRIVATE' }, { originalCaptured: 'PRIVATE' }]) {
    assert.throws(() => filterRecord({ ...failure, ...change }));
  }
});

test('option comparisons retain only bounded counts and booleans, never label text', () => {
  const value = { ...record(), status: 'failed', stage: 'verify',
    guardReason: 'option_set', originalCaptured: true, optionComparison: {
      originalCount: 3, currentCount: 3, exactMatchCount: 2, counterIndependentMatchCount: 3,
      targetPresent: false, auxiliaryStateMatches: true,
    } };
  const input = structuredClone(value);
  input.optionComparison.labels = ['PRIVATE'];
  assert.deepEqual(filterRecord(input), value);
  for (const change of [
    { originalCount: 101 }, { currentCount: -1 }, { exactMatchCount: 4 },
    { counterIndependentMatchCount: 1 }, { targetPresent: 'PRIVATE' },
    { auxiliaryStateMatches: null },
  ]) assert.throws(() => filterRecord({ ...value, optionComparison: { ...value.optionComparison, ...change } }));
  assert.throws(() => filterRecord({ ...value, status: 'passed' }));
});

test('case-only diagnostics are optional for historical records and reject collisions disguised as unique', () => {
  const value = { ...record(), status: 'failed', stage: 'verify', guardReason: 'option_set',
    originalCaptured: true, optionComparison: {
      originalCount: 2, currentCount: 2, exactMatchCount: 1, counterIndependentMatchCount: 1,
      targetPresent: false, auxiliaryStateMatches: true, caseInsensitiveMatchCount: 2,
      caseInsensitiveTargetCount: 1, caseInsensitiveUnique: true,
    } };
  assert.deepEqual(filterRecord(value), value);
  for (const change of [
    { caseInsensitiveMatchCount: 0 }, { caseInsensitiveMatchCount: 3 },
    { caseInsensitiveTargetCount: -1 }, { caseInsensitiveTargetCount: 2 },
    { caseInsensitiveUnique: 'PRIVATE' }, { caseInsensitiveUnique: undefined },
    { caseInsensitiveMatchCount: undefined },
  ]) assert.throws(() => filterRecord({ ...value, optionComparison: { ...value.optionComparison, ...change } }));
  const collision = { ...value, optionComparison: { ...value.optionComparison,
    caseInsensitiveUnique: false, caseInsensitiveTargetCount: 2 } };
  assert.deepEqual(filterRecord(collision), collision);
});

const tab = { name: 'PRIVATE_TAB', initialWidgets: ['PRIVATE_CHART', 'PRIVATE_GRID'] };
function snapshot() {
  return { scroll: { top: 0 }, selectedTabs: [tab.name],
    widgets: tab.initialWidgets.map((title) => ({ title, state: 'ready_chart' })) };
}
function refreshFailure() {
  return { ...record(), status: 'failed', widgetsReady: false, stage: 'refresh',
    guardReason: 'none', originalCaptured: true,
    refresh: { applicationObserved: true, popupClosed: true,
      readiness: filterReadiness(snapshot(), tab).diagnostics } };
}

test('filter readiness diagnostics distinguish scroll, tab and widget blockers without identities', () => {
  assert.equal(filterReadiness(snapshot(), tab).ready, true);
  for (const change of [
    { scroll: { top: 1 } }, { selectedTabs: [] }, { selectedTabs: ['PRIVATE_OTHER'] },
    { selectedTabs: [tab.name, 'PRIVATE_OTHER'] },
    { widgets: snapshot().widgets.slice(1) },
    { widgets: [...snapshot().widgets, { title: 'PRIVATE_EXTRA', state: 'ready_chart' }] },
    { widgets: [snapshot().widgets[0], snapshot().widgets[0]] },
  ]) {
    const result = filterReadiness({ ...snapshot(), ...change }, tab);
    assert.equal(result.ready, false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
  assert.equal(filterReadiness({ ...snapshot(), widgets: [] }, tab).diagnostics.widgets[0].state, 'missing');
  assert.equal(filterReadiness({ ...snapshot(), widgets: [snapshot().widgets[0], snapshot().widgets[0]] },
    tab).diagnostics.widgets[0].state, 'duplicate');
});

test('filter readiness retains exact renderer failure state and rejects error/no-data results', () => {
  for (const state of ['ready_chart', 'ready_grid', 'ready_pivot', 'error', 'no_data', 'loading',
    'missing_points', 'missing_rows', 'missing_cells', 'unsupported']) {
    const value = snapshot();
    value.widgets[0].state = state;
    const result = filterReadiness(value, tab);
    assert.equal(result.diagnostics.widgets[0].state, state);
    assert.equal(result.ready, state.startsWith('ready_'));
    assert.equal(result.invalidResult, ['error', 'no_data'].includes(state));
  }
});

test('refresh diagnostics project only bounded booleans, counts, indices and known states', () => {
  const failure = refreshFailure();
  const input = structuredClone(failure);
  input.refresh.rawError = 'PRIVATE';
  input.refresh.readiness.selectedTabs = ['PRIVATE'];
  input.refresh.readiness.widgets[0].title = 'PRIVATE';
  assert.deepEqual(filterRecord(input), failure);
  const changes = [
    (value) => { value.refresh.applicationObserved = 'PRIVATE'; },
    (value) => { value.refresh.popupClosed = null; },
    (value) => { value.refresh.readiness.scrollTop = -1; },
    (value) => { value.refresh.readiness.scrollTop = 10000001; },
    (value) => { value.refresh.readiness.visibleWidgetCount = 10001; },
    (value) => { value.refresh.readiness.selectedTabCount = 0.5; },
    (value) => { value.refresh.readiness.expectedTabSelected = 'PRIVATE'; },
    (value) => { value.refresh.readiness.unexpectedWidgetCount = 1; },
    (value) => { value.refresh.readiness.widgets[0].state = 'PRIVATE'; },
    (value) => { value.refresh.readiness.widgets[0].state = 'missing'; },
    (value) => { value.refresh.readiness.widgets[0].matches = 2; },
    (value) => { value.refresh.readiness.widgets[0].widgetIndex = 1; },
    (value) => { value.refresh.readiness.widgets = []; },
    (value) => { value.refresh.readiness.widgets = Array(101).fill({}); },
    (value) => { value.stage = 'prepare'; },
    (value) => { value.status = 'passed'; value.widgetsReady = true; },
  ];
  for (const change of changes) {
    const value = structuredClone(failure);
    change(value);
    assert.throws(() => filterRecord(value));
  }
});

function structureFailure() {
  return { ...refreshFailure(), structureInspection: {
    status: 'captured',
    widgets: [0, 1].map((widgetIndex) => ({
      widgetIndex, matches: 1, structure: {
        scanned: 1, visibleCount: 1, scanTruncated: false, treeTruncated: false,
        counts: { svg: 0, canvas: 1, iframe: 0, table: 0, image: 0,
          highcharts: 0, grid: 0, pivot: 0, alert: 0, status: 0, progress: 0 },
        nodes: [{ tag: 'canvas', role: 'none', depth: 0, visible: true, hasDirectText: false }],
      },
    })),
  } };
}

test('structural inspection projects only bounded known shapes and excludes arbitrary DOM content', () => {
  const value = structureFailure();
  const input = structuredClone(value);
  input.structureInspection.html = 'PRIVATE';
  input.structureInspection.widgets[0].title = 'PRIVATE';
  input.structureInspection.widgets[0].structure.counts.PRIVATE = 1;
  Object.assign(input.structureInspection.widgets[0].structure.nodes[0], {
    text: 'PRIVATE', className: 'PRIVATE', src: 'PRIVATE', dataTestId: 'PRIVATE',
  });
  assert.deepEqual(filterRecord(input), value);
  assert.equal(filterSummary([filterRecord(input), record(2)]).complete, false);
  const unavailable = { ...refreshFailure(), structureInspection: { status: 'unavailable' } };
  assert.deepEqual(filterRecord(unavailable), unavailable);
  const missing = structureFailure();
  missing.structureInspection.widgets[0] = { widgetIndex: 0, matches: 0 };
  assert.deepEqual(filterRecord(missing), missing);
});

test('structural inspection rejects unknown codes, malformed shapes and excessive traversal or output', () => {
  const changes = [
    (v) => { v.structureInspection.status = 'PRIVATE'; },
    (v) => { v.structureInspection.status = 'unavailable'; },
    (v) => { v.structureInspection.widgets = []; },
    (v) => { v.structureInspection.widgets[0].matches = -1; },
    (v) => { v.structureInspection.widgets[0].matches = 0; },
    (v) => { v.structureInspection.widgets[0].widgetIndex = 1; },
    (v) => { v.structureInspection.widgets[0].structure = null; },
    (v) => { v.structureInspection.widgets[0].structure.scanned = 201; },
    (v) => { v.structureInspection.widgets[0].structure.visibleCount = 2; },
    (v) => { v.structureInspection.widgets[0].structure.scanTruncated = true; },
    (v) => { v.structureInspection.widgets[0].structure.treeTruncated = true; },
    (v) => { v.structureInspection.widgets[0].structure.counts.canvas = 2; },
    (v) => { v.structureInspection.widgets[0].structure.nodes = Array(41).fill({}); },
    (v) => { v.structureInspection.widgets[0].structure.nodes[0].tag = 'PRIVATE'; },
    (v) => { v.structureInspection.widgets[0].structure.nodes[0].role = 'PRIVATE'; },
    (v) => { v.structureInspection.widgets[0].structure.nodes[0].depth = 33; },
    (v) => { v.structureInspection.widgets[0].structure.nodes[0].visible = 'PRIVATE'; },
    (v) => { v.structureInspection.widgets[0].structure.nodes[0].hasDirectText = 'PRIVATE'; },
    (v) => { delete v.refresh; },
  ];
  for (const change of changes) {
    const value = structureFailure();
    change(value);
    assert.throws(() => filterRecord(value));
  }
  const capped = structureFailure();
  const structure = capped.structureInspection.widgets[0].structure;
  Object.assign(structure, { scanned: 200, visibleCount: 200, scanTruncated: true, treeTruncated: true });
  structure.nodes = Array.from({ length: 40 }, () => ({ ...structure.nodes[0] }));
  assert.deepEqual(filterRecord(capped), capped);
});
