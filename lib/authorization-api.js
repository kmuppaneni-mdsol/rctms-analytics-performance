export const authorizationOrigin = 'https://home-sandbox.imedidata.net';
export const authorizationPath = '/api/analytics/portfolio/authenticate';
export const authorizationCloudWatch = Object.freeze({
  region: 'us-east-1',
  logGroup: '/aws/lambda/sandbox-pfui-analytics-api-getPortfolioAuthorizations',
  source: 'Sandbox infrastructure naming; log availability is not checked by the probe',
});
const guid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuidList = (value) => Array.isArray(value) && value.every((id) =>
  typeof id === 'string' && guid.test(id)) &&
  new Set(value.map((id) => id.toLowerCase())).size === value.length;

export function authorizationConfig(values = {}) {
  const integer = (key, fallback, min, max) => {
    const raw = values[key];
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) ||
        !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
      throw new Error('Invalid authorization probe configuration; values withheld.');
    }
    return Number(raw);
  };
  return {
    samples: integer('AUTH_SAMPLES', 3, 1, 5),
    intervalMs: integer('AUTH_INTERVAL_MS', 1000, 1000, 10000),
    timeoutMs: integer('AUTH_TIMEOUT_MS', 60000, 1000, 90000),
  };
}

export function authorizationRequest(value) {
  const allowed = new Set(['contextType', 'contextUUID', 'displayName', 'userLocale', 'requireUserParams']);
  if (!object(value) || Object.keys(value).some((key) => !allowed.has(key)) ||
      value.contextType !== 'unspecified' ||
      (value.contextUUID !== undefined && value.contextUUID !== '') ||
      (value.requireUserParams !== undefined && value.requireUserParams !== true) ||
      !['displayName', 'userLocale'].every((key) =>
        typeof value[key] === 'string' && value[key].trim().length > 0 && value[key].length <= 512)) {
    throw new Error('Expected application-generated unspecified portfolio context; values withheld.');
  }
  return JSON.stringify(value);
}

export function authorizationResponse(status, contentType, body) {
  const fail = (reason) => ({ passed: false, reason });
  if (status !== 200) return fail(status === 401 || status === 403 ?
    'authentication_or_permission' : status === 429 ? 'rate_limited' : 'http_status');
  if (typeof contentType !== 'string' ||
      !/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType)) return fail('content_type');
  let value;
  try { value = JSON.parse(body); } catch { return fail('invalid_json'); }
  if (!object(value) || ['error', 'errors', 'error_code'].some((key) =>
    Object.hasOwn(value, key))) return fail('invalid_envelope');
  if (!object(value.appPrivileges) ||
      typeof value.appPrivileges.portfolio_analytics_viewer !== 'boolean' ||
      !uuidList(value.eligibleSGUUIDs) || !Array.isArray(value.authorizations)) return fail('schema');
  if (!value.appPrivileges.portfolio_analytics_viewer || !value.eligibleSGUUIDs.length) {
    return fail('zero_access');
  }
  if (typeof value.token !== 'string' || !value.token.trim() || /[\s\x00-\x1f\x7f]/.test(value.token)) {
    return fail('missing_token');
  }
  if (!value.authorizations.length) return fail('empty_authorizations');
  const operations = new Set();
  const eligible = new Set(value.eligibleSGUUIDs.map((id) => id.toLowerCase()));
  let dataSourceCount = 0;
  for (const entry of value.authorizations) {
    if (!object(entry) || Object.keys(entry).length !== 1) return fail('authorization_schema');
    const [operation, resources] = Object.entries(entry)[0];
    if (!/^[a-z][a-z0-9_]*$/.test(operation) || operations.has(operation) ||
        !object(resources) || !uuidList(resources.availableSGUUIDs) || !resources.availableSGUUIDs.length ||
        resources.availableSGUUIDs.some((id) => !eligible.has(id.toLowerCase())) ||
        typeof resources.datasourceGroup !== 'string' || !resources.datasourceGroup.trim() ||
        !Array.isArray(resources.dataSources) || resources.dataSources.some((source) =>
          !object(source) || typeof source.uuid !== 'string' || !guid.test(source.uuid) ||
          typeof source.name !== 'string' || !source.name.trim())) return fail('authorization_schema');
    operations.add(operation);
    dataSourceCount += resources.dataSources.length;
  }
  return { passed: true, reason: 'portfolio_authorization_contract',
    contract: { eligibleStudyGroupCount: eligible.size, operationCount: operations.size, dataSourceCount } };
}

