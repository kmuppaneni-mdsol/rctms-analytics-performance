import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('authorization runner persists sanitized success/failure and never treats bootstrap as a sample', () => {
  const directory = mkdtempSync(join(tmpdir(), 'authorization-runner-fixture-'));
  try {
    for (const folder of ['scripts', 'lib', 'node_modules/playwright-core']) {
      mkdirSync(join(directory, folder), { recursive: true });
    }
    for (const file of ['scripts/run-authorization-api.js', 'lib/local-credentials.js',
      'lib/authorization-api.js']) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, '.env'),
      'ANALYTICS_USERNAME=synthetic-private-user\nANALYTICS_PASSWORD=synthetic-private-password\n',
      { mode: 0o600 });
    writeFileSync(join(directory, '.env.authorization'), 'AUTH_SAMPLES=2\n', { mode: 0o600 });
    writeFileSync(join(directory, 'node_modules/playwright-core/package.json'),
      '{"type":"module","exports":"./index.js"}');
    writeFileSync(join(directory, 'node_modules/playwright-core/index.js'), `
      const sg = '00000000-0000-0000-0000-000000000001';
      const mode = process.env.FIXTURE_MODE;
      const result = { token: 'synthetic-private-token',
        appPrivileges: { portfolio_analytics_viewer: true }, eligibleSGUUIDs: [sg],
        authorizations: [{ read_visits: { availableSGUUIDs: [sg],
          datasourceGroup: 'private-group', dataSources: [] } }] };
      const body = { contextType: 'unspecified', contextUUID: '',
        displayName: 'Synthetic private name', userLocale: 'eng' };
      let location = 'about:blank';
      let calls = 0;
      const listeners = new Set();
      const locator = { count: async () => 1, fill: async () => {}, click: async () => {},
        waitFor: async () => {} };
      const page = {
        url: () => location, locator: () => locator,
        goto: async (url) => { location = url.includes('/apps/') ? url :
          mode === 'wrong_origin' ? 'https://unexpected.invalid/' :
          'https://login-sandbox.imedidata.net/login'; },
        waitForURL: async () => { location = 'https://home-sandbox.imedidata.net/'; },
        waitForResponse: async () => ({
          request: () => ({ postDataJSON: () => body }), finished: async () => null,
          status: () => mode === 'bootstrap_failure' ? 403 : 200,
          headers: () => ({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify(result),
        }),
        on: (_, listener) => listeners.add(listener),
        off: (_, listener) => listeners.delete(listener),
        waitForTimeout: async () => {},
        evaluate: async (_, params) => {
          calls++;
          for (const listener of listeners) listener({
            url: () => 'https://home-sandbox.imedidata.net/api/analytics/portfolio/authenticate',
            method: () => 'POST', postData: () => params.body, allHeaders: async () => ({}),
          });
          return { status: mode === 'sample_failure' ? 500 : 200,
            contentType: 'application/json', body: JSON.stringify(result),
            startedAt: '2026-10-28T00:00:00Z',
            elapsedMs: mode === 'invalid_timing' ? -1 : 100, headersMs: 90, receiveMs: 10,
            requestBodyBytes: 120, responseDecodedBytes: 400 };
        },
      };
      export const chromium = { launch: async () => {
        if (mode === 'launch_failure') throw new Error('synthetic-private-password');
        return {
          newContext: async () => ({ newPage: async () => page, close: async () => {} }),
          close: async () => { if (mode === 'cleanup_failure') throw new Error('private cleanup'); },
        };
      } };
    `);
    const runner = join(directory, 'scripts/run-authorization-api.js');
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import(${JSON.stringify(pathToFileURL(runner).href)})`], { encoding: 'utf8' });
    assert.notEqual(imported.status, 0);
    assert.match(imported.stderr, /executable-only/);
    const modes = ['success', 'sample_failure', 'bootstrap_failure', 'invalid_timing',
      'launch_failure', 'wrong_origin', 'cleanup_failure'];
    const observed = new Set();
    for (const mode of modes) {
      const processResult = spawnSync(process.execPath, [runner], {
        encoding: 'utf8', env: { ...process.env, FIXTURE_MODE: mode }, timeout: 10000,
      });
      assert.equal(processResult.status, mode === 'success' ? 0 : 1, mode);
      const files = readdirSync(join(directory, 'results')).filter((name) =>
        name.endsWith('.json') && !observed.has(name));
      assert.equal(files.length, 1, mode);
      observed.add(files[0]);
      const jsonPath = join(directory, 'results', files[0]);
      const text = readFileSync(jsonPath, 'utf8');
      const report = JSON.parse(text);
      const markdown = readFileSync(jsonPath.replace(/\.json$/, '.md'), 'utf8');
      assert.equal(report.reportId, report.session.runId);
      assert.equal(files[0], `authorization-${report.reportId}.json`);
      assert.equal(report.cloudWatch.region, 'us-east-1');
      assert.equal(report.cloudWatch.logGroup,
        '/aws/lambda/sandbox-pfui-analytics-api-getPortfolioAuthorizations');
      assert.ok(markdown.includes(report.reportId));
      assert.ok(markdown.includes(report.cloudWatch.logGroup));
      assert.ok(report.measurements.every((measurement) => measurement.traceId === null));
      assert.equal(report.success, mode === 'success', mode);
      assert.equal(report.outcome, mode === 'success' ? 'authorization-contract-passed' : 'failed', mode);
      assert.equal(report.measurements.length, mode === 'success' || mode === 'cleanup_failure' ? 2 :
        mode === 'sample_failure' ? 1 : 0, mode);
      if (mode === 'success') assert.equal(report.summary.complete, true);
      if (mode === 'bootstrap_failure') assert.equal(report.bootstrap.reason, 'authentication_or_permission');
      if (process.platform !== 'win32') assert.equal(statSync(jsonPath).mode & 0o777, 0o600);
      for (const secret of ['synthetic-private-password', 'synthetic-private-user',
        'synthetic-private-token', 'Synthetic private name', 'private-group',
        '00000000-0000-0000-0000-000000000001']) {
        assert.ok(!(text + markdown + processResult.stdout + processResult.stderr).includes(secret), mode);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
