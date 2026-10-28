import assert from 'node:assert/strict';
import test from 'node:test';
import { apiEndpoint, apiRecord, apiMarkdown, apiCloudWatch, observeExperienceApi } from '../lib/experience-api.js';

const traceparent = '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01';
const base = {
  sequence: 1, phase: 'platform_authorization', operation: 'portfolio_authenticate',
  action: 'dashboard_open', actionSequence: 1, startedAtMs: 1793180000000,
  state: 'completed', status: 200, elapsedMs: 1234.5, traceparent,
  responseRequestId: 'response-id',
};
test('endpoint classification excludes other hosts, login, telemetry, variables and unknown operation names', () => {
  assert.equal(apiEndpoint('https://home-sandbox.imedidata.net/api/analytics/portfolio/authenticate', 'POST').phase,
    'platform_authorization');
  assert.equal(apiEndpoint('https://home-sandbox.imedidata.net/api/analytics/dashboards/f9431c78-169f-442d-8f9e-61f8bc0ee73c?secret=PRIVATE', 'GET').phase,
    'platform_dashboard');
  for (const [operation, phase] of [['LoadPinboardSession', 'thoughtspot_session'], ['LoadContextBook', 'thoughtspot_widgets']]) {
    assert.deepEqual(apiEndpoint('https://medidata-dev.thoughtspot.cloud/prism/', 'POST',
      JSON.stringify({ operationName: operation, variables: 'PRIVATE' })), { phase, operation });
  }
  assert.equal(apiEndpoint('https://medidata-dev.thoughtspot.cloud/prism/', 'POST', 'PRIVATE').operation, 'other_graphql');
  for (const url of ['https://login-sandbox.imedidata.net/login', 'https://medidata-dev.thoughtspot.cloud.evil/prism/',
    'https://medidata-dev.thoughtspot.cloud/callosum/telemetry', 'https://medidata-dev.thoughtspot.cloud/static/chart.js']) {
    assert.equal(apiEndpoint(url, 'POST', '{}'), null);
  }
});

test('API evidence projects safe fields, validates timings, and rejects invalid trace identifiers', () => {
  const record = apiRecord({ ...base, body: 'PRIVATE', cookie: 'PRIVATE', url: 'PRIVATE' });
  assert.equal(record.traceId, traceparent.split('-')[1]);
  assert.deepEqual(apiRecord(record), record);
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE|traceparent/);
  for (const invalid of [null, 'PRIVATE', '00-' + '0'.repeat(32) + '-1234567890abcdef-01',
    '00-1234567890abcdef1234567890abcdef-' + '0'.repeat(16) + '-01']) {
    assert.equal(apiRecord({ ...base, traceparent: invalid }).traceId, null);
  }
  assert.equal(apiRecord({ ...base, responseRequestId: '<PRIVATE>' }).responseRequestId, null);
  for (const change of [{ elapsedMs: -1 }, { sequence: 0 }, { action: 'PRIVATE' },
    { status: 0 }, { elapsedMs: null }, { startedAtMs: NaN }]) {
    assert.throws(() => apiRecord({ ...base, ...change }));
  }
});

