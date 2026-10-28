import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { liveboardBurstMarkdown, liveboardBurstMeasurement, liveboardBurstSummary,
  liveboardConfig, liveboardMarkdown, liveboardMeasurement } from '../lib/liveboard-api.js';

if (!process.argv[1] || !existsSync(process.argv[1]) ||
    realpathSync(process.argv[1]) !== realpathSync(fileURLToPath(import.meta.url))) {
  throw new Error('API runner is executable-only; import reporting helpers from lib/liveboard-api.js.');
}

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--burst-six')) {
  console.error('Usage: npm run api:liveboard or npm run api:liveboard:burst (no credentials or load overrides).');
  process.exit(1);
}
const burst = args[0] === '--burst-six';
const users = burst ? 6 : 1;
let config;
try {
  const file = new URL('../.env.api', import.meta.url);
  if (process.platform !== 'win32' && (statSync(file).mode & 0o077)) throw new Error('Permissions');
  const values = parseEnv(readFileSync(file, 'utf8'));
  config = liveboardConfig({
    TS_HOST: values.TS_HOST, LIVEBOARD_ID: values.LIVEBOARD_ID,
    TS_TOKEN: process.env.TS_TOKEN ?? values.TS_TOKEN,
  });
} catch {
  console.error('API preflight failed. Set verified TS_HOST and LIVEBOARD_ID in owner-only .env.api (chmod 600), and provide TS_TOKEN there or through the process environment. No request sent; values withheld.');
  process.exit(1);
}
const runId = randomUUID();
const session = { runId, startedAt: new Date().toISOString(),
  mode: burst ? 'liveboard-rest-burst-six' : 'liveboard-rest-smoke',
  users, iterations: users, iterationsPerUser: 1, sharedIdentity: true,
  responseContract: 'instance-column-arrays-30',
  serverTelemetryAvailable: false,
  runner: { node: process.version, platform: process.platform, architecture: process.arch } };
const report = new URL(`../results/api-${runId}.json`, import.meta.url);
const markdown = new URL(`../results/api-${runId}.md`, import.meta.url);
let configDirectory;
let k6Config;
try {
  configDirectory = mkdtempSync(join(tmpdir(), 'liveboard-k6-'));
  k6Config = join(configDirectory, 'config.json');
  writeFileSync(k6Config, '{}', { flag: 'wx', mode: 0o600 });
  mkdirSync(new URL('../results/', import.meta.url), { recursive: true, mode: 0o700 });
  writeFileSync(report, JSON.stringify({ session, outcome: 'incomplete' }, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 });
} catch {
  try {
    if (k6Config && existsSync(k6Config)) unlinkSync(k6Config);
    if (configDirectory) rmdirSync(configDirectory);
  } catch {
    console.error('Could not clean up temporary API runtime configuration.');
  }
  console.error('Cannot create API report. No request sent.');
  process.exit(1);
}
const env = { ...config, NO_COLOR: '1', LIVEBOARD_PROFILE: burst ? 'burst6' : 'single' };
for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot']) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
console.log(`Starting ${users} Liveboard REST request(s), one per VU. No retries, browser login or load ramp.`);
const child = spawn('k6', ['run', '--quiet', '--no-usage-report', '--config', k6Config,
  '--log-format=json', '--log-output=stdout',
  fileURLToPath(new URL('./liveboard-api.js', import.meta.url))],
{ env, stdio: ['ignore', 'pipe', 'pipe'] });
let measurement;
let complete = false;
const measurements = new Map();
const completions = new Set();
const evidence = () => burst ? {
  measurements: [...measurements.values()].sort((a, b) => a.vu - b.vu),
  completedVus: [...completions].sort((a, b) => a - b),
} : (measurement ? { measurement } : {});
let invalid = false;
const watchdog = setTimeout(() => {
  invalid = true;
  console.error('API runner exceeded its bounded execution window; stopping without retry.');
  child.kill('SIGKILL');
}, 120000);
for (const stream of [child.stdout, child.stderr]) {
  const lines = createInterface({ input: stream });
  lines.on('line', (line) => {
    let entry;
    try { entry = JSON.parse(line); } catch { return; }
    if (entry.source !== 'console' || typeof entry.msg !== 'string') return;
    try {
      if (entry.msg.startsWith('LIVEBOARD_API_RECORD ')) {
        const raw = JSON.parse(entry.msg.slice('LIVEBOARD_API_RECORD '.length));
        if (burst) {
          const record = liveboardBurstMeasurement(raw);
          if (measurements.has(record.vu)) throw new Error('Duplicate measurement');
          measurements.set(record.vu, record);
        } else {
          if (measurement) throw new Error('Duplicate measurement');
          measurement = liveboardMeasurement(raw);
        }
        writeFileSync(report, JSON.stringify({ session, ...evidence(), outcome: 'incomplete' }, null, 2) + '\n',
          { mode: 0o600 });
      } else if (entry.msg.startsWith('LIVEBOARD_API_COMPLETE')) {
        if (burst) {
          if (!/^LIVEBOARD_API_COMPLETE [1-6]$/.test(entry.msg)) throw new Error('Invalid completion');
          const vu = Number(entry.msg.slice('LIVEBOARD_API_COMPLETE '.length));
          if (completions.has(vu) || !measurements.get(vu)?.passed) throw new Error('Invalid completion');
          completions.add(vu);
        } else {
          if (entry.msg !== 'LIVEBOARD_API_COMPLETE' || complete || !measurement?.passed) {
            throw new Error('Invalid completion');
          }
          complete = true;
        }
      }
    } catch {
      invalid = true;
      console.error('Invalid or unpersisted API evidence; stopping. Raw output withheld.');
      child.kill('SIGTERM');
    }
  });
}
child.on('error', () => {
  invalid = true;
  console.error('Could not start k6; check installation. No raw details retained.');
});
child.on('close', (code) => {
  clearTimeout(watchdog);
  try {
    unlinkSync(k6Config);
    rmdirSync(configDirectory);
  } catch {
    invalid = true;
    console.error('Could not clean up temporary API runtime configuration.');
  }
  const coverage = burst ? measurements.size === users && completions.size === users &&
    [...measurements.values()].every((record) => record.passed) : complete && measurement?.passed === true;
  const success = code === 0 && !invalid && coverage;
  try {
    writeFileSync(report, JSON.stringify({ session, ...evidence(),
      ...(burst ? { summary: liveboardBurstSummary([...measurements.values()]) } : {}),
      finishedAt: new Date().toISOString(), outcome: success ? 'liveboard-contract-passed' : 'failed',
      success }, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(markdown, burst ? liveboardBurstMarkdown(session, [...measurements.values()], success) :
      liveboardMarkdown(session, measurement, success), { flag: 'wx', mode: 0o600 });
    console.log(`API report: ${fileURLToPath(markdown)}`);
  } catch {
    console.error('Could not finalize API reports; run is incomplete.');
    process.exitCode = 1;
  }
  if (!success) {
    console.error('API smoke failed or incomplete. No automatic retry. Inspect sanitized report.');
    process.exitCode = 1;
  } else console.log('Liveboard response contract passed. Check report for empty-data and scope limitations.');
});
