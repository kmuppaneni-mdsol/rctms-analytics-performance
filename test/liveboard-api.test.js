import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liveboardBody, liveboardBurstMarkdown, liveboardBurstMeasurement, liveboardBurstSummary,
  liveboardConfig, liveboardMarkdown, liveboardMeasurement, liveboardResponse } from '../lib/liveboard-api.js';

const valid = { TS_HOST: 'https://example.thoughtspot.cloud',
  LIVEBOARD_ID: '00000000-0000-0000-0000-000000000001', TS_TOKEN: 'local-fake-token' };
const sample = { status: 200, passed: true, reason: 'liveboard_contract',
  contract: { visualizationCount: 30, emptyVisualizationCount: 30, returnedRowCount: 0, availableRowCount: 0 },
  elapsedMs: 20, durationMs: 10, blockedMs: 1, connectingMs: 1, tlsMs: 1,
  sendingMs: 1, waitingMs: 8, receivingMs: 1 };

test('API config restricts destinations and never discloses invalid input', () => {
  assert.deepEqual(liveboardConfig(valid), valid);
  for (const TS_HOST of ['http://example.thoughtspot.cloud', 'https://example.invalid',
    'https://user:password@example.thoughtspot.cloud', 'https://example.thoughtspot.cloud/path',
    'https://example.thoughtspot.cloud?token=private', 'https://example.thoughtspot.cloud:444']) {
    assert.throws(() => liveboardConfig({ ...valid, TS_HOST }), /Values withheld/);
  }
  for (const key of ['LIVEBOARD_ID', 'TS_TOKEN']) {
    assert.throws(() => liveboardConfig({ ...valid, [key]: '' }), /Values withheld/);
  }
  assert.deepEqual(JSON.parse(liveboardBody(valid.LIVEBOARD_ID)), {
    metadata_identifier: valid.LIVEBOARD_ID, data_format: 'COMPACT', record_offset: 0, record_size: 1000,
  });
});

function board() {
  return { metadata_id: valid.LIVEBOARD_ID, contents: Array.from({ length: 30 }, (_, index) => ({
    visualization_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
    column_names: ['synthetic'], data_rows: [[]], record_offset: 0, record_size: 1000,
    returned_data_row_count: 0, available_data_row_count: 0, sampling_ratio: 1,
  })) };
}

test('API validates HTTP, JSON, identity, coverage and supplied response dimensions', () => {
  const evaluate = (value) => liveboardResponse(200, 'application/json; charset=utf-8',
    JSON.stringify(value), valid.LIVEBOARD_ID);
  assert.deepEqual(evaluate(board()), {
    passed: true, reason: 'liveboard_contract', contract: sample.contract,
  });
  const populated = board();
  populated.contents[0].data_rows = [[1, null]];
  populated.contents[0].returned_data_row_count = 2;
  populated.contents[0].available_data_row_count = 5;
  assert.deepEqual(evaluate(populated).contract, {
    visualizationCount: 30, emptyVisualizationCount: 29, returnedRowCount: 2, availableRowCount: 5,
  });
  for (const mutate of [
    (value) => { value.contents[0].data_rows = []; },
    (value) => { value.contents[0].data_rows = [[123]]; },
    (value) => { value.contents[0].visualization_id = value.contents[1].visualization_id; },
    (value) => { value.contents[0].available_data_row_count = -1; },
    (value) => { value.contents[0].sampling_ratio = 0; },
    (value) => { value.contents[0].record_size = 10; },
    (value) => { value.contents[0].error = 'private'; },
    (value) => { value.contents[0] = null; },
  ]) {
    const value = board();
    mutate(value);
    assert.deepEqual(evaluate(value), { passed: false, reason: 'visualization_schema' });
  }
  assert.equal(evaluate({ ...board(), metadata_id: 'wrong' }).reason, 'metadata_mismatch');
  assert.equal(evaluate({ ...board(), contents: [] }).reason, 'visualization_count');
  for (const [status, contentType, body, reason] of [
    [401, 'application/json', '{"private":"secret"}', 'authentication_or_permission'],
    [403, 'application/json', '{}', 'authentication_or_permission'],
    [429, 'application/json', '{}', 'rate_limited'],
    [500, 'application/json', '{}', 'http_status'],
    [302, 'text/html', '', 'http_status'],
    [0, '', '', 'transport'],
    [200, 'text/html', '<html>private</html>', 'content_type'],
    [200, 'application/json', '{private', 'invalid_json'],
    ...['null', '42', '"private"', '{}', '[]'].map((body) => [200, 'application/json', body, 'empty_json']),
    ...['[{}]', '{"error":"private"}', '[{"errors":[]}]', '{"error_code":123}']
      .map((body) => [200, 'application/json', body, 'invalid_envelope']),
  ]) assert.deepEqual(liveboardResponse(status, contentType, body), { passed: false, reason });
  assert.deepEqual(liveboardMeasurement({ ...sample, token: 'not-retained' }), sample);
  for (const value of [{ ...sample, durationMs: -1 }, { ...sample, status: 403 },
    { ...sample, reason: 'private' }, { ...sample, waitingMs: Infinity },
    { ...sample, contract: undefined },
    { ...sample, contract: { ...sample.contract, visualizationCount: 29 } },
    { ...sample, contract: { ...sample.contract, returnedRowCount: 1 } }]) {
    assert.throws(() => liveboardMeasurement(value), /withheld/);
  }
});

