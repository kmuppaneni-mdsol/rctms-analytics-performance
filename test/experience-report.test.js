import assert from 'node:assert/strict';
import test from 'node:test';
import { experienceReport } from '../lib/experience-report.js';

test('experience report separates action timings, coverage and excluded elapsed time', () => {
  const session = { startedAt: '2026-10-21T00:00:00Z', runner: {
    node: 'v24.1.0', k6Version: '2.3.0', platform: 'darwin', architecture: 'arm64',
    freeMemoryBytes: 104857600, loadAverage: [1, 2, 3],
  } };
  const journey = [
    { action: 'dashboard_open', tabIndex: 0, checkpoint: 0, durationMs: 15000, status: 'passed' },
    { action: 'tab_switch', tabIndex: 0, checkpoint: 0, durationMs: 1000, status: 'passed' },
    { action: 'readiness_diagnostic', durationMs: 0, status: 'failed' },
  ];
  const filters = [
    { action: 'filter_apply', durationMs: 65000, status: 'failed' },
    { action: 'filter_reset', durationMs: 3000, status: 'passed' },
  ];
  const outcome = { success: false, finishedAt: '2026-10-21T00:02:00Z', summary: {
    journey: { coverage: [{ tabIndex: 0, verified: 6, expected: 16,
      tabSwitchPassed: true, bottomReached: false }] },
    filter: { restorationVerified: true },
  } };
  const report = experienceReport(session, journey, filters, outcome);
  assert.match(report, /FAIL \/ INCOMPLETE/);
  assert.match(report, /3\/4 recorded/);
  assert.match(report, /\*\*19.00s\*\*/);
  assert.match(report, /filter_apply \| - \| - \| failed \| 65.00/);
  assert.match(report, /filter_apply \| 0\/1 \| 0.00/);
  assert.match(report, /6\/16/);
  assert.match(report, /selection verified: \*\*yes\*\*/);
  assert.doesNotMatch(report, /readiness_diagnostic \|/);
  const empty = experienceReport(session, [], [], { ...outcome, summary: {
    journey: { coverage: [] }, filter: { restorationVerified: false },
  } });
  assert.match(empty, /0\/0 recorded/);
  assert.match(empty, /no \/ not measured/);
});
