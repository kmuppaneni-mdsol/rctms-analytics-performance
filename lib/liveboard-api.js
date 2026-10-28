export const liveboardPath = '/api/rest/2.0/metadata/liveboard/data';
export const expectedVisualizations = 30;
const guid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function liveboardConfig(values) {
  const fail = () => { throw new Error('Invalid API configuration; verify TS_HOST, LIVEBOARD_ID and TS_TOKEN. Values withheld.'); };
  let host;
  try { host = new URL(values.TS_HOST); } catch { fail(); }
  if (host.protocol !== 'https:' || host.username || host.password ||
      host.pathname !== '/' || host.search || host.hash ||
      !/^[a-z0-9.-]+\.thoughtspot\.cloud$/i.test(host.hostname) || host.port ||
      typeof values.LIVEBOARD_ID !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(values.LIVEBOARD_ID) ||
      typeof values.TS_TOKEN !== 'string' || !values.TS_TOKEN.trim() ||
      /[\s\x00-\x1f\x7f]/.test(values.TS_TOKEN)) fail();
  return { TS_HOST: host.origin, LIVEBOARD_ID: values.LIVEBOARD_ID, TS_TOKEN: values.TS_TOKEN };
}

export function liveboardBody(identifier) {
  return JSON.stringify({
    metadata_identifier: identifier, data_format: 'COMPACT',
    record_offset: 0, record_size: 1000,
  });
}

export function liveboardResponse(status, contentType, body, identifier) {
  if (status !== 200) return { passed: false, reason:
    status === 401 || status === 403 ? 'authentication_or_permission' :
      status === 429 ? 'rate_limited' : status === 0 ? 'transport' : 'http_status' };
  if (typeof contentType !== 'string' || !/^application\/(?:[a-z0-9.-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    return { passed: false, reason: 'content_type' };
  }
  let value;
  try { value = JSON.parse(body); } catch { return { passed: false, reason: 'invalid_json' }; }
  if (!value || typeof value !== 'object' || !Object.keys(value).length) {
    return { passed: false, reason: 'empty_json' };
  }
  const entries = Array.isArray(value) ? value : [value];
  if (entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) ||
      !Object.keys(entry).length ||
      Object.hasOwn(entry, 'error') || Object.hasOwn(entry, 'errors') ||
      Object.hasOwn(entry, 'error_code'))) return { passed: false, reason: 'invalid_envelope' };
  if (typeof identifier !== 'string' || typeof value.metadata_id !== 'string' ||
      value.metadata_id.toLowerCase() !== identifier.toLowerCase()) {
    return { passed: false, reason: 'metadata_mismatch' };
  }
  if (!Array.isArray(value.contents) || value.contents.length !== expectedVisualizations) {
    return { passed: false, reason: 'visualization_count' };
  }
  const ids = new Set();
  let emptyVisualizationCount = 0;
  let returnedRowCount = 0;
  let availableRowCount = 0;
  const count = (number) => Number.isSafeInteger(number) && number >= 0;
  for (const item of value.contents) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        ['error', 'errors', 'error_code'].some((key) => Object.hasOwn(item, key)) ||
        typeof item.visualization_id !== 'string' || !guid.test(item.visualization_id) ||
        ids.has(item.visualization_id.toLowerCase()) ||
        !Array.isArray(item.column_names) || !item.column_names.length ||
        !item.column_names.every((name) => typeof name === 'string') ||
        !count(item.available_data_row_count) || !count(item.returned_data_row_count) ||
        item.returned_data_row_count > item.available_data_row_count ||
        item.returned_data_row_count > 1000 || item.record_offset !== 0 ||
        item.record_size !== 1000 || !Number.isFinite(item.sampling_ratio) ||
        item.sampling_ratio <= 0 || item.sampling_ratio > 1 ||
        !Array.isArray(item.data_rows) || item.data_rows.length !== item.column_names.length ||
        !item.data_rows.every((column) => Array.isArray(column) &&
          column.length === item.returned_data_row_count &&
          column.every((cell) => cell === null || typeof cell === 'string' ||
            typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell))))) {
      return { passed: false, reason: 'visualization_schema' };
    }
    ids.add(item.visualization_id.toLowerCase());
    if (item.returned_data_row_count === 0) emptyVisualizationCount += 1;
    returnedRowCount += item.returned_data_row_count;
    availableRowCount += item.available_data_row_count;
    if (!Number.isSafeInteger(availableRowCount)) return { passed: false, reason: 'visualization_schema' };
  }
  return { passed: true, reason: 'liveboard_contract', contract: {
    visualizationCount: ids.size, emptyVisualizationCount, returnedRowCount, availableRowCount,
  } };
}