test('API reports distinguish empty contract success from populated-data performance', () => {
  const session = { runId: 'synthetic-run', startedAt: '2026-10-23T00:00:00Z' };
  const empty = liveboardMarkdown(session, sample, true);
  assert.match(empty, /Liveboard response contract: PASS/);
  assert.match(empty, /30\/30/);
  assert.match(empty, /WARNING: all visualizations returned zero rows/);
  assert.match(empty, /not a populated-data performance sample/);
  const populated = liveboardMarkdown(session, { ...sample, contract: {
    visualizationCount: 30, emptyVisualizationCount: 29, returnedRowCount: 2, availableRowCount: 5,
  } }, true);
  assert.doesNotMatch(populated, /WARNING/);
  assert.match(populated, /Returned rows \(summed across visualizations\): 2/);
  assert.match(liveboardMarkdown(session, undefined, false), /FAIL \/ INCOMPLETE/);
});

const burstRecord = (vu) => ({ ...sample, vu, startedAtMs: 1000 + vu, finishedAtMs: 1020 + vu });

test('burst summary measures overlap, not just configured VUs', () => {
  const records = Array.from({ length: 6 }, (_, index) => burstRecord(index + 1));
  assert.deepEqual(liveboardBurstSummary(records), {
    expectedRequests: 6, observedRequests: 6, passedRequests: 6, peakClientInFlight: 6,
    startSpreadMs: 5, requestWindowMs: 25, durationMinMs: 10, durationMeanMs: 10, durationMaxMs: 10,
  });
  const serial = records.map((record, index) => ({ ...record,
    startedAtMs: 1000 + index * 20, finishedAtMs: 1020 + index * 20 }));
  assert.equal(liveboardBurstSummary(serial).peakClientInFlight, 1);
  assert.equal(liveboardBurstSummary([]).durationMeanMs, null);
  assert.throws(() => liveboardBurstSummary([records[0], records[0]]), /Duplicate/);
  for (const value of [{ ...records[0], vu: 7 }, { ...records[0], startedAtMs: 0 },
    { ...records[0], elapsedMs: 1 }]) assert.throws(() => liveboardBurstMeasurement(value));
  const report = liveboardBurstMarkdown({ runId: 'fixture', startedAt: 'fixture' }, records, true);
  assert.match(report, /6\/6/);
  assert.match(report, /empty-result performance/);
  assert.match(report, /not six independent logins/);
  assert.match(liveboardBurstMarkdown({}, [], false), /FAIL \/ INCOMPLETE/);
});

