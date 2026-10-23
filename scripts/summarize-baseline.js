import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { baselineSummary } from '../lib/baseline-report.js';

if (process.argv.length !== 5) {
  console.error('Usage: npm run dashboard:baseline-report -- <run1.jsonl> <run2.jsonl> <run3.jsonl>');
  process.exit(1);
}
try {
  const paths = process.argv.slice(2);
  const tabs = JSON.parse(readFileSync(new URL('../reference/dashboard-ui-inventory.json', import.meta.url), 'utf8')).tabs;
  const runs = paths.map((path) => readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse));
  const report = baselineSummary(runs, tabs);
  const version = execFileSync('k6', ['version'], { encoding: 'utf8', timeout: 10000 });
  const match = version.match(/^k6 v(\d+\.\d+\.\d+)\b/);
  if (!match) throw new Error('Unrecognized k6 version.');
  const output = new URL(`../results/baseline-${randomUUID()}.json`, import.meta.url);
  writeFileSync(output, JSON.stringify({
    ...report, generatedAt: new Date().toISOString(),
    installedK6VersionAtSummary: match[1], sourceReports: paths,
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Baseline report: ${fileURLToPath(output)}`);
  console.log(`Measured action total median: ${(report.measuredActionTotals.medianMs / 1000).toFixed(2)}s`);
  for (const tab of report.tabs) {
    console.log(`${tab.name}: tab-switch median ${(tab.tabSwitch.medianMs / 1000).toFixed(2)}s`);
  }
} catch {
  console.error('Cannot validate or save the baseline. Check three successful sequential reports, matching runtime/configuration and action checkpoints. Raw input withheld.');
  process.exitCode = 1;
}
