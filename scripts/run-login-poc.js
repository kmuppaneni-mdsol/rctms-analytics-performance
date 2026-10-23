import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';
import { arch, cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { loginCredentials } from '../lib/local-credentials.js';
import { discoveryCheckpoint } from '../lib/discovery-report.js';
import { journeyRecord, journeySummary } from '../lib/journey-report.js';
import { journeyPlan } from '../lib/journey-plan.js';
import { filterRecord, filterSummary } from '../lib/filter-report.js';
import { experienceReport } from '../lib/experience-report.js';

const args = process.argv.slice(2);
if (args.some((arg) => !['--manual-mfa', '--inspect-dashboard', '--check-widget', '--discover', '--journey', '--open-journey', '--filter', '--filter-inspect', '--experience'].includes(arg)) ||
    new Set(args).size !== args.length ||
    args.filter((arg) => ['--inspect-dashboard', '--check-widget', '--discover', '--journey', '--open-journey', '--filter', '--filter-inspect', '--experience'].includes(arg)).length > 1) {
  console.error('Usage: node scripts/run-login-poc.js [--manual-mfa] [--inspect-dashboard | --check-widget | --discover | --journey | --open-journey | --filter | --filter-inspect | --experience]');
  process.exit(1);
}
const manualMfa = args.includes('--manual-mfa');
const inspectDashboard = args.includes('--inspect-dashboard');
const checkWidget = args.includes('--check-widget');
const discoverJourney = args.includes('--discover');
const experience = args.includes('--experience');
const openJourney = args.includes('--open-journey') || experience;
const timedJourney = args.includes('--journey') || openJourney;
const inspectFilter = args.includes('--filter-inspect');
const filterTest = args.includes('--filter') || inspectFilter || experience;
const measuredMode = timedJourney || filterTest;
const journeyTabs = measuredMode ? JSON.parse(
  readFileSync(new URL('../reference/dashboard-ui-inventory.json', import.meta.url), 'utf8')
).tabs : [];
const openWidgetIndices = openJourney ? journeyPlan({ tabs: journeyTabs })[0].initialWidgets
  .map((title) => journeyTabs[0].widgets.indexOf(title)) : [];

if (typeof util.parseEnv !== 'function') {
  console.error('The local .env login runner requires Node.js 22.3+.');
  process.exit(1);
}

const envFile = new URL('../.env', import.meta.url);
let credentials;
try {
  if (process.platform !== 'win32' && (statSync(envFile).mode & 0o077) !== 0) {
    throw new Error('Restrict .env permissions to your user with chmod 600 .env.');
  }
  credentials = loginCredentials(util.parseEnv(readFileSync(envFile, 'utf8')));
} catch (error) {
  if (error.code === 'ENOENT') {
    console.error('Create the local .env file with ANALYTICS_USERNAME and ANALYTICS_PASSWORD.');
  } else if (error.code) {
    console.error('Cannot read the local credential file. Check its permissions.');
  } else {
    console.error('Cannot load credentials. Verify .env permissions (chmod 600 .env), syntax, and non-empty ANALYTICS_USERNAME and ANALYTICS_PASSWORD fields.');
  }
  process.exit(1);
}

let filterTarget;
if (filterTest) {
  const targetFile = new URL('../.env.filter', import.meta.url);
  try {
    if (process.platform !== 'win32' && (statSync(targetFile).mode & 0o077) !== 0) {
      throw new Error('Filter configuration permissions are too broad.');
    }
    const values = util.parseEnv(readFileSync(targetFile, 'utf8'));
    if (typeof values.ANALYTICS_STUDY_GROUP !== 'string' || !values.ANALYTICS_STUDY_GROUP.trim()) {
      throw new Error('Filter target is missing.');
    }
    filterTarget = values.ANALYTICS_STUDY_GROUP.replace(/\s+/g, ' ').trim();
  } catch {
    console.error('Set ANALYTICS_STUDY_GROUP to the exact option name in local .env.filter (chmod 600). No login was attempted; raw details withheld.');
    process.exit(1);
  }
}

// Do not inherit k6 overrides, debugging, or remote output settings.
const env = { ...credentials, K6_BROWSER_HEADLESS: 'false', NO_COLOR: '1' };
if (manualMfa) env.ANALYTICS_MANUAL_MFA = 'true';
if (inspectDashboard) env.ANALYTICS_INSPECT_DASHBOARD = 'true';
if (checkWidget) env.ANALYTICS_CHECK_WIDGET = 'true';
if (discoverJourney) env.ANALYTICS_GUIDED_DISCOVERY = 'true';
if (timedJourney) env.ANALYTICS_TIMED_JOURNEY = 'true';
if (openJourney) env.ANALYTICS_OPEN_JOURNEY = 'true';
if (filterTest) env.ANALYTICS_FILTER_TEST = 'true';
if (filterTest) env.ANALYTICS_STUDY_GROUP = filterTarget;
if (inspectFilter) env.ANALYTICS_INSPECT_FILTER = 'true';
for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'DISPLAY', 'XAUTHORITY']) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
const messages = {
  filter_started: 'Starting guarded Study Group apply/reset. Leave the browser untouched.',
  filter_complete: 'Study Group apply/reset passed UI lifecycle, widget readiness and selection-restoration checks.',
  filter_apply_failed: 'Study Group apply failed; attempting isolated restoration, not a global reset.',
  filter_reset_failed: 'Study Group restoration could not be verified. Do not treat the run as successful.',
  filter_structure_unavailable: 'Filtered-widget structural inspection failed; raw details withheld. Restoration will still be attempted.',
  filter_inspection_paused: 'Automated Apply has failed. Inspect the widgets now without changing controls; use Continue and restore original selection when done. Restoration resumes automatically in 3 minutes. This pause is not timed.',
  filter_inspection_continued: 'Visual inspection finished; resuming isolated restoration.',
  filter_inspection_expired: 'Visual inspection reached its time limit; resuming isolated restoration. No observation is inferred.',
  filter_inspection_failed: 'Visual inspection could not complete; attempting isolated restoration. Raw details withheld.',
  running_filter_failed: 'Filter test failed. Sanitized partial records are preserved; no fresh-backend-data claim.',
  journey_started: 'Starting timed read-only dashboard journey. Do not scroll or click while automation is running.',
  journey_complete: 'All expected widgets were verified across the tab/scroll journey.',
  journey_widget_error_or_no_data: 'A visible widget reports an error or no data; this rendered-data journey stops explicitly.',
  journey_coverage_incomplete: 'The traversal did not verify all expected widgets; the journey failed.',
  running_journey_failed: 'The timed journey failed; partial measurements are preserved, not treated as success.',
  discovery_ready: 'Discovery panel ready in the browser. Capture Initial viewport before scrolling; then capture each scroll checkpoint and tab. Finish closes the session. Limit: 15 minutes / 60 captures.',
  discovery_complete: 'Guided discovery finished. Captures describe observed states, not performance or full-coverage assertions.',
  discovering_journey_failed: 'Guided discovery failed or expired. Any saved checkpoints are partial; no full-dashboard readiness is claimed.',
  dashboard_probe_started: 'Inspecting the ThoughtSpot iframe in this same single-user session.',
  dashboard_frame_reattaching: 'Iframe navigated; reattaching without repeating login.',
  dashboard_title_observed: 'Expected widget title observed; checking rendering structure.',
  dashboard_probe_complete: 'Dashboard structure probe completed; rendered readiness is not yet asserted.',
  probing_dashboard_failed: 'Dashboard inspection failed. No widget readiness is claimed.',
  widget_rendered: 'Expected widget has visible rendered chart points and no visible loading or error signal.',
  widget_error: 'The widget has a visible error signal; the rendered-data check failed.',
  widget_no_data: 'The widget reports no data. This proof of concept requires rendered data, so it failed explicitly.',
  widget_render_timeout: 'Timed out waiting for rendered chart points with loading indicators cleared.',
  checking_widget_failed: 'The rendered-widget check failed. No dashboard readiness is claimed.',
  manual_mfa_window: 'Assisted MFA: enter the current Okta Verify code and click Submit in the browser if prompted. Navigation timeout: 3 minutes. Do not send the code here.',
  credentials_submitted: 'Submitted the credentials once through the normal login form.',
  analytics_route_confirmed: 'Reached the Analytics route; widget readiness has not been tested.',
  opening_login_failed: 'Could not open the expected login form. No credential submission was attempted.',
  validating_form_failed: 'Login origin or form did not match. No credential submission was attempted.',
  filling_form_failed: 'Could not safely fill the expected login form. Submission stopped.',
  submitting_login_failed: 'Login submission was not confirmed. No retry will be made.',
  waiting_for_analytics_failed: 'Analytics navigation was not confirmed; the cause is undetermined. No retry will be made.',
};

