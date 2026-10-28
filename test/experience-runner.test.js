import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { journeyPlan } from '../lib/journey-plan.js';

test('experience runner persists same-session API evidence, identity and missing-capture warnings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'experience-runner-fixture-'));
  try {
    for (const folder of ['scripts', 'lib', 'reference', 'bin']) mkdirSync(join(directory, folder));
    for (const file of ['scripts/run-login-poc.js', 'lib/local-credentials.js', 'lib/discovery-report.js',
      'lib/journey-report.js', 'lib/journey-plan.js', 'lib/filter-report.js', 'lib/experience-report.js',
      'lib/experience-api.js', 'reference/dashboard-ui-inventory.json']) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, '.env'),
      'ANALYTICS_USERNAME=PRIVATE_USER\nANALYTICS_PASSWORD=PRIVATE_PASSWORD\n', { mode: 0o600 });
    writeFileSync(join(directory, '.env.filter'), 'ANALYTICS_STUDY_GROUP=PRIVATE_GROUP\n', { mode: 0o600 });
    const inventory = JSON.parse(readFileSync(new URL('../reference/dashboard-ui-inventory.json', import.meta.url)));
    const plan = journeyPlan(inventory);
    const messages = ['LOGIN_POC_STATUS analytics_route_confirmed',
      'JOURNEY_BROWSER ' + JSON.stringify({ version: '123.0.0.0', devicePixelRatio: 1 })];
    let sequence = 0;
    for (const [tabIndex, tab] of plan.entries()) {
      for (const action of tabIndex === 0 ? ['dashboard_open', 'tab_switch'] : ['tab_switch']) {
        messages.push('JOURNEY_RECORD ' + JSON.stringify({
          sequence: ++sequence, action, tabIndex, checkpoint: 0, durationMs: 1200, status: 'passed',
          scroll: { top: 0, height: 720, total: 720, bottom: true },
          widgets: tab.widgets.map((_, widgetIndex) => ({ widgetIndex, state: 'ready_chart', readyAfterMs: 1000 })),
        }));
      }
    }
    messages.push('LOGIN_POC_STATUS journey_complete');
    for (const [index, action] of ['filter_apply', 'filter_reset'].entries()) {
      messages.push('FILTER_RECORD ' + JSON.stringify({
        sequence: index + 1, action, status: 'passed', durationMs: 1200,
        selectionVerified: true, spinnerSeen: true, spinnerCleared: true, rendererChanged: true, widgetsReady: true,
      }));
    }
    messages.push('LOGIN_POC_STATUS filter_complete');
    writeFileSync(join(directory, 'bin/k6'), `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
if (process.argv.includes('version')) console.log('k6 v2.3.0');
else {
  if (process.env.ANALYTICS_EXPERIENCE !== 'true') process.exit(1);
  const messages = JSON.parse(readFileSync(new URL('../messages.json', import.meta.url)));
  for (const msg of messages) console.log(JSON.stringify({source:'console',msg}));
}
`, { mode: 0o700 });
    const filesSeen = new Set();
    for (const mode of ['complete', 'missing', 'incomplete']) {
      const current = [...messages];
      if (mode !== 'missing') {
        current.push('EXPERIENCE_API ' + JSON.stringify({
          sequence: 1, phase: 'platform_authorization', operation: 'portfolio_authenticate',
          action: 'dashboard_open', actionSequence: 1, startedAtMs: 1793180000000,
          state: mode === 'complete' ? 'completed' : 'incomplete', status: mode === 'complete' ? 200 : null,
          elapsedMs: mode === 'complete' ? 1234 : null,
          traceId: '1234567890abcdef1234567890abcdef', responseRequestId: 'observed-response-id',
          body: 'PRIVATE_TOKEN',
        }));
        current.push('EXPERIENCE_API_CAPTURE ' + JSON.stringify({
          observed: 1, complete: mode === 'complete', collectionErrors: 0,
        }));
      }
      writeFileSync(join(directory, 'messages.json'), JSON.stringify(current));
      const result = spawnSync(process.execPath, [join(directory, 'scripts/run-login-poc.js'), '--manual-mfa', '--experience'],
        { env: { ...process.env, PATH: join(directory, 'bin') + ':' + process.env.PATH },
          encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 0, result.stderr);
      const filename = readdirSync(join(directory, 'results')).find((name) =>
        name.endsWith('.jsonl') && !filesSeen.has(name));
      filesSeen.add(filename);
      const path = join(directory, 'results', filename);
      const jsonl = readFileSync(path, 'utf8');
      const records = jsonl.trim().split('\n').map((line) => JSON.parse(line));
      assert.equal(filename, `experience-${records[0].reportId}.jsonl`);
      assert.equal(records[0].apiEvidence.cloudWatch.authorization.logGroup,
        '/aws/lambda/sandbox-pfui-analytics-api-getPortfolioAuthorizations');
      assert.equal(records[0].apiEvidence.cloudWatch.dashboard.region, 'us-east-1');
      assert.equal(records.at(-1).summary.api?.complete ?? null, mode === 'missing' ? null : mode === 'complete');
      const markdown = readFileSync(path.replace('.jsonl', '.md'), 'utf8');
      assert.match(markdown, /UI result: PASS/);
      assert.match(markdown, /initial widgets ready: \*\*1.200 s\*\*/);
      if (mode === 'complete') {
        assert.match(markdown, /1234567890abcdef1234567890abcdef/);
        assert.match(markdown, /1.234/);
        assert.match(markdown, /API capture: complete/);
      } else {
        assert.match(result.stderr, /API timing capture incomplete/);
        assert.match(markdown, /API capture: incomplete \/ unavailable/);
      }
      assert.doesNotMatch(jsonl + markdown + result.stdout + result.stderr, /PRIVATE_/);
      if (process.platform !== 'win32') {
        assert.equal(statSync(path).mode & 0o777, 0o600);
        assert.equal(statSync(path.replace('.jsonl', '.md')).mode & 0o777, 0o600);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
