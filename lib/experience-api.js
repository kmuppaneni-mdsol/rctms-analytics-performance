const platformOrigin = 'https://home-sandbox.imedidata.net';
const thoughtSpotOrigin = 'https://medidata-dev.thoughtspot.cloud';
export const apiPhases = {
  platform_authorization: 'Platform authorization',
  platform_dashboard: 'Platform dashboard definition',
  thoughtspot_session: 'ThoughtSpot dashboard session',
  thoughtspot_widgets: 'ThoughtSpot widget data',
  thoughtspot_other: 'ThoughtSpot other API',
};
const actions = /^(bootstrap|journey_setup|filter_setup|dashboard_open|tab_switch|scroll|filter_apply|filter_reset)$/;
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
const header = (headers, name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
export const apiErrorCategories = ['request_metadata', 'request_matching', 'response_metadata', 'request_limit', 'drain_timeout'];

export function apiEndpoint(url, method, body) {
  if (typeof url !== 'string') return null;
  const clean = url.split('?')[0];
  if (method === 'POST' && clean === `${platformOrigin}/api/analytics/portfolio/authenticate`) {
    return { phase: 'platform_authorization', operation: 'portfolio_authenticate' };
  }
  if (method === 'GET' && new RegExp(`^${platformOrigin.replaceAll('.', '\\.')}/api/analytics/dashboards/[a-f0-9-]{36}$`, 'i').test(clean)) {
    return { phase: 'platform_dashboard', operation: 'dashboard_definition' };
  }
  if (!clean.startsWith(`${thoughtSpotOrigin}/`)) return null;
  const path = clean.slice(thoughtSpotOrigin.length);
  if (path === '/prism/' || path === '/prism') {
    let operation;
    try { operation = JSON.parse(body)?.operationName; } catch { /* Non-JSON GraphQL traffic remains unclassified. */ }
    // Only known operation names are retained; queries and variables never leave memory.
    const known = ['LoadPinboardSession', 'LoadContextBook', 'GetPersonalisedViews', 'updateUserPreferences',
      'isPublished', 'getVerificationStatus', 'getPinboardDataSources', 'GetHomepageModuleList',
      'GetStyleConfigMap', 'GetEmbedActionsAssociation', 'GetCommunicationConnections'];
    const name = known.includes(operation) ? operation : 'other_graphql';
    return { phase: name === 'LoadPinboardSession' ? 'thoughtspot_session' :
      name === 'LoadContextBook' ? 'thoughtspot_widgets' : 'thoughtspot_other', operation: name };
  }
  if (/^\/(?:callosum\/|api\/rest\/)/.test(path) && !/telemetry|metrics|logupload/i.test(path)) {
    return { phase: 'thoughtspot_other', operation: 'other_rest' };
  }
  return null;
}

export function apiRecord(value) {
  const number = (v) => Number.isFinite(v) && v >= 0;
  if (!value || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 5000 ||
      !Object.hasOwn(apiPhases, value.phase) ||
      !/^(portfolio_authenticate|dashboard_definition|LoadPinboardSession|LoadContextBook|GetPersonalisedViews|updateUserPreferences|isPublished|getVerificationStatus|getPinboardDataSources|GetHomepageModuleList|GetStyleConfigMap|GetEmbedActionsAssociation|GetCommunicationConnections|other_graphql|other_rest)$/.test(value.operation) ||
      !actions.test(value.action) || !Number.isSafeInteger(value.actionSequence) || value.actionSequence < 0 ||
      value.actionSequence > 1000 || !number(value.startedAtMs) || value.startedAtMs > 8640000000000000 ||
      !['completed', 'failed', 'incomplete'].includes(value.state) ||
      !(value.elapsedMs === null || number(value.elapsedMs)) ||
      !(value.status === null || Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) ||
      (value.completionReason !== undefined && (value.state !== 'incomplete' ||
        !['no_terminal_event_after_reload', 'no_terminal_event_at_capture_end'].includes(value.completionReason))) ||
      (value.state === 'completed' && (value.elapsedMs === null || value.status === null))) {
    throw new Error('Invalid API evidence; raw details withheld.');
  }
  const match = typeof value.traceparent === 'string' &&
    /^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/.exec(value.traceparent);
  const traceId = match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]) ? match[1] :
    value.traceparent == null && typeof value.traceId === 'string' &&
    /^[a-f0-9]{32}$/.test(value.traceId) && !/^0+$/.test(value.traceId) ? value.traceId : null;
  return {
    sequence: value.sequence, phase: value.phase, operation: value.operation,
    action: value.action, actionSequence: value.actionSequence, startedAtMs: value.startedAtMs,
    state: value.state, status: value.status, elapsedMs: value.elapsedMs,
    traceId, responseRequestId: identifier(value.responseRequestId),
    ...(value.completionReason ? { completionReason: value.completionReason } : {}),
  };
}

