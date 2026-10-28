import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizationCloudWatch, authorizationConfig, authorizationRequest, authorizationResponse,
  authorizationMeasurement, authorizationSummary, authorizationMarkdown,
  runAuthorizationSamples } from '../lib/authorization-api.js';

const sg = '00000000-0000-0000-0000-000000000001';
const ds = '00000000-0000-0000-0000-000000000002';
const body = { contextType: 'unspecified', contextUUID: '', displayName: 'Fixture Person', userLocale: 'eng' };
const response = () => ({
  token: 'fixture-secret-token', appPrivileges: { portfolio_analytics_viewer: true },
  eligibleSGUUIDs: [sg], authorizations: [{ read_visits: {
    availableSGUUIDs: [sg], datasourceGroup: 'visits', dataSources: [{ uuid: ds, name: 'Fixture source' }],
  } }],
});
const raw = () => ({
  status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(response()),
  startedAt: '2026-10-28T00:00:00.000Z', elapsedMs: 120, headersMs: 100, receiveMs: 20,
  requestBodyBytes: 120, responseDecodedBytes: 400, responseRequestId: 'fixture-request-id',
});

test('authorization configuration is bounded and request context is application generated', () => {
  assert.deepEqual(authorizationConfig(), { samples: 3, intervalMs: 1000, timeoutMs: 60000 });
  assert.deepEqual(authorizationConfig({ AUTH_SAMPLES: '1', AUTH_INTERVAL_MS: '10000',
    AUTH_TIMEOUT_MS: '90000' }), { samples: 1, intervalMs: 10000, timeoutMs: 90000 });
  for (const [key, values] of Object.entries({
    AUTH_SAMPLES: ['0', '6', '1.2', '', 3, '03'],
    AUTH_INTERVAL_MS: ['999', '10001', '-1'],
    AUTH_TIMEOUT_MS: ['999', '90001', 'Infinity'],
  })) for (const value of values) {
    assert.throws(() => authorizationConfig({ [key]: value }), /values withheld/);
  }
  assert.deepEqual(JSON.parse(authorizationRequest(body)), body);
  for (const value of [
    { ...body, contextType: 'client_divisions' }, { ...body, contextUUID: sg },
    { ...body, requireUserParams: false }, { ...body, cookie: 'secret' },
    { ...body, displayName: '' }, { ...body, userLocale: ' ' }, null, [],
  ]) assert.throws(() => authorizationRequest(value), /values withheld/);
});

test('authorization validates access, token and consistent per-operation resources', () => {
  const evaluate = (value) => authorizationResponse(200, 'application/json', JSON.stringify(value));
  assert.deepEqual(evaluate(response()), { passed: true, reason: 'portfolio_authorization_contract',
    contract: { eligibleStudyGroupCount: 1, operationCount: 1, dataSourceCount: 1 } });
  for (const [status, type, text, reason] of [
    [401, '', '', 'authentication_or_permission'], [403, '', '', 'authentication_or_permission'],
    [429, '', '', 'rate_limited'], [500, '', '', 'http_status'], [302, '', '', 'http_status'],
    [200, 'text/html', '', 'content_type'], [200, 'application/json', '{', 'invalid_json'],
    [200, 'application/json', 'null', 'invalid_envelope'],
    [200, 'application/json', '{"errors":[]}', 'invalid_envelope'],
  ]) assert.equal(authorizationResponse(status, type, text).reason, reason);
  for (const [mutate, reason] of [
    [(v) => { v.token = null; }, 'missing_token'],
    [(v) => { v.token = 'private token'; }, 'missing_token'],
    [(v) => { v.appPrivileges.portfolio_analytics_viewer = false; }, 'zero_access'],
    [(v) => { v.eligibleSGUUIDs = []; }, 'zero_access'],
    [(v) => { v.eligibleSGUUIDs = [sg, sg]; }, 'schema'],
    [(v) => { v.authorizations = []; }, 'empty_authorizations'],
    [(v) => { v.authorizations[0].read_visits.availableSGUUIDs = [ds]; }, 'authorization_schema'],
    [(v) => { v.authorizations[0].read_visits.availableSGUUIDs = []; }, 'authorization_schema'],
    [(v) => { v.authorizations[0].read_visits.dataSources[0].uuid = 'invalid'; }, 'authorization_schema'],
    [(v) => { v.authorizations.push(v.authorizations[0]); }, 'authorization_schema'],
    [(v) => { v.authorizations[0].extra = {}; }, 'authorization_schema'],
  ]) {
    const value = response();
    mutate(value);
    assert.equal(evaluate(value).reason, reason);
  }
});

test('measurement/report allowlists discard raw identities, token and body', () => {
  const trace = '00-00000000000000000000000000000001-0000000000000001-01';
  const measurement = authorizationMeasurement({ ...raw(), cookies: 'private' }, 1, trace);
  const output = JSON.stringify(measurement) + authorizationMarkdown(
    { runId: 'fixture', samples: 3 }, [measurement], false);
  for (const secret of ['fixture-secret-token', sg, ds, 'Fixture source', 'private', 'read_visits']) {
    assert.ok(!output.includes(secret), secret);
  }
  assert.equal(measurement.traceparent, trace);
  assert.equal(measurement.traceId, '00000000000000000000000000000001');
  assert.equal(authorizationMeasurement(raw(), 1, 'unsafe').traceparent, null);
  assert.equal(authorizationMeasurement(raw(), 1, 'unsafe').traceId, null);
  for (const invalid of [
    '00-00000000000000000000000000000000-0000000000000001-01',
    '00-00000000000000000000000000000001-0000000000000000-01',
  ]) assert.equal(authorizationMeasurement(raw(), 1, invalid).traceId, null);
  assert.equal(authorizationMeasurement({ ...raw(), responseRequestId: 'unsafe\nheader' }, 1)
    .responseRequestId, null);
  for (const value of [{ ...raw(), elapsedMs: -1 }, { ...raw(), headersMs: Infinity },
    { ...raw(), startedAt: 'wrong' }, { ...raw(), requestBodyBytes: 0.1 },
    { ...raw(), failure: 'sensitive arbitrary error' }]) {
    assert.throws(() => authorizationMeasurement(value, 1), /withheld/);
  }
  const timeout = authorizationMeasurement({ ...raw(), status: 0, failure: 'timeout',
    headersMs: null, receiveMs: null, responseDecodedBytes: null }, 1);
  assert.equal(timeout.passed, false);
  assert.equal(timeout.reason, 'timeout');
});

