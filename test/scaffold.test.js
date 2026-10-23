import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { localSmokeOptions } from '../lib/scenarios.js';

const inventory = JSON.parse(
  readFileSync(new URL('../reference/dashboard-inventory.json', import.meta.url), 'utf8')
);
const uiInventory = JSON.parse(
  readFileSync(new URL('../reference/dashboard-ui-inventory.json', import.meta.url), 'utf8')
);

test('local smoke is one browser iteration with a strict check threshold', () => {
  const options = localSmokeOptions();
  assert.deepEqual(Object.keys(options.scenarios), ['local_browser_smoke']);
  assert.deepEqual(options.scenarios.local_browser_smoke, {
    executor: 'shared-iterations',
    vus: 1,
    iterations: 1,
    maxDuration: '30s',
    options: { browser: { type: 'chromium' } },
  });
  assert.deepEqual(options.thresholds, { checks: ['rate==1'] });
});

test('HAR inventory preserves known coverage without claiming other tabs were loaded', () => {
  assert.equal(inventory.capture.entries, 509);
  assert.equal(inventory.tabs.length, 4);
  const captured = inventory.tabs.filter((tab) => tab.dataCallsCaptured);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].widgets.length, 16);
  assert.equal(new Set(captured[0].widgets).size, 16);
  assert.equal(inventory.graphqlOperations.LoadContextBook, captured[0].widgets.length);
  assert.equal(
    Object.values(inventory.graphqlOperations).reduce((sum, count) => sum + count, 0),
    36
  );
});

test('live UI inventory supplements HAR coverage without claiming measured readiness', () => {
  assert.equal(uiInventory.dashboardId, inventory.dashboardId);
  assert.equal(uiInventory.tabs.length, 4);
  assert.deepEqual(uiInventory.tabs.map((tab) => tab.widgets.length), [16, 4, 9, 1]);
  assert.deepEqual(uiInventory.tabs[0].widgets, inventory.tabs[0].widgets);
  assert.deepEqual(uiInventory.tabs.map((tab) => tab.name), inventory.tabs.map((tab) => tab.name));
  assert.equal(uiInventory.tabs.reduce((sum, tab) => sum + tab.widgets.length, 0), 30);
  assert.equal(inventory.tabs[1].dataCallsCaptured, false);
  assert.ok(uiInventory.limitations.some((limitation) => limitation.includes('No action duration')));
});