// Runs in the page: the browser's own authenticated session is never exported.
export async function authorizationFetch({ body, timeoutMs, expectedOrigin }) {
  if (location.origin !== expectedOrigin) throw new Error('Authorization page origin changed');
  const startedAt = Date.now();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let headersAt;
  try {
    response = await fetch('/api/analytics/portfolio/authenticate', {
      method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body, signal: controller.signal,
    });
    headersAt = performance.now();
    const text = await response.text();
    const finished = performance.now();
    return {
      status: response.status, contentType: response.headers.get('content-type'), body: text,
      startedAt: new Date(startedAt).toISOString(),
      elapsedMs: finished - started, headersMs: headersAt - started, receiveMs: finished - headersAt,
      requestBodyBytes: new TextEncoder().encode(body).length,
      responseDecodedBytes: new TextEncoder().encode(text).length,
      responseRequestId: response.headers.get('x-amzn-requestid') ?? response.headers.get('x-request-id'),
    };
  } catch {
    const elapsedMs = performance.now() - started;
    return { status: response?.status ?? 0, startedAt: new Date(startedAt).toISOString(),
      elapsedMs, headersMs: headersAt === undefined ? null : headersAt - started,
      receiveMs: headersAt === undefined ? null : performance.now() - headersAt,
      requestBodyBytes: new TextEncoder().encode(body).length, responseDecodedBytes: null,
      failure: controller.signal.aborted ? 'timeout' : 'transport_or_redirect' };
  } finally {
    clearTimeout(timer);
  }
}

export function authorizationMeasurement(raw, sequence, traceparent = null) {
  const result = raw.failure ? { passed: false, reason: raw.failure } :
    authorizationResponse(raw.status, raw.contentType, raw.body);
  const nonnegative = (value) => Number.isFinite(value) && value >= 0;
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 5 ||
      !Number.isInteger(raw.status) || raw.status < 0 || raw.status > 599 ||
      !Number.isFinite(Date.parse(raw.startedAt)) || !nonnegative(raw.elapsedMs) ||
      ![raw.headersMs, raw.receiveMs].every((value) => value === null || nonnegative(value)) ||
      !Number.isSafeInteger(raw.requestBodyBytes) || raw.requestBodyBytes < 0 ||
      !(raw.responseDecodedBytes === null ||
        Number.isSafeInteger(raw.responseDecodedBytes) && raw.responseDecodedBytes >= 0) ||
      (raw.failure && !['timeout', 'transport_or_redirect'].includes(raw.failure))) {
    throw new Error('Invalid authorization timing evidence; raw details withheld.');
  }
  const correlation = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : null;
  const validTraceparent = correlation(traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/);
  const traceId = validTraceparent?.split('-')[1] ?? null;
  const spanId = validTraceparent?.split('-')[2] ?? null;
  const usableTrace = traceId && !/^0+$/.test(traceId) && !/^0+$/.test(spanId);
  return {
    sequence, ...result, status: raw.status, startedAt: raw.startedAt,
    elapsedMs: raw.elapsedMs, headersMs: raw.headersMs, receiveMs: raw.receiveMs,
    requestBodyBytes: raw.requestBodyBytes, responseDecodedBytes: raw.responseDecodedBytes,
    traceparent: usableTrace ? validTraceparent : null,
    traceId: usableTrace ? traceId : null,
    responseRequestId: correlation(raw.responseRequestId, /^[A-Za-z0-9_-]{1,128}$/),
  };
}

export async function runAuthorizationSamples(page, body, config, onMeasurement) {
  const request = authorizationRequest(body);
  const measurements = [];
  const origin = new URL(page.url()).origin;
  for (let sequence = 1; sequence <= config.samples; sequence++) {
    if (new URL(page.url()).origin !== origin) {
      throw new Error('Authorization page origin changed; stopping probe.');
    }
    const observed = [];
    const observe = (candidate) => {
      if (candidate.url().split('?')[0] === new URL(authorizationPath, page.url()).href &&
          candidate.method() === 'POST' && candidate.postData() === request) {
        observed.push(candidate);
      }
    };
    page.on('request', observe);
    let raw;
    try {
      raw = await page.evaluate(authorizationFetch, {
        body: request, timeoutMs: config.timeoutMs, expectedOrigin: origin,
      });
    } finally {
      page.off('request', observe);
    }
    if (observed.length !== 1) {
      throw new Error('Authorization request observation missing or ambiguous; stopping probe.');
    }
    const headers = await observed[0].allHeaders();
    const measurement = authorizationMeasurement(raw, sequence, headers.traceparent);
    measurements.push(measurement);
    await onMeasurement(measurement);
    if (!measurement.passed) break;
    if (sequence < config.samples) await page.waitForTimeout(config.intervalMs);
  }
  return measurements;
}