// Listen only: no interception, response-body reads, extra requests, or retries.
export function observeExperienceApi(page, emit, { metadataTimeoutMs = 2000, drainTimeoutMs = 5000 } = {}) {
  if (![metadataTimeoutMs, drainTimeoutMs].every((v) => Number.isSafeInteger(v) && v > 0 && v <= 10000)) {
    throw new Error('Invalid API evidence timeout');
  }
  const requests = [];
  const jobs = new Set();
  let action = 'bootstrap';
  let actionSequence = 0;
  let sequence = 0;
  let collectionErrors = 0;
  const errorCounts = Object.fromEntries(apiErrorCategories.map((name) => [name, 0]));
  let accepting = true;
  let sealed = false;
  async function bounded(work, timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        work(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('API metadata collection timed out')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function recordError(category) {
    if (sealed) return;
    collectionErrors += 1;
    errorCounts[category] += 1;
  }
  function schedule(category, work) {
    if (!accepting) return;
    const job = work().catch(() => { recordError(category); });
    jobs.add(job);
    job.finally(() => jobs.delete(job));
  }
  page.on('request', (request) => {
    const scope = { action, actionSequence };
    const observedSequence = ++sequence;
    const startedAtMs = Date.now();
    schedule('request_metadata', async () => {
      const endpoint = apiEndpoint(request.url(), request.method(), request.postData());
      if (!endpoint) return;
      if (requests.length >= 5000) {
        recordError('request_limit');
        return;
      }
      const record = { sequence: observedSequence, ...endpoint, ...scope, startedAtMs,
        state: 'incomplete', status: null, elapsedMs: null };
      requests.push({ request, record });
      // headerValue/allHeaders wait for CDP raw-header events that may never arrive.
      record.traceparent = header(request.headers(), 'traceparent');
    });
  });
  function finish(request, failed) {
    const finishedAtMs = Date.now();
    schedule('response_metadata', async () => {
      if (!apiEndpoint(request.url(), request.method(), request.postData())) return;
      const candidates = requests.filter((entry) => !entry.claimed && entry.record.state === 'incomplete' &&
        entry.request.url() === request.url() && entry.request.method() === request.method() &&
        entry.request.postData() === request.postData());
      let matched;
      if (candidates.length === 1) {
        [matched] = candidates;
      } else {
        // k6 event wrappers have different JS identities. Use the retained native
        // request's start time only to disambiguate concurrent identical requests.
        const timing = request.timing();
        const matches = [];
        if (Number.isFinite(timing?.startTime)) {
          for (const candidate of candidates) {
            const candidateTiming = candidate.request.timing();
            if (candidateTiming?.startTime === timing.startTime) matches.push(candidate);
          }
          if (sealed) return;
        }
        if (matches.length === 1) [matched] = matches;
      }
      if (!matched) {
        recordError('request_matching');
        return;
      }
      if (sealed) return;
      matched.claimed = true;
      const { record } = matched;
      record.elapsedMs = finishedAtMs - record.startedAtMs;
      if (!failed) {
        const response = await bounded(() => request.response(), metadataTimeoutMs);
        if (sealed) return;
        record.status = response.status();
        record.state = 'completed';
        const headers = response.headers();
        record.responseRequestId = header(headers, 'x-amzn-requestid') ?? header(headers, 'x-request-id');
      } else {
        record.state = 'failed';
      }
    });
  }
  page.on('requestfinished', (request) => finish(request, false));
  page.on('requestfailed', (request) => finish(request, true));
  return {
    action(name, index = 0) {
      if (!actions.test(name) || !Number.isSafeInteger(index) || index < 0 || index > 1000) {
        throw new Error('Invalid API action boundary');
      }
      action = name;
      actionSequence = index;
      if (name === 'dashboard_open') {
        for (const entry of requests) {
          if (entry.record.state === 'incomplete' && !entry.claimed) entry.pendingAtReload = true;
        }
      }
    },
    async finish() {
      accepting = false;
      try {
        await bounded(() => Promise.all([...jobs]), drainTimeoutMs);
      } catch {
        recordError('drain_timeout');
      }
      sealed = true;
      for (const entry of requests) {
        if (entry.record.state === 'incomplete') entry.record.completionReason = entry.pendingAtReload ?
          'no_terminal_event_after_reload' : 'no_terminal_event_at_capture_end';
      }
      const records = requests.map((entry) => entry.record).sort((a, b) => a.sequence - b.sequence);
      for (const [index, record] of records.entries()) emit(apiRecord({ ...record, sequence: index + 1 }));
      return { type: 'api_capture', observed: records.length, collectionErrors, errorCounts: { ...errorCounts },
        complete: collectionErrors === 0 && records.every((record) => record.state === 'completed') };
    },
  };
}

export function apiCloudWatch(phase) {
  const handler = phase === 'platform_authorization' ? 'getPortfolioAuthorizations' :
    phase === 'platform_dashboard' ? 'getDashboard' : null;
  if (!handler) return null;
  const logGroup = `/aws/lambda/sandbox-pfui-analytics-api-${handler}`;
  const encoded = encodeURIComponent(encodeURIComponent(logGroup)).replaceAll('%', '$');
  return { region: 'us-east-1', logGroup,
    url: `https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/${encoded}` };
}

export function apiMarkdown(records, capture, actionScopes = []) {
  const seconds = (value) => (value / 1000).toFixed(3);
  const timingCells = (samples) => {
    const completed = samples.filter((r) => r.state === 'completed');
    const failures = samples.filter((r) => r.state === 'failed' || r.status >= 400).length;
    const window = completed.length ? Math.max(...completed.map((r) => r.startedAtMs + r.elapsedMs)) -
      Math.min(...samples.map((r) => r.startedAtMs)) : null;
    return `${samples.length || 'not observed'} | ${failures} | ${samples.filter((r) => r.state === 'incomplete').length} | ` +
      `${completed.length ? seconds(Math.max(...completed.map((r) => r.elapsedMs))) : 'not measured'} | ` +
      `${window === null ? 'not measured' : seconds(window)} |`;
  };
  const lines = ['## Same-session API response summary', '',
    `- Capture: **${capture?.complete ? 'complete' : 'incomplete / unavailable'}**; collection errors: ${capture?.collectionErrors ?? 'unavailable'}.`,
    ...(capture?.errorCounts ? [`- Collector diagnostics: ${apiErrorCategories.map((category) =>
      `${category}=${capture.errorCounts[category]}`).join(', ')}.`] : []),
    '- Browser-observed request event to requestfinished event (full response); includes event-dispatch overhead, not backend execution or Snowflake query time.',
    '- Grouped by action at request initiation. Bootstrap/setup is separate from timed actions.',
    '- Calls overlap and are already inside the experience; do not add these timings to UX totals.',
    '- HTTP failures and unfinished requests remain visible. HTTP 200 does not prove GraphQL/application success.',
    '- A request outstanding when reload starts may receive no terminal event from k6. Such calls retain an explicit missing-event reason; neither cancellation nor response completion is inferred.',
    '- Only allowlisted platform and ThoughtSpot API routes are captured; not all browser traffic.', '',
    `- Observed API UTC window: ${records.length ? new Date(Math.min(...records.map((r) => r.startedAtMs))).toISOString() +
      ' → ' + new Date(Math.max(...records.map((r) => r.startedAtMs + (r.elapsedMs ?? 0)))).toISOString() :
      'not observed'} (unfinished requests have no response-end time).`, '',
    'Session-wide summary includes bootstrap/setup; expand the action breakdown to isolate dashboard loading or filters.', '',
    '| API phase | Calls | HTTP/transport failures | Unfinished | Slowest completed (s) | First start to last completed response (s) |',
    '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const [phase, label] of Object.entries(apiPhases)) {
    lines.push(`| ${label} | ${timingCells(records.filter((r) => r.phase === phase))}`);
  }
  lines.push('', '<details>', '<summary>API timings by action</summary>', '',
    '| Action | API phase | Calls | HTTP/transport failures | Unfinished | Slowest completed (s) | First start to last completed response (s) |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |');
  const scopes = new Map(actionScopes.map((scope) => [`${scope.action}:${scope.actionSequence}`, scope]));
  for (const record of records) scopes.set(`${record.action}:${record.actionSequence}`, record);
  for (const scope of scopes.values()) {
    for (const [phase, label] of Object.entries(apiPhases)) {
      const samples = records.filter((r) => r.action === scope.action &&
        r.actionSequence === scope.actionSequence && r.phase === phase);
      lines.push(`| ${scope.action}${scope.actionSequence ? ` #${scope.actionSequence}` : ''} | ${label} | ` +
        timingCells(samples));
    }
  }
  lines.push('', '</details>', '', '<details>',
    '<summary>API request evidence (request-start order, trace IDs and log links)</summary>', '',
    '| # | Action | Operation | UTC request start | HTTP / state | Response (s) | Trace ID | Response request ID | CloudWatch | Missing completion evidence |',
    '| ---: | --- | --- | --- | --- | ---: | --- | --- | --- | --- |');
  for (const r of [...records].sort((a, b) => a.startedAtMs - b.startedAtMs || a.sequence - b.sequence)) {
    const cw = apiCloudWatch(r.phase);
    lines.push(`| ${r.sequence} | ${r.action} #${r.actionSequence} | ${r.operation} | ${new Date(r.startedAtMs).toISOString()} | ` +
      `${r.status ?? '-'} / ${r.state} | ${r.elapsedMs === null ? 'unavailable' : seconds(r.elapsedMs)} | ` +
      `${r.traceId ?? 'unavailable'} | ${r.responseRequestId ?? 'unavailable'} | ${cw ? `[logs](${cw.url})` : 'not platform Lambda logs'} | ${r.completionReason ?? '-'} |`);
  }
  lines.push('', '</details>', '', '### Platform log correlation', '',
    '- Region: `us-east-1`. Known sandbox group names; log availability is not checked.',
    ...['platform_authorization', 'platform_dashboard'].map((phase) => {
      const cw = apiCloudWatch(phase);
      return `- ${apiPhases[phase]}: [\`${cw.logGroup}\`](${cw.url})`;
    }),
    '- Open the group in Logs Insights, select the UTC request window (with a few minutes of margin), and replace TRACE_ID below with the request trace.',
    '- Missing trace IDs are not invented. A response request ID is not a verified Lambda invocation ID.',
    '- ThoughtSpot IDs are observed response headers only; no ThoughtSpot-to-CloudWatch mapping is assumed.',
    '', '```sql', 'fields @timestamp, @logStream, @message',
    '| filter @message like /TRACE_ID/', '| sort @timestamp asc', '| limit 200', '```', '');
  return lines;
}
