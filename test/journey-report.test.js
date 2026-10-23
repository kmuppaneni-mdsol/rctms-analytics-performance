import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { journeyRecord, journeySummary } from '../lib/journey-report.js';
import { journeyPlan } from '../lib/journey-plan.js';

const inventory = JSON.parse(readFileSync(new URL('../reference/dashboard-ui-inventory.json', import.meta.url), 'utf8'));
const plan = journeyPlan(inventory);
function record(tabIndex = 0) {
  return {
    sequence: tabIndex + 1, action: 'tab_switch', tabIndex, checkpoint: 0,
    durationMs: 25.5, status: 'passed',
    widgets: plan[tabIndex].widgets.map((_, widgetIndex) => ({ widgetIndex, state: 'ready_chart', readyAfterMs: 20 })),
    scroll: { top: 0, height: 720, total: 720, bottom: true },
  };
}

test('journey plan preserves discovered scope and explicit initial viewport expectations', () => {
  assert.equal(plan.reduce((sum, tab) => sum + tab.widgets.length, 0), 30);
  assert.deepEqual(plan.map((tab) => tab.initialWidgets.length), [6, 2, 4, 1]);
  assert.throws(() => journeyPlan({ tabs: [] }));
});

test('timing records project only allowed fields and reject invalid success-shaped measurements', () => {
  assert.deepEqual(journeyRecord({ ...record(), secret: 'not-for-output' }, plan), record());
  for (const change of [
    { durationMs: -1 }, { durationMs: NaN }, { tabIndex: 4 }, { sequence: 0 },
    { widgets: [] }, { widgets: [{ widgetIndex: 0, state: 'loading' }] },
    { widgets: [{ widgetIndex: 999, state: 'ready_chart' }] },
    { scroll: undefined }, { action: 'export' },
  ]) {
    assert.throws(() => journeyRecord({ ...record(), ...change }, plan));
  }
});

test('summary requires complete coverage, tab switches and bottom reached; retains failed samples', () => {
  const records = plan.map((_, index) => journeyRecord(record(index), plan));
  assert.equal(journeySummary(records, plan).complete, true);
  assert.equal(journeySummary(records.slice(0, 3), plan).complete, false);
  assert.equal(journeySummary([{ ...records[0], widgets: records[0].widgets.slice(1) }, ...records.slice(1)], plan).complete, false);
  const failed = { ...records[0], sequence: 5, status: 'failed', durationMs: 60000 };
  const summary = journeySummary([...records, failed], plan);
  assert.equal(summary.complete, false);
  assert.equal(summary.actions[0].failures, 1);
  assert.equal(summary.actions[0].samples, 5);
  assert.equal(summary.actions[0].successfulMeanMs, 25.5);
  assert.equal(journeySummary([{ ...records[0], scroll: { ...records[0].scroll, bottom: false } }, ...records.slice(1)], plan).complete, false);
});

test('failed readiness diagnostics retain only validated structural counts', () => {
  const renderSignals = {
    pivotCount: 1, dataAreaCount: 0, dataCellCount: 0, visibleDataCellCount: 0,
    populatedDataCellCount: 0, visiblePopulatedDataCellCount: 0,
    tableCellCount: 3, visibleTableCellCount: 2,
  };
  const diagnostic = {
    sequence: 4, action: 'readiness_diagnostic', tabIndex: 0, checkpoint: 3,
    durationMs: 0, status: 'failed',
    widgets: [{ widgetIndex: 10, state: 'missing_cells', renderSignals }],
  };
  assert.deepEqual(journeyRecord({
    ...diagnostic,
    widgets: [{ ...diagnostic.widgets[0], renderSignals: { ...renderSignals, cellValue: 'PRIVATE_VALUE' } }],
  }, plan), diagnostic);
  for (const badCount of [-1, 0.5, NaN, 'PRIVATE_VALUE', undefined]) {
    assert.throws(() => journeyRecord({
      ...diagnostic,
      widgets: [{ ...diagnostic.widgets[0], renderSignals: { ...renderSignals, dataCellCount: badCount } }],
    }, plan));
  }
  const widget = diagnostic.widgets[0];
  const pivotStructure = ['DIV dx-pivotgrid', 'TD dx-area-data-cell'];
  assert.deepEqual(journeyRecord({
    ...diagnostic, widgets: [{ ...widget, pivotStructure }],
  }, plan).widgets[0].pivotStructure, pivotStructure);
  for (const badStructure of [
    ['PRIVATE_VALUE'], ['TD dx-data value'], ['TD dx-data\n'], Array(41).fill('TD'), [null],
  ]) {
    assert.throws(() => journeyRecord({
      ...diagnostic, widgets: [{ ...widget, pivotStructure: badStructure }],
    }, plan));
  }
  assert.equal(journeyRecord({
    ...diagnostic, widgets: [{ ...widget, renderSignals: { ...renderSignals, pointCount: 18 } }],
  }, plan).widgets[0].renderSignals.pointCount, 18);
  assert.throws(() => journeyRecord({
    ...diagnostic, widgets: [{ ...widget, renderSignals: { ...renderSignals, pointCount: 'PRIVATE_VALUE' } }],
  }, plan));
});

test('dashboard-open measurements are separate and cannot substitute for tab traversal', () => {
  const open = journeyRecord({ ...record(), action: 'dashboard_open' }, plan);
  const summary = journeySummary([open], plan);
  assert.equal(summary.complete, false);
  assert.equal(summary.coverage[0].verified, 0);
  assert.equal(summary.coverage[0].tabSwitchPassed, false);
  assert.equal(summary.actions[0].action, 'dashboard_open');
  assert.throws(() => journeyRecord({ ...open, tabIndex: 1 }, plan));
  assert.throws(() => journeyRecord({ ...open, checkpoint: 1 }, plan));
});
