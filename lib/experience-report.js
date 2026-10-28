import { apiCloudWatch, apiPhases } from './experience-api.js';

export function experienceReport(session, journey, filters, outcome, apiRecords = [], apiCapture = null) {
  const seconds = (value) => (value / 1000).toFixed(3);
  const completed = (records) => records.filter((r) => r.state === 'completed');
  const slowest = (records) => {
    const samples = completed(records);
    return samples.length ? seconds(Math.max(...samples.map((r) => r.elapsedMs))) : 'not measured';
  };
  const measured = [...journey, ...filters].filter((r) => r.action !== 'readiness_diagnostic');
  const dashboardOpen = journey.find((r) => r.action === 'dashboard_open');
  const coverage = outcome.summary.journey.coverage;
  const failures = apiRecords.filter((r) => r.state === 'failed' || r.status >= 400).length;
  const unfinished = apiRecords.filter((r) => r.state === 'incomplete').length;
  const lines = [
    '# Dashboard performance summary',
    '',
    `**UI result: ${outcome.success ? 'PASS' : 'FAIL / INCOMPLETE'}**`,
    `- Report/session ID: ${session.reportId ?? 'unavailable (older report)'}`,
    `- UTC session: ${session.startedAt} to ${outcome.finishedAt}`,
    `- Dashboard open to initial widgets ready: **${dashboardOpen?.status === 'passed' ?
      seconds(dashboardOpen.durationMs) + ' s' : 'not achieved / not measured'}**.`,
    `- UI coverage: ${coverage.reduce((sum, tab) => sum + tab.verified, 0)}/${coverage.reduce((sum, tab) =>
      sum + tab.expected, 0)} widgets; ${measured.filter((r) => r.status === 'passed').length}/${measured.length} actions passed.`,
    ...filters.map((r) => `- ${r.action === 'filter_apply' ? 'Filter apply' : 'Filter reset'}: ` +
      `${r.status === 'passed' ? seconds(r.durationMs) + ' s' : 'failed (not successful latency)'}.`),
    `- Original filter restored: ${outcome.summary.filter.restorationVerified ? 'yes' : 'not verified'}.`,
    ...(dashboardOpen?.status === 'failed' ? ['- Dashboard-open readiness failed; its elapsed attempt is not a successful load time.'] : []),
    '',
    '## Key API timings',
    '',
    '| API phase | Dashboard-open calls | Dashboard-open slowest (s) | Whole-session calls | Whole-session slowest (s) |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const phase of ['platform_authorization', 'platform_dashboard', 'thoughtspot_session', 'thoughtspot_widgets']) {
    const all = apiRecords.filter((r) => r.phase === phase);
    const opening = all.filter((r) => r.action === 'dashboard_open');
    lines.push(`| ${apiPhases[phase]} | ${opening.length || 'not observed'} | ${slowest(opening)} | ` +
      `${all.length || 'not observed'} | ${slowest(all)} |`);
  }
  lines.push('',
    '- Timings use completed browser responses only, including HTTP errors. Whole-session includes bootstrap, setup, traversal and filters.',
    '- ThoughtSpot widget RTT includes its downstream data-query work; it does not isolate database execution time.',
    '- Overlapping API calls are already within UX time: do not sum them or add them to dashboard readiness.',
    '',
    `**API capture: ${apiCapture?.complete ? 'complete' : 'incomplete / unavailable'}** — ` +
      `${apiRecords.length} observed; ${apiCapture?.collectionErrors ?? 'unknown'} collector errors; ` +
      `${failures} HTTP/transport failures; ${unfinished} missing completion events.`,
    '',
    '## Platform correlation',
    '',
    '| Phase / action | UTC request start | Response (s) | HTTP / state | Trace ID |',
    '| --- | --- | ---: | --- | --- |');
  const platform = apiRecords.filter((r) => ['platform_authorization', 'platform_dashboard'].includes(r.phase))
    .sort((a, b) => a.startedAtMs - b.startedAtMs || a.sequence - b.sequence);
  for (const r of platform) {
    lines.push(`| ${apiPhases[r.phase]} / ${r.action} | ${new Date(r.startedAtMs).toISOString()} | ` +
      `${r.elapsedMs === null ? 'unavailable' : seconds(r.elapsedMs)} | ${r.status ?? '-'} / ${r.state} | ` +
      `${r.traceId ?? 'unavailable'} |`);
  }
  if (!platform.length) lines.push('| No platform requests observed | - | - | - | unavailable |');
  lines.push('', '**CloudWatch — us-east-1** (known groups; logs not queried):');
  for (const phase of ['platform_authorization', 'platform_dashboard']) {
    const cw = apiCloudWatch(phase);
    lines.push(`- ${apiPhases[phase]}: [\`${cw.logGroup}\`](${cw.url})`);
  }
  lines.push('', 'Logs Insights: select the request UTC window and replace `TRACE_ID`:',
    '```sql', 'fields @timestamp, @message | filter @message like /TRACE_ID/ | sort @timestamp asc | limit 200', '```',
    '- ThoughtSpot calls have no assumed platform CloudWatch mapping.',
    '',
    session.reportId ? `Full request/action evidence and diagnostics: [JSONL companion](./experience-${session.reportId}.jsonl).` :
      'Full request/action evidence and diagnostics remain in the JSONL companion.',
    'Single-user authenticated session; uncontrolled cache. Missing evidence is not success; browser RTT is not backend execution.',
    '');
  return lines.join('\n');
}