test('summary separates first and subsequent samples and never counts failed latency as success', () => {
  const first = authorizationMeasurement(raw(), 1);
  const failed = authorizationMeasurement({ ...raw(), status: 500 }, 2);
  assert.deepEqual(authorizationSummary([first, failed], 3), {
    expectedSamples: 3, observedSamples: 2, passedSamples: 1, complete: false,
    firstSampleMs: 120, subsequentSamplesMs: [], minMs: 120, meanMs: 120, maxMs: 120,
  });
  assert.equal(authorizationSummary([], 3).minMs, null);
  const markdown = authorizationMarkdown({ runId: 'fixture', samples: 3 }, [first, failed], false);
  assert.match(markdown, /FAIL \/ INCOMPLETE/);
  assert.match(markdown, /NOT cold/);
  assert.match(markdown, /not compressed wire sizes/);
  assert.match(markdown, /Report ID \(run ID\): fixture/);
  assert.ok(markdown.includes(authorizationCloudWatch.logGroup));
  assert.ok(markdown.includes(authorizationCloudWatch.region));
  assert.match(markdown, /unavailable/);
  assert.match(markdown, /not verified Lambda invocation IDs/);
  const correlated = authorizationMeasurement(raw(), 1,
    '00-00000000000000000000000000000001-0000000000000001-01');
  const correlationReport = authorizationMarkdown({ runId: 'fixture', samples: 1 }, [correlated], true);
  assert.ok(correlationReport.includes(correlated.traceId));
  assert.ok(correlationReport.includes(correlated.responseRequestId));
  assert.ok(correlationReport.includes(correlated.startedAt));
});

test('probe sends sequential requests and stops immediately on contract failure', async () => {
  for (const failAt of [null, 1, 2]) {
    let active = 0;
    let peak = 0;
    let calls = 0;
    let waits = 0;
    const emitted = [];
    const listeners = new Set();
    const page = {
      url: () => 'https://home-sandbox.imedidata.net/apps/Analytics/dashboards',
      on: (_, listener) => listeners.add(listener),
      off: (_, listener) => listeners.delete(listener),
      async evaluate(_, params) {
        active++;
        peak = Math.max(peak, active);
        calls++;
        for (const listener of listeners) listener({
          url: () => 'https://home-sandbox.imedidata.net/api/analytics/portfolio/authenticate',
          method: () => 'POST', postData: () => params.body, allHeaders: async () => ({}),
        });
        await Promise.resolve();
        active--;
        return { ...raw(), status: calls === failAt ? 403 : 200 };
      },
      async waitForTimeout(ms) { assert.equal(ms, 1000); waits++; },
    };
    const measurements = await runAuthorizationSamples(page, body, authorizationConfig(),
      (measurement) => emitted.push(measurement));
    assert.equal(calls, failAt ?? 3);
    assert.equal(waits, (failAt ?? 3) - 1);
    assert.equal(peak, 1);
    assert.equal(listeners.size, 0);
    assert.equal(measurements.length, emitted.length);
    assert.equal(authorizationSummary(measurements, 3).complete, failAt === null);
  }
});

test('missing request evidence and browser errors fail explicitly and remove listeners', async () => {
  for (const broken of ['missing', 'throws']) {
    let attached = false;
    const page = {
      url: () => 'https://home-sandbox.imedidata.net/',
      on: () => { attached = true; }, off: () => { attached = false; },
      async evaluate() {
        if (broken === 'throws') throw new Error('fixture browser failure');
        return raw();
      },
    };
    await assert.rejects(runAuthorizationSamples(page, body, authorizationConfig(), () => {}));
    assert.equal(attached, false);
  }
});

test('probe rejects origin changes and ambiguous background authorization observations', async () => {
  for (const mode of ['origin', 'ambiguous']) {
    let checks = 0;
    const listeners = new Set();
    const page = {
      url: () => mode === 'origin' && checks++ > 0 ?
        'https://login-sandbox.imedidata.net/' : 'https://home-sandbox.imedidata.net/',
      on: (_, listener) => listeners.add(listener),
      off: (_, listener) => listeners.delete(listener),
      async evaluate(_, params) {
        const request = {
          url: () => 'https://home-sandbox.imedidata.net/api/analytics/portfolio/authenticate',
          method: () => 'POST', postData: () => params.body,
        };
        for (const listener of listeners) { listener(request); listener(request); }
        return raw();
      },
    };
    await assert.rejects(runAuthorizationSamples(page, body, authorizationConfig(), () => {}),
      mode === 'origin' ? /origin changed/ : /ambiguous/);
    assert.equal(listeners.size, 0);
  }
});
