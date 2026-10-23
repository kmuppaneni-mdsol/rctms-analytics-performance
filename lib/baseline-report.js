import { journeyRecord, journeySummary } from './journey-report.js';

export function baselineSummary(runs, tabs) {
  const fail = () => { throw new Error('Baseline requires three complete, sequential, comparable journey reports.'); };
  if (!Array.isArray(runs) || runs.length !== 3) fail();
  let previousFinish = -Infinity;
  let signature;
  let actionKeys;
  const measured = runs.map((lines) => {
    const session = lines[0];
    const outcome = lines.at(-1);
    const browsers = lines.filter((line) => line.type === 'browser');
    const browser = browsers[0];
    const start = Date.parse(session.startedAt);
    const finish = Date.parse(outcome.finishedAt);
    const runner = session.runner;
    if (session.type !== 'session' || session.mode !== 'timed-read-only-journey' ||
        session.performanceMeasured !== true || session.users !== 1 || session.iterations !== 1 ||
        !Number.isFinite(start) || !Number.isFinite(finish) || finish < start || start < previousFinish ||
        outcome.type !== 'outcome' || outcome.success !== true || browsers.length !== 1 ||
        browser.engine !== 'chromium' || !/^\d+\.\d+\.\d+\.\d+$/.test(browser.version) ||
        !Number.isFinite(browser.devicePixelRatio) || browser.devicePixelRatio <= 0 ||
        browser.devicePixelRatio > 10 || !runner ||
        JSON.stringify(session.tabs.map((tab) => ({ name: tab.name, widgets: tab.widgets }))) !==
          JSON.stringify(tabs.map((tab) => ({ name: tab.name, widgets: tab.widgets })))) fail();
    if (!/^v\d+\.\d+\.\d+$/.test(runner.node) || !/^\d+\.\d+\.\d+$/.test(runner.k6Version) ||
        !['darwin', 'linux', 'win32'].includes(runner.platform) ||
        !['arm64', 'x64'].includes(runner.architecture) ||
        typeof runner.osRelease !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}$/.test(runner.osRelease) ||
        !Number.isSafeInteger(runner.logicalCpus) || runner.logicalCpus <= 0 ||
        !Number.isSafeInteger(runner.totalMemoryBytes) || runner.totalMemoryBytes <= 0 ||
        !Number.isSafeInteger(runner.freeMemoryBytes) || runner.freeMemoryBytes < 0 ||
        runner.freeMemoryBytes > runner.totalMemoryBytes ||
        !Array.isArray(runner.loadAverage) || runner.loadAverage.length !== 3 ||
        runner.loadAverage.some((value) => !Number.isFinite(value) || value < 0)) fail();
    previousFinish = finish;
    const currentSignature = JSON.stringify({
      viewport: session.viewport, scope: session.scope, clock: session.clock,
      cacheState: session.cacheState, readinessTimeoutMs: session.readinessTimeoutMs,
      pollIntervalMs: session.pollIntervalMs, browser,
      node: session.runner.node, k6Version: session.runner.k6Version, platform: session.runner.platform,
      architecture: session.runner.architecture, osRelease: session.runner.osRelease,
      logicalCpus: session.runner.logicalCpus, totalMemoryBytes: session.runner.totalMemoryBytes,
    });
    if (signature !== undefined && currentSignature !== signature) fail();
    signature = currentSignature;
    const actions = lines.filter((line) => line.type === 'measurement')
      .map((line) => journeyRecord(line, tabs));
    if (actions.some((action, index) => action.sequence !== index + 1) ||
        !journeySummary(actions, tabs).complete) fail();
    const keys = actions.map((action) => `${action.tabIndex}:${action.action}:${action.checkpoint}`);
    if (new Set(keys).size !== keys.length ||
        (actionKeys && JSON.stringify(keys) !== JSON.stringify(actionKeys))) fail();
    actionKeys = keys;
    return { session, browser: {
      type: 'browser', engine: browser.engine, version: browser.version,
      devicePixelRatio: browser.devicePixelRatio,
    }, runner: {
      node: runner.node, k6Version: runner.k6Version, platform: runner.platform,
      architecture: runner.architecture, osRelease: runner.osRelease,
      logicalCpus: runner.logicalCpus, totalMemoryBytes: runner.totalMemoryBytes,
      freeMemoryBytes: runner.freeMemoryBytes, loadAverage: runner.loadAverage,
    }, actions };
  });
  function stats(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return { samples: values.length, minMs: sorted[0], medianMs: sorted[1],
      maxMs: sorted.at(-1), meanMs: values.reduce((sum, value) => sum + value, 0) / values.length };
  }
  return {
    type: 'three-run-baseline',
    scope: measured[0].session.scope,
    limitations: 'Three sequential single-user runs; uncontrolled service/data/cache and other machine workload. ' +
      'No initial dashboard-open, filters, exports, concurrency, SLA or percentile claims. ' +
      'Action totals exclude authentication, MFA, setup and gaps between actions.',
    conditions: measured.map(({ session, browser, runner }) => ({
      startedAt: session.startedAt, runner, browser,
      viewport: session.viewport, cacheState: session.cacheState,
    })),
    measuredActionTotals: stats(measured.map(({ actions }) =>
      actions.reduce((sum, action) => sum + action.durationMs, 0))),
    tabs: tabs.map((tab, tabIndex) => ({
      name: tab.name, verifiedWidgetsPerRun: tab.widgets.length,
      tabSwitch: stats(measured.map(({ actions }) =>
        actions.find((action) => action.tabIndex === tabIndex && action.action === 'tab_switch').durationMs)),
      measuredActionTotal: stats(measured.map(({ actions }) =>
        actions.filter((action) => action.tabIndex === tabIndex)
          .reduce((sum, action) => sum + action.durationMs, 0))),
    })),
    actions: measured[0].actions.map((action, index) => ({
      tabIndex: action.tabIndex, action: action.action, checkpoint: action.checkpoint,
      duration: stats(measured.map(({ actions }) => actions[index].durationMs)),
    })),
  };
}