export function liveboardMeasurement(value) {
  const fail = () => { throw new Error('Invalid API measurement; raw output withheld.'); };
  const reasons = ['authentication_or_permission', 'rate_limited', 'transport', 'http_status',
    'content_type', 'invalid_json', 'empty_json', 'invalid_envelope', 'metadata_mismatch',
    'visualization_count', 'visualization_schema', 'liveboard_contract'];
  if (!value || !Number.isInteger(value.status) || value.status < 0 || value.status > 599 ||
      typeof value.passed !== 'boolean' || !reasons.includes(value.reason) ||
      value.passed !== (value.reason === 'liveboard_contract') ||
      (value.passed && value.status !== 200)) fail();
  const result = { status: value.status, passed: value.passed, reason: value.reason };
  if (value.passed) {
    const contract = value.contract;
    if (!contract || contract.visualizationCount !== expectedVisualizations ||
        !Number.isInteger(contract.emptyVisualizationCount) || contract.emptyVisualizationCount < 0 ||
        contract.emptyVisualizationCount > expectedVisualizations ||
        !Number.isSafeInteger(contract.returnedRowCount) || contract.returnedRowCount < 0 ||
        contract.returnedRowCount > 1000 * (expectedVisualizations - contract.emptyVisualizationCount) ||
        contract.returnedRowCount < expectedVisualizations - contract.emptyVisualizationCount ||
        !Number.isSafeInteger(contract.availableRowCount) ||
        contract.availableRowCount < contract.returnedRowCount) fail();
    result.contract = Object.fromEntries(['visualizationCount', 'emptyVisualizationCount',
      'returnedRowCount', 'availableRowCount'].map((key) => [key, contract[key]]));
  }
  for (const key of ['elapsedMs', 'durationMs', 'blockedMs', 'connectingMs', 'tlsMs',
    'sendingMs', 'waitingMs', 'receivingMs']) {
    if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 300000) fail();
    result[key] = value[key];
  }
  return result;
}

export function liveboardMarkdown(session, measurement, success) {
  const lines = [
    '# Liveboard REST API smoke report', '',
    `**Liveboard response contract: ${success ? 'PASS' : 'FAIL / INCOMPLETE'}**`, '',
    `- Run ID: ${session.runId}`,
    `- Started: ${session.startedAt}`,
    '- Workload: one user, one iteration, one whole-Liveboard POST; no preflight or retry.',
    `- Endpoint: POST ${liveboardPath}`,
    '- Format: COMPACT; offset 0; up to 1000 records per visualization.',
    '- No visualization filter; saved Liveboard state, not transient browser filter state.',
    '- Authentication: supplied short-lived Bearer token; login/token acquisition excluded.',
    '',
  ];
  if (measurement) {
    lines.push(`- HTTP status: ${measurement.status}`,
      `- Validation: ${measurement.reason}`, '',
      '| Client-observed metric | Milliseconds |', '| --- | ---: |');
    for (const key of ['elapsedMs', 'durationMs', 'blockedMs', 'connectingMs', 'tlsMs',
      'sendingMs', 'waitingMs', 'receivingMs']) lines.push(`| ${key} | ${measurement[key].toFixed(2)} |`);
    if (measurement.contract) {
      lines.push('', `- Unique visualizations: ${measurement.contract.visualizationCount}/${expectedVisualizations}`,
        `- Empty visualizations: ${measurement.contract.emptyVisualizationCount}`,
        `- Returned rows (summed across visualizations): ${measurement.contract.returnedRowCount}`,
        `- Available rows reported (summed): ${measurement.contract.availableRowCount}`);
      if (measurement.contract.emptyVisualizationCount === expectedVisualizations) {
        lines.push('- WARNING: all visualizations returned zero rows. This is an empty-result timing, not a populated-data performance sample.');
      }
    }
  } else lines.push('No validated request measurement was received.');
  lines.push('', '## Interpretation and limitations', '',
    '- A pass verifies HTTP/JSON, requested metadata ID, 30 unique visualization IDs, numeric counts and column-array dimensions.',
    '- Schema checks use the supplied instance response. Unexpected shapes fail without retry.',
    '- Data correctness, expected per-visualization identities, authorization scope and completeness beyond the requested page are NOT verified.',
    '- durationMs is k6 sending + waiting + receiving; elapsedMs also includes connection/automation overhead.',
    '- This is not browser rendering, /prism/ replay, a cold-cache test or a full browser-equivalent load.',
    '- Client round-trip timing is not server processing time; no server/DB telemetry is connected.',
    '- No latency SLO, percentile, baseline, capacity or concurrency claim from one request.',
    '- Cache state is uncontrolled. This request may warm caches.',
    '- No IDs, token, request/response bodies, cookies or raw errors are retained.',
    '');
  return lines.join('\n');
}

export function liveboardBurstMeasurement(value) {
  const result = liveboardMeasurement(value);
  if (!Number.isInteger(value.vu) || value.vu < 1 || value.vu > 6 ||
      !Number.isSafeInteger(value.startedAtMs) || value.startedAtMs <= 0 ||
      !Number.isSafeInteger(value.finishedAtMs) || value.finishedAtMs <= value.startedAtMs ||
      value.finishedAtMs - value.startedAtMs !== result.elapsedMs) {
    throw new Error('Invalid API burst measurement; raw output withheld.');
  }
  return { ...result, vu: value.vu, startedAtMs: value.startedAtMs, finishedAtMs: value.finishedAtMs };
}

