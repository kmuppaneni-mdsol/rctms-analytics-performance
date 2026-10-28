import assert from 'node:assert/strict';
import test from 'node:test';
import { experienceReport } from '../lib/experience-report.js';

const session = { reportId: 'fixture-report-id', startedAt: '2026-10-21T00:00:00Z' };
const outcome = { success: true, finishedAt: '2026-10-21T00:02:00Z', summary: {
  journey: { coverage: [{ verified: 16, expected: 16 }] }, filter: { restorationVerified: true },
} };
const request = {
  sequence: 1, phase: 'platform_authorization', operation: 'portfolio_authenticate',
  action: 'bootstrap', actionSequence: 0, startedAtMs: 1792540800000,
  state: 'completed', status: 200, elapsedMs: 4000,
  traceId: '1234567890abcdef1234567890abcdef', responseRequestId: null,
};

test('brief report distinguishes dashboard opening from session API timings and preserves key correlation', () => {
  const journey = [{ action: 'dashboard_open', durationMs: 15000, status: 'passed' },
    ...Array.from({ length: 20 }, () => ({ action: 'scroll', durationMs: 200, status: 'passed' }))];
  const filters = [{ action: 'filter_apply', durationMs: 3000, status: 'passed' },
    { action: 'filter_reset', durationMs: 2000, status: 'passed' }];
  const records = [request, { ...request, sequence: 2, action: 'dashboard_open', elapsedMs: 1234 },
    { ...request, sequence: 3, phase: 'thoughtspot_widgets', action: 'dashboard_open', elapsedMs: 6000 },
    { ...request, sequence: 4, phase: 'thoughtspot_widgets', action: 'filter_apply', elapsedMs: 10000 },
    { ...request, sequence: 5, phase: 'thoughtspot_widgets', state: 'incomplete', elapsedMs: null, status: null }];
  const report = experienceReport(session, journey, filters, outcome, records,
    { complete: false, collectionErrors: 0 });
  assert.match(report, /UI result: PASS/);
  assert.match(report, /initial widgets ready: \*\*15.000 s/);
  assert.match(report, /16\/16 widgets; 23\/23 actions passed/);
  assert.match(report, /Platform authorization \| 1 \| 1.234 \| 2 \| 4.000/);
  assert.match(report, /ThoughtSpot widget data \| 1 \| 6.000 \| 3 \| 10.000/);
  assert.doesNotMatch(report, /Snowflake query execution/);
  assert.match(report, /does not isolate database execution time/);
  assert.match(report, /1234567890abcdef1234567890abcdef/);
  assert.doesNotMatch(report, /Response request ID/);
  assert.match(report, /sandbox-pfui-analytics-api-getPortfolioAuthorizations/);
  assert.match(report, /sandbox-pfui-analytics-api-getDashboard/);
  assert.match(report, /0 collector errors; 0 HTTP\/transport failures; 1 missing completion/);
  assert.match(report, /Filter apply: 3.000 s/);
  assert.match(report, /Original filter restored: yes/);
  assert.match(report, /\.\/experience-fixture-report-id.jsonl/);
  assert.doesNotMatch(report, /Action timings|Action groups|Runtime and interpretation|scroll \||Sum of passed|load averages|Request evidence/);
  assert.ok(report.split('\n').length <= 60, 'Summary must remain brief even for a long journey');
});

test('failure summary never presents a failed attempt or absent response as successful performance', () => {
  const report = experienceReport(session,
    [{ action: 'dashboard_open', status: 'failed', durationMs: 10987 }],
    [{ action: 'filter_apply', status: 'failed', durationMs: 65000 }],
    { ...outcome, success: false, summary: { journey: { coverage: [] }, filter: { restorationVerified: false } } });
  assert.match(report, /FAIL \/ INCOMPLETE/);
  assert.match(report, /initial widgets ready: \*\*not achieved \/ not measured/);
  assert.doesNotMatch(report, /10.987|65.000/);
  assert.match(report, /Platform authorization \| not observed \| not measured/);
  assert.match(report, /No platform requests observed/);
  assert.match(report, /unknown collector errors/);
  assert.match(report, /not verified/);
});

test('HTTP errors remain counted while unrelated request details stay in companion evidence', () => {
  const records = [request, { ...request, phase: 'thoughtspot_other', status: 500 },
    { ...request, phase: 'thoughtspot_other', state: 'failed', status: null, elapsedMs: 10 }];
  const report = experienceReport(session, [], [], outcome, records, { complete: true, collectionErrors: 0 });
  assert.match(report, /2 HTTP\/transport failures/);
  assert.match(report, /API capture: complete/);
  assert.match(report, /including HTTP errors/);
  assert.doesNotMatch(report, /ThoughtSpot other API \|/);
});