let reportFile;
let session;
if (discoverJourney || measuredMode) {
  try {
    let k6Version;
    if (measuredMode) {
      const probe = spawnSync('k6', ['version'], {
        env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000,
      });
      const match = probe.stdout?.match(/^k6 v(\d+\.\d+\.\d+)\b/);
      if (probe.error || probe.status !== 0 || !match) throw new Error('k6 version unavailable.');
      k6Version = match[1];
    }
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true, mode: 0o700 });
    reportFile = new URL(`../results/${experience ? 'experience' : filterTest ? 'filter' : timedJourney ? 'journey' : 'discovery'}-${randomUUID()}.jsonl`, import.meta.url);
    session = {
      type: 'session', startedAt: new Date().toISOString(),
      mode: experience ? 'single-user-experience' : filterTest ? 'study-group-apply-reset' : openJourney ? 'authenticated-reload-and-journey' : timedJourney ? 'timed-read-only-journey' : 'guided-discovery',
      performanceMeasured: measuredMode,
      ...(filterTest ? { visualInspectionEnabled: inspectFilter, selectionPolicy: 'unique-case-insensitive-local-name' } : {}),
      ...(measuredMode ? {
        viewport: { width: 1280, height: 720 }, users: 1, iterations: 1,
        tabs: journeyTabs,
        scope: experience ?
          'Authenticated reload, four-tab main-scroll traversal, then one Study Group apply/reset in one session. No drill-downs, nested scrolling, exports, cold-cache or backend freshness claim.' : filterTest ?
          'One Study Group option apply/reset; six initial widgets; UI loading/render lifecycle and persisted selection, not backend freshness. No global reset, save or export.' : openJourney ?
          'Authenticated dashboard reload to first-viewport readiness, followed by separate warm tab/scroll actions; no cold-cache, offscreen-open readiness, filters or exports.' :
          'Warm tab switches and 80%-viewport main-scroll checkpoints; no initial page-load, filters, nested scrolling, or exports.',
        clock: experience ?
          'Reload/journey: host timeOrigin + performance.now(); filter: host performance.now(); durations only, no cross-clock subtraction. Login/MFA and setup excluded.' : openJourney ?
          'Host document performance.timeOrigin + performance.now(); authentication and manual MFA excluded.' :
          'Host document performance.now(); authentication and manual MFA excluded.',
        readinessTimeoutMs: 60000, pollIntervalMs: 200,
        ...(experience ? { filterPollIntervalMs: 100 } : {}),
        cacheState: 'Uncontrolled; tabs may be cached.',
        runner: {
          node: process.version, k6Version, platform: platform(), architecture: arch(), osRelease: release(),
          logicalCpus: cpus().length, totalMemoryBytes: totalmem(),
          freeMemoryBytes: freemem(), loadAverage: loadavg(),
        },
      } : {}),
    };
    writeFileSync(reportFile, JSON.stringify(session) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(`Local ${filterTest ? 'filter' : timedJourney ? 'journey' : 'discovery'} report: ${fileURLToPath(reportFile)}`);
  } catch {
    console.error('Cannot create the local report. No browser run started.');
    process.exit(1);
  }
}

