import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { liveboardBurstMeasurement, liveboardBurstSummary, liveboardMeasurement, liveboardPath } from '../lib/liveboard-api.js';

test('real k6 sends exactly one POST, validates failures and does not follow redirects', { timeout: 120000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'liveboard-http-test-'));
  const config = join(directory, 'config.json');
  writeFileSync(config, '{}', { mode: 0o600 });
  let calls = [];
  let fixture;
  let active = 0;
  let peak = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    calls.push({ method: request.method, path: request.url, body,
      authorization: request.headers.authorization });
    const status = fixture.mixed && calls.length === 1 ? 429 : fixture.status;
    active += 1;
    peak = Math.max(peak, active);
    if (fixture.burst) await delay(500);
    response.writeHead(status, { 'Content-Type': fixture.type,
      ...(fixture.status === 302 ? { Location: '/must-not-follow' } : {}) });
    response.end(fixture.body);
    active -= 1;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const board = { metadata_id: '00000000-0000-0000-0000-000000000001',
    contents: Array.from({ length: 30 }, (_, index) => ({
      visualization_id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
      column_names: ['synthetic'], data_rows: [[]], record_offset: 0, record_size: 1000,
      returned_data_row_count: 0, available_data_row_count: 0, sampling_ratio: 1,
    })) };
  try {
    for (fixture of [
      { status: 200, type: 'application/json', body: JSON.stringify(board), passed: true },
      { status: 200, type: 'application/json', body: JSON.stringify({ ...board, contents: [] }) },
      { status: 200, type: 'application/json', body: JSON.stringify({ ...board, metadata_id: 'wrong' }) },
      { status: 200, type: 'application/json', body: '{"error":"private-response"}' },
      { status: 200, type: 'application/json', body: 'private-response' },
      { status: 200, type: 'text/html', body: '<html>private-response</html>' },
      { status: 401, type: 'application/json', body: '{"private":"private-response"}' },
      { status: 403, type: 'application/json', body: '{}' },
      { status: 429, type: 'application/json', body: '{}' },
      { status: 500, type: 'application/json', body: '{}' },
      { status: 302, type: 'text/html', body: '' },
      { status: 200, type: 'application/json', body: JSON.stringify(board), passed: true, burst: true },
      { status: 200, type: 'application/json', body: JSON.stringify(board), mixed: true, burst: true },
      { status: 401, type: 'application/json', body: '{}', burst: true },
    ]) {
      calls = [];
      active = 0;
      peak = 0;
      const child = spawn('k6', ['run', '--quiet', '--no-usage-report', '--config', config,
        '--log-format=json', '--log-output=stdout',
        fileURLToPath(new URL('./liveboard-api.js', import.meta.url))], {
        env: { PATH: process.env.PATH, HOME: directory, NO_COLOR: '1',
          LIVEBOARD_PROFILE: fixture.burst ? 'burst6' : 'single',
          TS_HOST: `http://127.0.0.1:${server.address().port}`, TS_TOKEN: 'fixture-token',
          LIVEBOARD_ID: '00000000-0000-0000-0000-000000000001' },
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL',
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const code = await new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
      });
      assert.equal(code === 0, fixture.passed === true, output);
      const expected = fixture.burst ? 6 : 1;
      assert.equal(calls.length, expected);
      assert.equal(calls[0].method, 'POST');
      assert.equal(calls[0].path, liveboardPath);
      assert.equal(calls[0].authorization, 'Bearer fixture-token');
      assert.deepEqual(JSON.parse(calls[0].body), {
        metadata_identifier: '00000000-0000-0000-0000-000000000001',
        data_format: 'COMPACT', record_offset: 0, record_size: 1000,
      });
      assert.doesNotMatch(output, /fixture-token|private-response/);
      const records = output.split('\n').flatMap((line) => {
        try {
          const entry = JSON.parse(line);
          return entry.source === 'console' && entry.msg?.startsWith('LIVEBOARD_API_RECORD ')
            ? [(fixture.burst ? liveboardBurstMeasurement : liveboardMeasurement)(
              JSON.parse(entry.msg.slice('LIVEBOARD_API_RECORD '.length)))] : [];
        } catch { return []; }
      });
      assert.equal(records.length, expected);
      assert.equal(records.filter((record) => record.passed).length,
        fixture.mixed ? 5 : fixture.passed ? expected : 0);
      if (fixture.burst) {
        assert.equal(peak, 6, 'loopback server must observe six overlapping requests');
        assert.equal(liveboardBurstSummary(records).peakClientInFlight, 6);
        assert.equal(new Set(records.map((record) => record.vu)).size, 6);
        assert.equal(new Set(calls.map((call) => call.authorization)).size, 1);
        assert.ok(calls.every((call) => call.body === calls[0].body &&
          call.path === liveboardPath && call.method === 'POST'));
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    unlinkSync(config);
    rmdirSync(directory);
  }
});