export function liveboardBurstSummary(measurements) {
  const records = measurements.map(liveboardBurstMeasurement);
  if (records.length > 6 || new Set(records.map((record) => record.vu)).size !== records.length) {
    throw new Error('Duplicate or excessive API burst measurements.');
  }
  const summary = { expectedRequests: 6, observedRequests: records.length,
    passedRequests: records.filter((record) => record.passed).length,
    peakClientInFlight: 0, startSpreadMs: null, requestWindowMs: null,
    durationMinMs: null, durationMeanMs: null, durationMaxMs: null };
  if (!records.length) return summary;
  const starts = records.map((record) => record.startedAtMs);
  const durations = records.map((record) => record.durationMs);
  summary.startSpreadMs = Math.max(...starts) - Math.min(...starts);
  summary.requestWindowMs = Math.max(...records.map((record) => record.finishedAtMs)) - Math.min(...starts);
  summary.durationMinMs = Math.min(...durations);
  summary.durationMeanMs = durations.reduce((total, value) => total + value, 0) / records.length;
  summary.durationMaxMs = Math.max(...durations);
  const events = records.flatMap((record) => [
    { at: record.startedAtMs, delta: 1 }, { at: record.finishedAtMs, delta: -1 },
  ]).sort((a, b) => a.at - b.at || a.delta - b.delta);
  let active = 0;
  for (const event of events) {
    active += event.delta;
    summary.peakClientInFlight = Math.max(summary.peakClientInFlight, active);
  }
  return summary;
}

export function liveboardBurstMarkdown(session, measurements, success) {
  const summary = liveboardBurstSummary(measurements);
  const lines = [
    '# Liveboard REST API six-user burst report', '',
    `**Response contracts and completion: ${success ? 'PASS' : 'FAIL / INCOMPLETE'}**`, '',
    `- Run ID: ${session.runId}`, `- Started: ${session.startedAt}`,
    '- Workload: six VUs, one iteration/request per VU; six requests total, shared Bearer token.',
    '- All VUs start together without a synchronization barrier; actual overlap is measured below.',
    '- No retries, redirects, preflight request, token acquisition or browser/SSO sessions.',
    `- Endpoint: POST ${liveboardPath}`,
    '- COMPACT format; saved board; offset 0; up to 1000 rows per visualization.',
    `- Measured requests: ${summary.observedRequests}/6; contract passes: ${summary.passedRequests}/6.`,
    `- Peak client requests in flight: ${summary.peakClientInFlight}/6.`,
    `- Request-start spread: ${summary.startSpreadMs ?? 'not measured'} ms.`,
    `- First request start to final response: ${summary.requestWindowMs ?? 'not measured'} ms.`,
    '', '| Request duration | Milliseconds |', '| --- | ---: |',
  ];
  for (const key of ['durationMinMs', 'durationMeanMs', 'durationMaxMs']) {
    lines.push(`| ${key} | ${summary[key] === null ? 'not measured' : summary[key].toFixed(2)} |`);
  }
  lines.push('', '| VU | HTTP | Result | Start offset ms | Elapsed ms | Duration ms | Waiting ms | Blocked ms | Connect ms | TLS ms | Sending ms | Receiving ms | Visualizations | Empty | Returned rows | Available rows |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const firstStart = measurements.length ? Math.min(...measurements.map((record) => record.startedAtMs)) : 0;
  for (const record of [...measurements].sort((a, b) => a.vu - b.vu)) {
    const timings = ['elapsedMs', 'durationMs', 'waitingMs', 'blockedMs', 'connectingMs',
      'tlsMs', 'sendingMs', 'receivingMs'].map((key) => record[key].toFixed(2)).join(' | ');
    const counts = record.contract ? ['visualizationCount', 'emptyVisualizationCount', 'returnedRowCount',
      'availableRowCount'].map((key) => record.contract[key]).join(' | ') : '- | - | - | -';
    lines.push(`| ${record.vu} | ${record.status} | ${record.reason} | ${record.startedAtMs - firstStart} | ${timings} | ${counts} |`);
  }
  if (measurements.length && measurements.every((record) =>
    record.contract?.emptyVisualizationCount === expectedVisualizations)) {
    lines.push('', '**WARNING: every measured response returned zero rows in all 30 visualizations. This is empty-result performance, not populated-data performance.**');
  }
  lines.push('', '## Interpretation and limitations', '',
    '- One burst is not a sustained-load test, capacity baseline, percentile estimate or latency SLA.',
    '- One identity/token from one load generator is not six independent logins, machines or browser tabs.',
    '- In-flight overlap covers client HTTP-call intervals (including connection setup), not verified server processing concurrency.',
    '- durationMs is sending + waiting + receiving; elapsed includes connection overhead, not JSON validation.',
    '- Each passing response matches the metadata ID, 30 unique visualization IDs, counts and column-array dimensions.',
    '- Per-visualization identity expectations, business correctness and completeness beyond the requested page are NOT verified.',
    '- Cache state is uncontrolled; shared identity may reuse caches. No backend/DB telemetry is connected.',
    '- No tokens, IDs, hosts, payloads, headers or raw errors are retained.',
    '');
  return lines.join('\n');
}
