export function experienceReport(session, journey, filters, outcome) {
  const seconds = (value) => (value / 1000).toFixed(2);
  const measured = [...journey, ...filters].filter((record) => record.action !== 'readiness_diagnostic');
  const passed = measured.filter((record) => record.status === 'passed');
  const coverage = outcome.summary.journey.coverage;
  const lines = [
    '# Single-user dashboard experience',
    '',
    `**Overall result: ${outcome.success ? 'PASS' : 'FAIL / INCOMPLETE'}**`,
    '',
    `- Started: ${session.startedAt}`,
    `- Finished: ${outcome.finishedAt}`,
    '- One user, one iteration, one browser session; viewport 1280x720.',
    `- Passed measured actions: ${passed.length}/${measured.length} recorded.`,
    `- Sum of passed action durations: **${seconds(passed.reduce((sum, record) => sum + record.durationMs, 0))}s**.`,
    '- This sum is not wall-clock journey time; login/MFA, setup, option choice and post-render selection verification are excluded.',
    `- Original filter selection verified: **${outcome.summary.filter.restorationVerified ? 'yes' : 'no / not measured'}**.`,
    '',
    '## Action timings',
    '',
    '| Step | Action | Tab | Checkpoint | Result | Duration (s) |',
    '| --- | --- | --- | --- | --- | ---: |',
  ];
  for (const [index, record] of measured.entries()) {
    lines.push(`| ${index + 1} | ${record.action} | ${record.tabIndex === undefined ? '-' : record.tabIndex + 1} | ` +
      `${record.checkpoint ?? '-'} | ${record.status} | ${seconds(record.durationMs)} |`);
  }
  lines.push('', '## Action groups', '',
    '| Action | Passed / recorded | Sum of passed durations (s) |',
    '| --- | ---: | ---: |');
  for (const action of ['dashboard_open', 'tab_switch', 'scroll', 'filter_apply', 'filter_reset']) {
    const samples = measured.filter((record) => record.action === action);
    const successes = samples.filter((record) => record.status === 'passed');
    lines.push(`| ${action} | ${successes.length}/${samples.length} | ` +
      `${seconds(successes.reduce((sum, record) => sum + record.durationMs, 0))} |`);
  }
  lines.push('', 'Failed durations are diagnostic elapsed time, not successful completion latency.',
    'A zero failed filter duration means failure before timed Apply.', '',
    '## Dashboard coverage', '',
    '| Tab | Widgets verified | Tab entry passed | Bottom reached |',
    '| --- | ---: | --- | --- |');
  for (const tab of coverage) {
    lines.push(`| ${tab.tabIndex + 1} | ${tab.verified}/${tab.expected} | ${tab.tabSwitchPassed} | ${tab.bottomReached} |`);
  }
  lines.push('', 'Coverage is from the unfiltered traversal; filter readiness covers the six initial widgets only.',
    '', '## Runtime and interpretation', '',
    `- Node ${session.runner.node}; k6 ${session.runner.k6Version}; ${session.runner.platform}/${session.runner.architecture}.`,
    `- Start free host memory: ${(session.runner.freeMemoryBytes / 1048576).toFixed(0)} MiB.`,
    `- Start host load averages: ${session.runner.loadAverage.join(', ')}.`,
    '- Raw JSONL companion contains browser version, runtime metadata and validated per-action evidence.',
    '- Authenticated reload is not cold-cache or first-ever navigation; cache state is uncontrolled.',
    '- Includes automation, polling and DOM-observer overhead; no backend/query-only latency or fresh-data guarantee.',
    '- One sample per action/checkpoint: no percentile, SLA, regression or concurrency claim.',
    '- No drill-downs, nested-table scrolling, exports, saves or global reset.',
    '- A passed traversal cannot hide failed filter actions or unverified restoration.',
    '- Read raw evidence for failures and diagnostics; missing actions are not passes.',
    '');
  return lines.join('\n');
}
