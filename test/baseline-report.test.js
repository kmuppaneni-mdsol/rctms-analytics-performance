import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineSummary } from '../lib/baseline-report.js';

const tabs = [{ name: 'Fixture', widgets: ['Chart'] }];
function runs() {
  return [10, 20, 60].map((durationMs, index) => [
    {
      type: 'session', startedAt: `2026-10-21T06:0${index}:00Z`,
      mode: 'timed-read-only-journey', performanceMeasured: true, users: 1, iterations: 1,
      tabs, viewport: { width: 1280, height: 720 }, scope: 'warm tabs', clock: 'monotonic',
      cacheState: 'uncontrolled', readinessTimeoutMs: 60000, pollIntervalMs: 200,
      runner: { node: 'v24.1.0', k6Version: '2.3.0', platform: 'darwin', architecture: 'arm64',
        osRelease: 'fixture', logicalCpus: 8, totalMemoryBytes: 1000000,
        freeMemoryBytes: 500000 - index, loadAverage: [1, 1, 1] },
    },
    { type: 'browser', engine: 'chromium', version: '156.0.8078.48', devicePixelRatio: 2 },
    { type: 'measurement', sequence: 1, action: 'tab_switch', tabIndex: 0, checkpoint: 0,
      durationMs, status: 'passed', widgets: [{ widgetIndex: 0, state: 'ready_chart', readyAfterMs: 1 }],
      scroll: { top: 0, height: 720, total: 720, bottom: true } },
    { type: 'outcome', finishedAt: `2026-10-21T06:0${index}:30Z`, success: true },
  ]);
}

test('three-run baseline calculates medians without claiming percentiles or wall time', () => {
  const result = baselineSummary(runs(), tabs);
  assert.deepEqual(result.measuredActionTotals, { samples: 3, minMs: 10, medianMs: 20, maxMs: 60, meanMs: 30 });
  assert.equal(result.tabs[0].tabSwitch.medianMs, 20);
  assert.equal(result.actions[0].duration.maxMs, 60);
  assert.match(result.limitations, /No initial dashboard-open/);
});

test('baseline rejects failed, incomplete, overlapping or incomparable runs', () => {
  for (const mutate of [
    (value) => value.pop(),
    (value) => { value[1][3].success = false; },
    (value) => { value[1][2].scroll.bottom = false; },
    (value) => { value[1][2].sequence = 2; },
    (value) => { value[1][2].checkpoint = 1; },
    (value) => { value[1][1].version = '157.0.0.0'; },
    (value) => { value[1][0].startedAt = value[0][0].startedAt; },
    (value) => { value[1][0].viewport.width = 800; },
    (value) => { value[1][0].runner.logicalCpus = 4; },
    (value) => { value[1][0].runner.k6Version = '2.4.0'; },
    (value) => { value[1][0].runner.loadAverage = [NaN, 0, 0]; },
    (value) => { value[1].splice(1, 1); },
    (value) => { value[1][0].tabs = []; },
    (value) => { value[1][0].mode = 'authenticated-reload-and-journey'; },
  ]) {
    const value = structuredClone(runs());
    mutate(value);
    assert.throws(() => baselineSummary(value, tabs));
  }
});