export function authorizationSummary(measurements, expected) {
  const passed = measurements.filter((measurement) => measurement.passed);
  const times = passed.map((measurement) => measurement.elapsedMs);
  return {
    expectedSamples: expected, observedSamples: measurements.length, passedSamples: passed.length,
    complete: measurements.length === expected && passed.length === expected,
    firstSampleMs: measurements[0]?.passed ? measurements[0].elapsedMs : null,
    subsequentSamplesMs: passed.filter((measurement) => measurement.sequence > 1)
      .map((measurement) => measurement.elapsedMs),
    minMs: times.length ? Math.min(...times) : null,
    meanMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    maxMs: times.length ? Math.max(...times) : null,
  };
}

export function authorizationMarkdown(session, measurements, success) {
  const summary = authorizationSummary(measurements, session.samples);
  return [
    '# Platform portfolio authorization API probe', '',
    `**Result: ${success ? 'CONTRACT PASS' : 'FAIL / INCOMPLETE'}**`,
    `- Report ID (run ID): ${session.runId}`,
    `- Platform request: POST ${authorizationPath}`,
    `- CloudWatch region: ${authorizationCloudWatch.region}`,
    `- CloudWatch log group: ${authorizationCloudWatch.logGroup}`,
    `- Log group source: ${authorizationCloudWatch.source}.`,
    `- Samples passed: ${summary.passedSamples}/${summary.expectedSamples}`,
    '- One browser-authenticated user; sequential requests; stop on first failure; no retries.',
    '- Normal login/MFA and application bootstrap authorization are setup, excluded from sample RTT.',
    '- First measured sample is NOT cold authorization: bootstrap already ran; backend cache is uncontrolled.',
    '- This is not chart readiness, a ThoughtSpot-only test, a latency SLA, or a percentile estimate.',
    '- Headers time is fetch start to headers observed, not isolated server time; receive includes body decoding.',
    '- Sizes are UTF-8 request and decoded response bodies, not compressed wire sizes.',
    '- Missing correlation IDs are reported as null. No tokens, cookies, names or UUID lists are retained.',
    '',
    '| Sample | Result | HTTP | RTT (ms) | Headers (ms) | Receive (ms) | Request bytes | Decoded bytes |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...measurements.map((m) =>
      `| ${m.sequence} | ${m.reason} | ${m.status} | ${m.elapsedMs.toFixed(2)} | ` +
      `${m.headersMs?.toFixed(2) ?? '-'} | ${m.receiveMs?.toFixed(2) ?? '-'} | ` +
      `${m.requestBodyBytes} | ${m.responseDecodedBytes ?? '-'} |`),
    '', `Successful sample min / mean / max (ms): ${summary.minMs ?? '-'} / ` +
      `${summary.meanMs ?? '-'} / ${summary.maxMs ?? '-'}`, '',
    '## Platform request correlation', '',
    '| Sample | Request start (UTC) | Trace ID | Response request ID |',
    '| --- | --- | --- | --- |',
    ...measurements.map((m) =>
      `| ${m.sequence} | ${m.startedAt} | ${m.traceId ?? 'unavailable'} | ` +
      `${m.responseRequestId ?? 'unavailable'} |`),
    '',
    'Trace IDs come from observed request traceparent headers; they are not generated or backend-verified.',
    'Response request IDs are header values, not verified Lambda invocation IDs.',
    'In CloudWatch Logs Insights select the log group above and the sample UTC time range.',
    'Replace <trace-id> below with an available trace ID from the table:', '',
    '```sql',
    'fields @timestamp, @message',
    '| filter @message like /<trace-id>/',
    '| sort @timestamp asc',
    '| limit 200',
    '```', '',
    'Keep this report separate from ThoughtSpot liveboard response and browser experience totals.', '',
  ].join('\n');
}
