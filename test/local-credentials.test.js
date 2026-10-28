import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as util from 'node:util';
import { loginCredentials } from '../lib/local-credentials.js';

test('only selects the two required credentials and preserves special characters', () => {
  assert.deepEqual(loginCredentials({
    ANALYTICS_USERNAME: 'test@example.invalid',
    ANALYTICS_PASSWORD: ' example $ # " \' \\ password ',
    K6_VUS: '100',
    OTHER_SECRET: 'unused',
  }), {
    ANALYTICS_USERNAME: 'test@example.invalid',
    ANALYTICS_PASSWORD: ' example $ # " \' \\ password ',
  });
});

test('rejects missing and blank credentials without disclosing provided values', () => {
  for (const invalid of [undefined, '', '   ']) {
    assert.throws(() => loginCredentials({
      ANALYTICS_USERNAME: invalid,
      ANALYTICS_PASSWORD: 'not-for-output',
    }), { message: 'Set a non-empty ANALYTICS_USERNAME in the local .env file.' });
    assert.throws(() => loginCredentials({
      ANALYTICS_USERNAME: 'not-for-output',
      ANALYTICS_PASSWORD: invalid,
    }), { message: 'Set a non-empty ANALYTICS_PASSWORD in the local .env file.' });
  }
});

test('runner filters secrets, drops k6 overrides, and requires confirmed navigation', {
  skip: typeof util.parseEnv !== 'function',
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'analytics-login-test-'));
  try {
    mkdirSync(join(directory, 'scripts'));
    mkdirSync(join(directory, 'lib'));
    copyFileSync(new URL('../scripts/run-login-poc.js', import.meta.url), join(directory, 'scripts/run-login-poc.js'));
    copyFileSync(new URL('../lib/local-credentials.js', import.meta.url), join(directory, 'lib/local-credentials.js'));
    copyFileSync(new URL('../lib/discovery-report.js', import.meta.url), join(directory, 'lib/discovery-report.js'));
    copyFileSync(new URL('../lib/journey-report.js', import.meta.url), join(directory, 'lib/journey-report.js'));
    copyFileSync(new URL('../lib/journey-plan.js', import.meta.url), join(directory, 'lib/journey-plan.js'));
    copyFileSync(new URL('../lib/filter-report.js', import.meta.url), join(directory, 'lib/filter-report.js'));
    copyFileSync(new URL('../lib/experience-report.js', import.meta.url), join(directory, 'lib/experience-report.js'));
    copyFileSync(new URL('../lib/experience-api.js', import.meta.url), join(directory, 'lib/experience-api.js'));
    mkdirSync(join(directory, 'reference'));
    copyFileSync(new URL('../reference/dashboard-ui-inventory.json', import.meta.url), join(directory, 'reference/dashboard-ui-inventory.json'));
    writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
    writeFileSync(join(directory, '.env'),
      'ANALYTICS_USERNAME=test@example.invalid\nANALYTICS_PASSWORD="fake $ # password"\n',
      { mode: 0o600 });
    writeFileSync(join(directory, '.env.filter'),
      'ANALYTICS_STUDY_GROUP="fake selected group"\nOTHER_SECRET=unused\n', { mode: 0o600 });
    const executable = join(directory, 'k6');
    for (const {
      confirmRoute, manualMfa, inspectDashboard = false, confirmProbe = false,
      checkWidget = false, confirmWidget = false,
      discoverJourney = false, confirmDiscovery = false,
      timedJourney = false, confirmJourney = false, completeCoverage = false,
      openJourney = false, confirmOpen = false,
      filterTest = false, confirmFilter = false, filterEvidence = false, filterFailure = false,
      inspectFilter = false,
      experience = false,
    } of [
      { confirmRoute: false, manualMfa: false },
      { confirmRoute: true, manualMfa: false },
      { confirmRoute: false, manualMfa: true },
      { confirmRoute: true, manualMfa: true },
      { confirmRoute: true, manualMfa: true, inspectDashboard: true, confirmProbe: false },
      { confirmRoute: true, manualMfa: true, inspectDashboard: true, confirmProbe: true },
      { confirmRoute: true, manualMfa: true, checkWidget: true, confirmWidget: false },
      { confirmRoute: true, manualMfa: true, checkWidget: true, confirmWidget: true },
      { confirmRoute: true, manualMfa: true, discoverJourney: true, confirmDiscovery: false },
      { confirmRoute: true, manualMfa: true, discoverJourney: true, confirmDiscovery: true },
      { confirmRoute: true, manualMfa: true, timedJourney: true },
      { confirmRoute: true, manualMfa: true, timedJourney: true, confirmJourney: true },
      { confirmRoute: true, manualMfa: true, timedJourney: true, confirmJourney: true, completeCoverage: true },
      { confirmRoute: true, manualMfa: true, timedJourney: true, openJourney: true, confirmJourney: true, completeCoverage: true },
      { confirmRoute: true, manualMfa: true, timedJourney: true, openJourney: true, confirmOpen: true, confirmJourney: true, completeCoverage: true },
      { confirmRoute: true, manualMfa: true, filterTest: true },
      { confirmRoute: true, manualMfa: true, filterTest: true, confirmFilter: true },
      { confirmRoute: true, manualMfa: true, filterTest: true, confirmFilter: true, filterEvidence: true },
      { confirmRoute: true, manualMfa: true, filterTest: true, confirmFilter: true, filterEvidence: true, filterFailure: true },
      { confirmRoute: true, manualMfa: true, filterTest: true, inspectFilter: true, confirmFilter: true, filterEvidence: true, filterFailure: true },
      ...[
        { confirmJourney: true, completeCoverage: true, confirmOpen: true, confirmFilter: true, filterEvidence: true },
        { confirmJourney: true, completeCoverage: true, confirmOpen: true, confirmFilter: true, filterEvidence: true, filterFailure: true },
        { confirmJourney: true, completeCoverage: true, confirmFilter: true, filterEvidence: true },
        { confirmJourney: true, completeCoverage: true, confirmOpen: true, confirmFilter: true },
      ].map((value) => ({ confirmRoute: true, manualMfa: true, timedJourney: true,
        openJourney: true, filterTest: true, experience: true, ...value })),
    ]) {
      writeFileSync(executable, `#!${process.execPath}
if (process.argv.includes('version')) { console.log('k6 v2.3.0'); process.exit(0); }
if (process.env.K6_VUS || process.env.K6_OUT || process.env.K6_BROWSER_DEBUG ||
    process.env.ANALYTICS_PASSWORD !== 'fake $ # password' ||
    process.env.K6_BROWSER_HEADLESS !== 'false' ||
    (process.env.ANALYTICS_MANUAL_MFA === 'true') !== ${manualMfa} ||
    (process.env.ANALYTICS_INSPECT_DASHBOARD === 'true') !== ${inspectDashboard} ||
    (process.env.ANALYTICS_CHECK_WIDGET === 'true') !== ${checkWidget} ||
    (process.env.ANALYTICS_GUIDED_DISCOVERY === 'true') !== ${discoverJourney} ||
    (process.env.ANALYTICS_TIMED_JOURNEY === 'true') !== ${timedJourney} ||
    (process.env.ANALYTICS_OPEN_JOURNEY === 'true') !== ${openJourney} ||
    (process.env.ANALYTICS_FILTER_TEST === 'true') !== ${filterTest} ||
    (process.env.ANALYTICS_INSPECT_FILTER === 'true') !== ${inspectFilter} ||
    (process.env.ANALYTICS_STUDY_GROUP !== undefined) !== ${filterTest} ||
    (${filterTest} && process.env.ANALYTICS_STUDY_GROUP !== 'fake selected group') ||
    process.env.OTHER_SECRET ||
    process.argv.join(' ').includes(process.env.ANALYTICS_PASSWORD)) process.exit(2);
console.log(process.env.ANALYTICS_PASSWORD);
console.error(JSON.stringify({ level: 'error', msg: process.env.ANALYTICS_PASSWORD }));
console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS ' + process.env.ANALYTICS_PASSWORD }));
console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS credentials_submitted' }));
if (${manualMfa}) console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS manual_mfa_window' }));
if (${confirmRoute}) console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS analytics_route_confirmed' }));
if (${timedJourney || filterTest}) console.log(JSON.stringify({ source: 'console', msg: 'JOURNEY_BROWSER ' +
  JSON.stringify({version:'156.0.8078.48',devicePixelRatio:2,secret:'fake secret'}) }));
if (${confirmProbe}) console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS dashboard_probe_complete' }));
if (${confirmWidget}) console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS widget_rendered' }));
if (${confirmDiscovery}) {
  console.log(JSON.stringify({ source: 'console', msg: 'DISCOVERY_CHECKPOINT ' + JSON.stringify({
    sequence: 1, step: 'initial_viewport', viewport: {width:1280,height:720},
    tabs: [], scrollContainers: [], widgets: [], ignored: 'fake secret',
  }) }));
  console.log(JSON.stringify({ source: 'console', msg: 'LOGIN_POC_STATUS discovery_complete' }));
}
if (${completeCoverage}) {
  if (${confirmOpen}) console.log(JSON.stringify({source:'console',msg:'JOURNEY_RECORD '+JSON.stringify({
    sequence:1,action:'dashboard_open',tabIndex:0,checkpoint:0,durationMs:100,status:'passed',
    widgets:Array.from({length:6},(_,widgetIndex)=>({widgetIndex,state:'ready_chart',readyAfterMs:80})),
    scroll:{top:0,height:720,total:720,bottom:true},
  })}));
  const counts = [16,4,9,1];
  for (let tabIndex=0;tabIndex<4;tabIndex++) {
    console.log(JSON.stringify({source:'console',msg:'JOURNEY_RECORD '+JSON.stringify({
      sequence:tabIndex+1+Number(${confirmOpen}),action:'tab_switch',tabIndex,checkpoint:0,durationMs:25,status:'passed',
      widgets:Array.from({length:counts[tabIndex]},(_,widgetIndex)=>({widgetIndex,state:'ready_chart',readyAfterMs:20})),
      scroll:{top:0,height:720,total:720,bottom:true}, secret:'fake secret',
    })}));
  }
}
if (${confirmJourney}) console.log(JSON.stringify({source:'console',msg:'LOGIN_POC_STATUS journey_complete'}));
if (${filterEvidence}) {
  for (const sequence of [1,2]) {
    const failed = ${filterFailure} && sequence === 1;
    console.log(JSON.stringify({source:'console',msg:'FILTER_RECORD '+JSON.stringify({
      sequence,action:sequence===1?'filter_apply':'filter_reset',status:failed?'failed':'passed',durationMs:123,
      selectionVerified:!failed,spinnerSeen:true,spinnerCleared:true,rendererChanged:true,widgetsReady:!failed,
      ...(failed ? {
        stage:'refresh',guardReason:'none',originalCaptured:true,
        refresh:{applicationObserved:true,popupClosed:true,raw:'fake secret',readiness:{
          scrollTop:0,selectedTabCount:1,expectedTabSelected:true,visibleWidgetCount:6,unexpectedWidgetCount:0,
          selectedTabs:['fake secret'],
          widgets:Array.from({length:6},(_,widgetIndex)=>({
            widgetIndex,matches:1,state:widgetIndex===2?'missing_points':'ready_chart',title:'fake secret',
          })),
        }},
        structureInspection:{status:'captured',widgets:Array.from({length:6},(_,widgetIndex)=>({
          widgetIndex,matches:1,structure:{
            scanned:1,visibleCount:1,scanTruncated:false,treeTruncated:false,
            counts:{svg:0,canvas:1,iframe:0,table:0,image:0,highcharts:0,grid:0,pivot:0,alert:0,status:0,progress:0},
            nodes:[{tag:'canvas',role:'none',depth:0,visible:true,hasDirectText:false,text:'fake secret'}],
          },
        }))},
      } : {}),
      option:'fake secret',
    })}));
  }
}
if (${confirmFilter}) console.log(JSON.stringify({source:'console',msg:'LOGIN_POC_STATUS filter_complete'}));
`);
      chmodSync(executable, 0o700);
      const result = spawnSync(process.execPath, [
        join(directory, 'scripts/run-login-poc.js'),
        ...(manualMfa ? ['--manual-mfa'] : []),
        ...(inspectDashboard ? ['--inspect-dashboard'] : []),
        ...(checkWidget ? ['--check-widget'] : []),
        ...(discoverJourney ? ['--discover'] : []),
        ...(experience ? ['--experience'] : [
          ...(timedJourney ? [openJourney ? '--open-journey' : '--journey'] : []),
          ...(filterTest ? [inspectFilter ? '--filter-inspect' : '--filter'] : []),
        ]),
      ], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          K6_VUS: '9000',
          K6_OUT: 'unapproved-output',
          K6_BROWSER_DEBUG: 'true',
          ANALYTICS_MANUAL_MFA: 'true',
          ANALYTICS_INSPECT_DASHBOARD: 'true',
          ANALYTICS_CHECK_WIDGET: 'true',
          ANALYTICS_GUIDED_DISCOVERY: 'true',
          ANALYTICS_TIMED_JOURNEY: 'true',
          ANALYTICS_OPEN_JOURNEY: 'true',
          ANALYTICS_FILTER_TEST: 'true',
          ANALYTICS_INSPECT_FILTER: 'true',
          ANALYTICS_STUDY_GROUP: 'unapproved inherited target',
        },
        encoding: 'utf8',
      });
      const successful = confirmRoute && (!inspectDashboard || confirmProbe) && (!checkWidget || confirmWidget) &&
        (!discoverJourney || confirmDiscovery) && (!timedJourney || (confirmJourney && completeCoverage)) &&
        (!openJourney || confirmOpen) && (!filterTest || (confirmFilter && filterEvidence && !filterFailure));
      assert.equal(result.status, successful ? 0 : 1);
      assert.doesNotMatch(result.stdout + result.stderr, /fake|password|example\.invalid/);
      assert.match(result.stdout, /Submitted the credentials once/);
      assert.equal(result.stdout.includes('Assisted MFA:'), manualMfa);
      if (confirmRoute) assert.match(result.stdout, /Reached the Analytics route/);
      if (filterFailure) {
        assert.match(result.stdout, /expected widget positions: .*3:missing_points\(1\)/);
        assert.match(result.stdout, /structural inspection: captured/);
      }
      if (!successful) {
        assert.match(result.stderr, /proof of concept failed/);
      }
    }
    const reports = readdirSync(join(directory, 'results'));
    assert.equal(reports.length, 20);
    let experienceReports = 0;
    let failedRefreshReports = 0;
    for (const file of reports) {
      const content = readFileSync(join(directory, 'results', file), 'utf8');
      assert.doesNotMatch(content, /fake|password|example\.invalid|ignored/);
      if (file.endsWith('.md')) {
        experienceReports++;
        assert.match(content, /Dashboard performance summary/);
        assert.match(content, /browser RTT is not backend execution/);
        continue;
      }
      const records = content.trim().split('\n').map((line) => JSON.parse(line));
      assert.equal(records[0].performanceMeasured, !file.startsWith('discovery-'));
      if (!file.startsWith('discovery-')) {
        assert.deepEqual(records.find((record) => record.type === 'browser'), {
          type: 'browser', engine: 'chromium', version: '156.0.8078.48', devicePixelRatio: 2,
        });
        assert.equal(records[0].runner.node, process.version);
      }
      assert.equal(records.at(-1).type, 'outcome');
      if (file.startsWith('filter-')) assert.equal(records[0].selectionPolicy, 'unique-case-insensitive-local-name');
      const refresh = records.find((record) => record.type === 'measurement' && record.refresh);
      if (refresh) {
        failedRefreshReports++;
        assert.equal(refresh.refresh.readiness.widgets[2].state, 'missing_points');
        assert.equal(refresh.structureInspection.widgets[2].structure.counts.canvas, 1);
        assert.equal(records.at(-1).success, false);
        assert.equal(records.at(-1).summary.complete, false);
        assert.equal((records.at(-1).summary.filter ?? records.at(-1).summary).restorationVerified, true);
      }
    }
    assert.equal(failedRefreshReports, 3);
    assert.equal(experienceReports, 4);
    for (const content of ['', 'ANALYTICS_STUDY_GROUP="   "\n']) {
      writeFileSync(join(directory, '.env.filter'), content, { mode: 0o600 });
      const invalidTarget = spawnSync(process.execPath, [
        join(directory, 'scripts/run-login-poc.js'), '--manual-mfa', '--filter',
      ], { encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } });
      assert.equal(invalidTarget.status, 1);
      assert.match(invalidTarget.stderr, /No login was attempted/);
      assert.doesNotMatch(invalidTarget.stdout + invalidTarget.stderr, /fake|password|example\.invalid/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