test('burst runner requires six unique measurements and matching completion markers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'liveboard-burst-runner-'));
  try {
    for (const folder of ['scripts', 'lib']) mkdirSync(join(directory, folder));
    for (const file of ['scripts/run-liveboard-api.js', 'lib/liveboard-api.js']) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, '.env.api'),
      `TS_HOST=${valid.TS_HOST}\nLIVEBOARD_ID=${valid.LIVEBOARD_ID}\nTS_TOKEN=local-fake-token\n`,
      { mode: 0o600 });
    const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import(${JSON.stringify(new URL(`file://${join(directory, 'scripts/run-liveboard-api.js')}`).href)})`], {
      encoding: 'utf8', timeout: 15000, env: { PATH: directory, HOME: directory },
    });
    assert.notEqual(imported.status, 0);
    assert.match(imported.stderr, /API runner is executable-only/);
    assert.equal(existsSync(join(directory, 'results')), false);
    for (const mode of ['success', 'missing-vu', 'missing-completion', 'duplicate', 'duplicate-completion',
      'out-of-range', 'failed', 'exit-failure']) {
      writeFileSync(join(directory, 'k6'), `#!${process.execPath}
if (process.env.LIVEBOARD_PROFILE !== 'burst6' || process.env.K6_VUS || process.env.K6_OUT ||
    process.env.HTTPS_PROXY || process.env.UNRELATED_SECRET || process.env.TS_TOKEN !== 'local-fake-token' ||
    process.argv.join(' ').includes(process.env.TS_TOKEN)) process.exit(9);
console.error('local-fake-token private-response');
const mode = ${JSON.stringify(mode)};
const records = ${JSON.stringify(Array.from({ length: 6 }, (_, index) => burstRecord(index + 1)))};
const emit = (msg) => console.log(JSON.stringify({source:'console', msg}));
for (const record of records.reverse()) {
  if (mode === 'missing-vu' && record.vu === 1) continue;
  if (mode === 'out-of-range' && record.vu === 1) record.vu = 7;
  if (mode === 'failed' && record.vu === 1) Object.assign(record, {
    status: 429, passed:false, reason:'rate_limited' });
  emit('LIVEBOARD_API_RECORD ' + JSON.stringify({...record, secret:'private-response'}));
  if (record.passed && !(mode === 'missing-completion' && record.vu === 1))
    emit('LIVEBOARD_API_COMPLETE ' + record.vu);
}
if (mode === 'duplicate') emit('LIVEBOARD_API_RECORD ' + JSON.stringify(records[0]));
if (mode === 'duplicate-completion') emit('LIVEBOARD_API_COMPLETE 1');
if (mode === 'exit-failure') process.exit(1);
`);
      chmodSync(join(directory, 'k6'), 0o700);
      const previous = new Set(existsSync(join(directory, 'results')) ?
        readdirSync(join(directory, 'results')) : []);
      const result = spawnSync(process.execPath, [join(directory, 'scripts/run-liveboard-api.js'), '--burst-six'], {
        encoding: 'utf8', timeout: 15000, env: { PATH: directory, HOME: directory,
          K6_VUS: '100', K6_OUT: 'remote', HTTPS_PROXY: 'private', UNRELATED_SECRET: 'private',
          LIVEBOARD_PROFILE: 'unapproved-override' },
      });
      assert.equal(result.status === 0, mode === 'success', result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /local-fake-token|private-response/);
      for (const file of readdirSync(join(directory, 'results')).filter((file) => !previous.has(file))) {
        const path = join(directory, 'results', file);
        const text = readFileSync(path, 'utf8');
        assert.doesNotMatch(text, /local-fake-token|private-response|00000000-/);
        assert.equal(statSync(path).mode & 0o077, 0);
        if (file.endsWith('.json')) {
          const report = JSON.parse(text);
          assert.equal(report.session.users, 6);
          assert.equal(report.success, mode === 'success');
          assert.equal(report.measurements.length, mode === 'out-of-range' || mode === 'missing-vu' ? 5 : 6);
          if (mode === 'success') {
            assert.equal(report.summary.peakClientInFlight, 6);
            assert.equal(report.completedVus.length, 6);
          }
        } else assert.match(text, /six-user burst report/);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('API runner gates completion and protects output, environment and report permissions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'liveboard-runner-test-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'lib'));
    for (const file of ['scripts/run-liveboard-api.js', 'lib/liveboard-api.js']) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
    }
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, '.env.api'), `TS_HOST=${valid.TS_HOST}\nLIVEBOARD_ID=${valid.LIVEBOARD_ID}\nTS_TOKEN=overridden-file-token\n`,
      { mode: 0o600 });
    for (const mode of ['success', 'missing', 'duplicate', 'malformed', 'failed', 'exit-failure']) {
      writeFileSync(join(directory, 'k6'), `#!${process.execPath}