const child = spawn('k6', [
  'run', '--quiet', '--log-format=json', '--log-output=stdout',
  fileURLToPath(new URL('./login-poc.js', import.meta.url)),
], { env, stdio: ['ignore', 'pipe', 'pipe'] });

let routeConfirmed = false;
let dashboardProbed = false;
let widgetRendered = false;
let discoveryCompleted = false;
let checkpointCount = 0;
let reportFailed = false;
let journeyCompleted = false;
let journeyBrowserObserved = false;
let filterCompleted = false;
const filterRecords = [];
const journeyRecords = [];
function reportFailure() {
  reportFailed = true;
  console.error('Cannot validate or persist measurement output; stopping this run. Raw content withheld.');
  child.kill('SIGTERM');
}
for (const stream of [child.stdout, child.stderr]) {
  const lines = createInterface({ input: stream });
  lines.on('line', (line) => {
    // Only emit predefined status messages, never browser logs or raw errors.
    if (!line.startsWith('{')) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (record.source !== 'console' || typeof record.msg !== 'string') return;
    if (measuredMode && record.msg.startsWith('JOURNEY_BROWSER ')) {
      try {
        const value = JSON.parse(record.msg.slice('JOURNEY_BROWSER '.length));
        if (journeyBrowserObserved || !/^\d+\.\d+\.\d+\.\d+$/.test(value.version) ||
            !Number.isFinite(value.devicePixelRatio) || value.devicePixelRatio <= 0 ||
            value.devicePixelRatio > 10) throw new Error('Invalid browser metadata.');
        appendFileSync(reportFile, JSON.stringify({
          type: 'browser', engine: 'chromium', version: value.version,
          devicePixelRatio: value.devicePixelRatio,
        }) + '\n');
        journeyBrowserObserved = true;
      } catch {
        reportFailure();
      }
      return;
    }
    if (filterTest && record.msg.startsWith('FILTER_RECORD ')) {
      try {
        const measurement = filterRecord(JSON.parse(record.msg.slice('FILTER_RECORD '.length)));
        if (measurement.sequence !== filterRecords.length + 1) throw new Error('Unexpected filter sequence.');
        appendFileSync(reportFile, JSON.stringify({ type: 'measurement', ...measurement }) + '\n');
        filterRecords.push(measurement);
        console.log(`${measurement.action}: ${measurement.status}, ${measurement.durationMs.toFixed(0)} ms` +
          (measurement.stage ? ` (${measurement.stage}; guard: ${measurement.guardReason})` : ''));
        if (measurement.optionComparison) {
          console.log(`Option identity comparison (diagnostic only): ${JSON.stringify(measurement.optionComparison)}`);
        }
        if (measurement.refresh) {
          const { applicationObserved, popupClosed, readiness } = measurement.refresh;
          console.log(`Last refresh observation: application=${applicationObserved}, popupClosed=${popupClosed}, ` +
            `scrollTop=${readiness.scrollTop}, selectedTabs=${readiness.selectedTabCount}, ` +
            `expectedTabSelected=${readiness.expectedTabSelected}, visibleWidgets=${readiness.visibleWidgetCount}, ` +
            `unexpectedWidgets=${readiness.unexpectedWidgetCount}; expected widget positions: ` +
            readiness.widgets.map((widget) => `${widget.widgetIndex + 1}:${widget.state}(${widget.matches})`).join(', '));
        }
        if (measurement.structureInspection) {
          const inspection = measurement.structureInspection;
          console.log(`Filtered-widget structural inspection: ${inspection.status}.` +
            (inspection.status === 'captured' ? ' ' + inspection.widgets.map((widget) => {
              const structure = widget.structure;
              return `${widget.widgetIndex + 1}: ` + (structure ?
                `scanned=${structure.scanned}, visible=${structure.visibleCount}, ` +
                `scanTruncated=${structure.scanTruncated}, visible markers=${JSON.stringify(structure.counts)}` :
                `matches=${widget.matches}, no unique tile`);
            }).join('; ') : ''));
        }
      } catch {
        reportFailure();
      }
      return;
    }
    if (timedJourney && record.msg.startsWith('JOURNEY_RECORD ')) {
      try {
        const measurement = journeyRecord(JSON.parse(record.msg.slice('JOURNEY_RECORD '.length)), journeyTabs);
        if (measurement.sequence !== journeyRecords.length + 1) throw new Error('Unexpected sequence.');
        appendFileSync(reportFile, JSON.stringify({ type: 'measurement', ...measurement }) + '\n');
        journeyRecords.push(measurement);
        console.log(`Tab ${measurement.tabIndex + 1}, ${measurement.action} ${measurement.checkpoint}: ` +
          `${measurement.status}, ${measurement.durationMs.toFixed(0)} ms`);
      } catch {
        reportFailure();
      }
      return;
    }
    if (discoverJourney && record.msg.startsWith('DISCOVERY_CHECKPOINT ')) {
      try {
        const checkpoint = discoveryCheckpoint(JSON.parse(record.msg.slice('DISCOVERY_CHECKPOINT '.length)));
        if (checkpoint.sequence !== checkpointCount + 1 || checkpointCount >= 60) {
          throw new Error('Unexpected checkpoint sequence.');
        }
        appendFileSync(reportFile, JSON.stringify({ type: 'checkpoint', ...checkpoint }) + '\n');
        checkpointCount += 1;
        console.log(`Saved checkpoint ${checkpointCount} (${checkpoint.step}): ${checkpoint.widgets.length} widget containers observed.`);
      } catch {
        reportFailure();
      }
      return;
    }
    if (inspectDashboard && record.msg.startsWith('DASHBOARD_PROBE ')) {
      let probe;
      try {
        probe = JSON.parse(record.msg.slice('DASHBOARD_PROBE '.length));
      } catch {
        console.error('Dashboard probe returned invalid diagnostic output.');
        return;
      }
      if (!Array.isArray(probe.nodes) || probe.nodes.length > 100) return;
      console.log('Widget structure (no text or data values):');
      for (const node of probe.nodes) {
        const tokens = [node.tag, node.role, node.testid, ...(Array.isArray(node.classes) ? node.classes : [])]
          .filter((value) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(value));
        console.log(`${node.visible === true ? 'visible' : 'hidden'} ${tokens.join(' ')}`);
      }
      return;
    }
    if (!record.msg.startsWith('LOGIN_POC_STATUS ')) return;
    const status = record.msg.slice('LOGIN_POC_STATUS '.length);
    if (!Object.hasOwn(messages, status)) return;
    console.log(messages[status]);
    if (status === 'analytics_route_confirmed') routeConfirmed = true;
    if (status === 'dashboard_probe_complete') dashboardProbed = true;
    if (status === 'widget_rendered') widgetRendered = true;
    if (status === 'discovery_complete') discoveryCompleted = true;
    if (status === 'journey_complete') journeyCompleted = true;
    if (status === 'filter_complete') filterCompleted = true;
  });
}
child.on('error', () => {
  console.error('Could not start k6. Check that it is installed and executable.');
  process.exitCode = 1;
});
child.on('close', (code) => {
  const summary = timedJourney ? journeySummary(journeyRecords, journeyTabs) : null;
  const success = code === 0 && routeConfirmed && (!inspectDashboard || dashboardProbed) &&
    (!checkWidget || widgetRendered) && (!discoverJourney || (discoveryCompleted && checkpointCount > 0)) &&
    (!timedJourney || (journeyCompleted && summary.complete &&
      (!openJourney || journeyRecords.filter((record) => record.action === 'dashboard_open' &&
        record.status === 'passed' && record.scroll.top === 0 &&
        openWidgetIndices.every((index) => record.widgets.some((widget) =>
          widget.widgetIndex === index))).length === 1))) &&
    (!filterTest || (filterCompleted && journeyBrowserObserved && filterSummary(filterRecords).complete)) &&
    !reportFailed;
  if (reportFile) {
    try {
      const outcome = {
        type: 'outcome', finishedAt: new Date().toISOString(), success,
        ...(experience ? { summary: {
          complete: success, journey: summary, filter: filterSummary(filterRecords),
        } } : filterTest ? { summary: filterSummary(filterRecords) } : timedJourney ? { summary } : { checkpointCount }),
      };
      appendFileSync(reportFile, JSON.stringify(outcome) + '\n');
      if (experience) {
        const readable = new URL(reportFile.href.replace(/\.jsonl$/, '.md'));
        writeFileSync(readable, experienceReport(session, journeyRecords, filterRecords, outcome),
          { flag: 'wx', mode: 0o600 });
        console.log(`Single-user experience report: ${fileURLToPath(readable)}`);
      }
    } catch {
      console.error('Could not persist the run outcome. Report is incomplete.');
      process.exitCode = 1;
    }
    if (summary) {
      for (const tab of summary.coverage) {
        console.log(`Tab ${tab.tabIndex + 1} coverage: ${tab.verified}/${tab.expected} widgets verified.`);
      }
    }
  }
  if (!success) {
    console.error('Single-user login proof of concept failed. No credentials or session state were saved in results.');
    process.exitCode = 1;
  }
});