test('API summary uses overlapping response windows, seconds, same-action groups and explicit unavailable evidence', () => {
  const records = [
    apiRecord(base),
    apiRecord({ ...base, sequence: 2, phase: 'thoughtspot_widgets', operation: 'LoadContextBook', elapsedMs: 4000 }),
    apiRecord({ ...base, sequence: 3, phase: 'thoughtspot_widgets', operation: 'LoadContextBook',
      startedAtMs: base.startedAtMs + 1000, elapsedMs: 4000, status: 500 }),
    apiRecord({ ...base, sequence: 4, action: 'filter_apply', actionSequence: 1,
      state: 'incomplete', status: null, elapsedMs: null, traceparent: null }),
    apiRecord({ ...base, sequence: 5, action: 'filter_reset', actionSequence: 2,
      state: 'failed', status: null, elapsedMs: null }),
  ];
  const report = apiMarkdown(records, { complete: false, collectionErrors: 0 },
    [{ action: 'scroll', actionSequence: 3 }]).join('\n');
  assert.match(report, /ThoughtSpot widget data \| 2 \| 1 \| 0 \| 4.000 \| 5.000/);
  assert.match(report, /filter_apply #1 \| Platform authorization \| 1 \| 0 \| 1 \| not measured/);
  assert.match(report, /filter_reset #2 \| Platform authorization \| 1 \| 1 \| 0/);
  assert.match(report, /scroll #3 \| Platform authorization \| not observed/);
  assert.match(report, /1234567890abcdef1234567890abcdef/);
  assert.match(report, /sandbox-pfui-analytics-api-getPortfolioAuthorizations/);
  assert.match(report, /sandbox-pfui-analytics-api-getDashboard/);
  assert.match(report, /not a verified Lambda invocation/);
  assert.match(report, /incomplete \/ unavailable/);
  assert.match(report, /do not add/);
  assert.equal(apiCloudWatch('thoughtspot_widgets'), null);
  assert.match(apiCloudWatch('platform_authorization').url, /\$252Faws\$252Flambda/);
});

function fakePage() {
  const handlers = {};
  return { on(name, fn) { handlers[name] = fn; }, event(name, request) { handlers[name](request); } };
}
function fakeRequest(startTime, overrides = {}) {
  return {
    url: () => 'https://home-sandbox.imedidata.net/api/analytics/portfolio/authenticate',
    method: () => 'POST', postData: () => 'PRIVATE',
    timing: () => ({ startTime, responseEnd: 2345 }),
    headers: () => ({ traceparent }),
    headerValue: () => { throw new Error('Raw-header waits must not be used'); },
    response: async () => ({ status: () => 200, headers: () => ({ 'x-request-id': 'response-id' }),
      headerValue: () => { throw new Error('Raw-header waits must not be used'); } }),
    ...overrides,
  };
}
test('passive collector retains action at initiation, incomplete/failed traffic and safe metadata', async () => {
  const page = fakePage();
  const records = [];
  const collector = observeExperienceApi(page, (r) => records.push(r));
  const first = fakeRequest(base.startedAtMs);
  page.event('request', first);
  collector.action('filter_apply', 1);
  const second = fakeRequest(base.startedAtMs + 1);
  page.event('request', second);
  const unfinished = fakeRequest(base.startedAtMs + 2);
  page.event('request', unfinished);
  await new Promise((resolve) => setImmediate(resolve));
  page.event('requestfinished', first);
  page.event('requestfailed', second);
  const capture = await collector.finish();
  assert.equal(capture.complete, false);
  assert.equal(capture.collectionErrors, 0);
  assert.deepEqual(records.map((r) => r.state), ['completed', 'failed', 'incomplete']);
  assert.deepEqual(records.map((r) => r.action), ['bootstrap', 'filter_apply', 'filter_apply']);
  assert.equal(records[0].traceId, traceparent.split('-')[1]);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE/);
});

test('collection failures are explicit and never fabricated as successful samples', async () => {
  const page = fakePage();
  const collector = observeExperienceApi(page, () => {});
  page.event('request', fakeRequest(base.startedAtMs, { headers() { throw new Error('PRIVATE'); } }));
  const capture = await collector.finish();
  assert.equal(capture.observed, 1);
  assert.equal(capture.collectionErrors, 1);
  assert.equal(capture.complete, false);
  assert.equal(capture.errorCounts.request_metadata, 1);
});

test('concurrent identical requests finish in reverse order without mixing action or trace evidence', async () => {
  const page = fakePage();
  const records = [];
  const collector = observeExperienceApi(page, (r) => records.push(r));
  const first = fakeRequest(base.startedAtMs);
  const second = fakeRequest(base.startedAtMs + 1, { headers: () => ({}) });
  collector.action('dashboard_open', 1);
  page.event('request', first);
  collector.action('tab_switch', 2);
  page.event('request', second);
  page.event('requestfinished', second);
  page.event('requestfinished', first);
  const capture = await collector.finish();
  assert.equal(capture.complete, true);
  assert.equal(records[0].action, 'dashboard_open');
  assert.equal(records[0].traceId, traceparent.split('-')[1]);
  assert.equal(records[1].action, 'tab_switch');
  assert.equal(records[1].traceId, null);
});

test('ambiguous native timing is flagged instead of attributing a response to an arbitrary action', async () => {
  const page = fakePage();
  const records = [];
  const collector = observeExperienceApi(page, (r) => records.push(r));
  const request = fakeRequest(base.startedAtMs, { timing: () => null });
  page.event('request', request);
  page.event('request', request);
  page.event('requestfinished', request);
  const capture = await collector.finish();
  assert.equal(capture.complete, false);
  assert.equal(capture.collectionErrors, 1);
  assert.ok(records.every((r) => r.state === 'incomplete' && r.elapsedMs === null));
});

test('raw request-header waits are never invoked, and snapshots retain mixed-case trace headers', async () => {
  const page = fakePage();
  const records = [];
  const collector = observeExperienceApi(page, (r) => records.push(r),
    { metadataTimeoutMs: 20, drainTimeoutMs: 100 });
  const request = fakeRequest(base.startedAtMs, { headerValue: () => new Promise(() => {}),
    headers: () => ({ Traceparent: traceparent }) });
  page.event('request', request);
  page.event('requestfinished', request);
  const capture = await collector.finish();
  assert.equal(capture.complete, true);
  assert.equal(capture.collectionErrors, 0);
  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'completed');
  assert.equal(records[0].traceId, traceparent.split('-')[1]);
});

test('absent response headers are unavailable, not collection failures or raw-header waits', async () => {
  const page = fakePage();
  const records = [];
  const collector = observeExperienceApi(page, (r) => records.push(r),
    { metadataTimeoutMs: 20, drainTimeoutMs: 100 });
  const request = fakeRequest(base.startedAtMs, {
    response: async () => ({ status: () => 200, headers: () => ({}), headerValue: () => new Promise(() => {}) }),
  });
  page.event('request', request);
  page.event('requestfinished', request);
  const capture = await collector.finish();
  assert.equal(capture.complete, true);
  assert.equal(capture.collectionErrors, 0);
  assert.equal(records[0].state, 'completed');
  assert.equal(records[0].status, 200);
  assert.ok(records[0].elapsedMs >= 0);
  assert.equal(records[0].responseRequestId, null);
});

test('overall drain deadline seals a partial snapshot even while metadata work is pending', async () => {
  const page = fakePage();
  const records = [];
  let release;
  const collector = observeExperienceApi(page, (r) => records.push(r),
    { metadataTimeoutMs: 100, drainTimeoutMs: 10 });
  const request = fakeRequest(base.startedAtMs, {
    response: () => new Promise((resolve) => { release = resolve; }),
  });
  page.event('request', request);
  page.event('requestfinished', request);
  const capture = await collector.finish();
  assert.equal(capture.complete, false);
  assert.equal(capture.collectionErrors, 1);
  assert.equal(records[0].state, 'incomplete');
  assert.equal(records[0].status, null);
  release({ status: () => 200, headers: () => ({}) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(records[0].status, null);
});

test('response lookup timeout remains explicit without blocking finalization', async () => {
  const page = fakePage();
  const collector = observeExperienceApi(page, () => {}, { metadataTimeoutMs: 10, drainTimeoutMs: 100 });
  const request = fakeRequest(base.startedAtMs, { response: () => new Promise(() => {}) });
  page.event('request', request);
  page.event('requestfinished', request);
  const capture = await collector.finish();
  assert.equal(capture.errorCounts.response_metadata, 1);
  assert.equal(capture.complete, false);
});

test('reload-related missing terminal events remain incomplete and distinguishable from end-of-capture traffic', async () => {
  const page = fakePage();
  const records = [];
  const collector = observeExperienceApi(page, (r) => records.push(r));
  collector.action('journey_setup');
  page.event('request', fakeRequest(base.startedAtMs));
  collector.action('dashboard_open', 1);
  page.event('request', fakeRequest(base.startedAtMs + 1));
  const capture = await collector.finish();
  assert.equal(capture.collectionErrors, 0);
  assert.equal(capture.complete, false);
  assert.equal(records[0].completionReason, 'no_terminal_event_after_reload');
  assert.equal(records[1].completionReason, 'no_terminal_event_at_capture_end');
  assert.ok(records.every((r) => r.elapsedMs === null && r.state === 'incomplete'));
  assert.deepEqual(apiRecord(records[0]), records[0]);
});