const mode = ${JSON.stringify(mode)};
if (process.env.TS_TOKEN !== 'local-fake-token' || process.env.K6_VUS ||
    process.env.K6_OUT || process.env.HTTPS_PROXY || process.env.UNRELATED_SECRET ||
    process.argv.join(' ').includes(process.env.TS_TOKEN) ||
    !process.argv.includes('--no-usage-report') ||
    !process.argv.includes('--config')) process.exit(7);
console.log('private-response local-fake-token');
console.error(JSON.stringify({level:'error', msg:'local-fake-token'}));
const emit = (msg) => console.log(JSON.stringify({source:'console',msg}));
if (mode !== 'missing') emit('LIVEBOARD_API_RECORD ' +
  (mode === 'malformed' ? '{"reason":"local-fake-token"}' : JSON.stringify(
    mode === 'failed' ? {...${JSON.stringify(sample)}, passed:false, status:403, reason:'authentication_or_permission'}
      : {...${JSON.stringify(sample)}, secret:'private-response'})));
if (mode === 'duplicate') emit('LIVEBOARD_API_RECORD ' + JSON.stringify(${JSON.stringify(sample)}));
if (mode !== 'missing' && mode !== 'failed') emit('LIVEBOARD_API_COMPLETE');
if (mode === 'exit-failure') process.exit(1);
`);
      chmodSync(join(directory, 'k6'), 0o700);
      const result = spawnSync(process.execPath, [join(directory, 'scripts/run-liveboard-api.js')], {
        encoding: 'utf8', timeout: 15000, env: {
          PATH: directory, HOME: directory, TS_TOKEN: valid.TS_TOKEN,
          K6_VUS: '100', K6_OUT: 'remote', HTTPS_PROXY: 'private', UNRELATED_SECRET: 'private',
        },
      });

      assert.equal(result.status === 0, mode === 'success', result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, /local-fake-token|private-response|overridden-file-token/);
    }
    writeFileSync(join(directory, '.env.api'),
      `TS_HOST=${valid.TS_HOST}\nLIVEBOARD_ID=${valid.LIVEBOARD_ID}\nTS_TOKEN=local-fake-token\n`,
      { mode: 0o600 });
    const previousReports = new Set(readdirSync(join(directory, 'results')));
    const fileToken = spawnSync(process.execPath, [join(directory, 'scripts/run-liveboard-api.js')],
      { encoding: 'utf8', timeout: 15000, env: { PATH: directory, HOME: directory } });
    // The final fake executable deliberately exits nonzero after valid evidence.
    assert.notEqual(fileToken.status, 0);
    assert.match(fileToken.stdout, /API report:/);
    assert.doesNotMatch(fileToken.stdout + fileToken.stderr, /local-fake-token/);
    const fileTokenReport = readdirSync(join(directory, 'results'))
      .find((file) => file.endsWith('.json') && !previousReports.has(file));
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'results', fileTokenReport), 'utf8')).measurement,
      sample);
    const blankOverride = spawnSync(process.execPath, [join(directory, 'scripts/run-liveboard-api.js')],
      { encoding: 'utf8', timeout: 15000, env: { PATH: directory, TS_TOKEN: '' } });
    assert.notEqual(blankOverride.status, 0);
    assert.match(blankOverride.stderr, /No request sent/);
    const files = readdirSync(join(directory, 'results'));
    assert.equal(files.length, 14);
    for (const file of files) {
      const path = join(directory, 'results', file);
      const text = readFileSync(path, 'utf8');
      assert.doesNotMatch(text, /local-fake-token|overridden-file-token|private-response|00000000-/);
      assert.equal(statSync(path).mode & 0o077, 0);
      if (file.endsWith('.md')) assert.match(text, /NOT verified/);
    }
    chmodSync(join(directory, '.env.api'), 0o644);
    const rejected = spawnSync(process.execPath, [join(directory, 'scripts/run-liveboard-api.js')],
      { encoding: 'utf8', env: { PATH: directory, TS_TOKEN: valid.TS_TOKEN } });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /No request sent/);
    assert.equal(readdirSync(join(directory, 'results')).length, 14);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
