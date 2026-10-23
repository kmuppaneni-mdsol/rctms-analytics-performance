import { sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { dashboardWidget } from './dashboard-probe.js';
import { journeyDom } from './journey-dom.js';
import { installFilterObserver } from './guided-discovery.js';
import { filterDom } from './filter-dom.js';
import { filterReadiness } from './filter-report.js';

const duration = new Trend('dashboard_filter_duration', true);
const iframeSelector = 'iframe[src^="https://medidata-dev.thoughtspot.cloud/"]';

export async function inspectFilteredResult(page, timeout = 180000) {
  try {
    await page.evaluate(function () {
      if (document.getElementById('k6-filter-inspection')) throw new Error('Inspection panel already exists.');
      const panel = document.createElement('section');
      panel.id = 'k6-filter-inspection';
      panel.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:2147483647;' +
        'background:white;color:black;border:2px solid black;padding:12px;max-width:340px;font:14px sans-serif';
      const message = document.createElement('p');
      message.textContent = 'Filter result inspection (not timed). Observe the widgets without changing them. ' +
        'Tell the assistant their general state, then continue. Original selection will be restored automatically. ' +
        'Automatic restoration resumes after 3 minutes.';
      const button = document.createElement('button');
      button.textContent = 'Continue and restore original selection';
      button.onclick = () => { panel.dataset.continue = 'true'; button.disabled = true; };
      panel.append(message, button);
      document.body.append(panel);
    });
    console.log('LOGIN_POC_STATUS filter_inspection_paused');
    const deadline = Date.now() + timeout;
    do {
      if (await page.evaluate(function () {
        return document.getElementById('k6-filter-inspection')?.dataset.continue === 'true';
      })) {
        console.log('LOGIN_POC_STATUS filter_inspection_continued');
        return;
      }
      sleep(0.2);
    } while (Date.now() < deadline);
    console.log('LOGIN_POC_STATUS filter_inspection_expired');
  } finally {
    await page.evaluate(function () { document.getElementById('k6-filter-inspection')?.remove(); });
  }
}

export async function runFilter(page, tab, settings = {}) {
  if (typeof settings.target !== 'string' || !settings.target.trim()) {
    throw new Error('An exact local Study Group target is required; no selection was attempted.');
  }
  const selector = settings.frameSelector || iframeSelector;
  const timeout = settings.timeout || 60000;
  await page.frameLocator(selector).getByRole('tab', { name: tab.name, exact: true }).click();
  await dashboardWidget(page, selector);
  const frame = await (await page.$(selector)).contentFrame();
  if (!frame) throw new Error('Filter frame unavailable.');
  const now = () => page.evaluate(function () { return performance.now(); });
  const dom = (command) => frame.evaluate(filterDom,
    command === 'choose' ? { command, target: settings.target } : command);
  async function waitFor(predicate) {
    const deadline = (await now()) + timeout;
    do {
      if (await predicate()) return;
      sleep(0.1);
    } while ((await now()) < deadline);
    throw new Error('Filter condition timed out; raw details withheld.');
  }
  async function inspectReadiness() {
    const snapshot = await frame.evaluate(journeyDom, 'snapshot');
    return filterReadiness(snapshot, tab);
  }
  function resultReady(readiness) {
    if (readiness.invalidResult) {
      throw new Error('Filter result reports error or no data.');
    }
    return readiness.ready;
  }
  await frame.evaluate(journeyDom, 'top');
  await waitFor(async () => resultReady(await inspectReadiness()));
  await frame.evaluate(installFilterObserver);
  let changed = false;
  let applyPassed = false;
  let resetPassed = false;
  async function open() {
    if (!(await dom('status')).popupOpen) await dom('open');
    await waitFor(async () => (await dom('status')).popupOpen);
    await waitFor(() => dom('popup_ready'));
  }
  async function measure(action, sequence, prepare, verification) {
    let started;
    let stage = 'prepare';
    let refresh;
    const evidence = { selectionVerified: false, spinnerSeen: false, spinnerCleared: false,
      rendererChanged: false, widgetsReady: false };
    try {
      await prepare();
      const before = (await dom('status')).applicationCount;
      started = await now();
      stage = 'apply';
      await dom('apply');
      stage = 'refresh';
      await waitFor(async () => {
        const state = await dom('status');
        evidence.spinnerSeen = state.spinnerSeen;
        evidence.spinnerCleared = state.spinnerCleared;
        evidence.rendererChanged = state.chartMutations > 0;
        const readiness = await inspectReadiness();
        refresh = {
          applicationObserved: state.applicationCount === before + 1,
          popupClosed: !state.popupOpen, readiness: readiness.diagnostics,
        };
        evidence.widgetsReady = !state.popupOpen && evidence.spinnerSeen && evidence.spinnerCleared &&
          evidence.rendererChanged && resultReady(readiness);
        return refresh.applicationObserved && evidence.spinnerSeen && evidence.spinnerCleared &&
          evidence.rendererChanged && evidence.widgetsReady;
      });
      const durationMs = (await now()) - started;
      // Selection verification is deliberately outside the Apply-to-render timing.
      stage = 'verify';
      await open();
      await waitFor(() => dom(verification === 'verify_applied' ? 'applied_ready' : 'original_ready'));
      await dom(verification);
      evidence.selectionVerified = true;
      await dom('cancel');
      await waitFor(async () => !(await dom('status')).popupOpen);
      console.log(`FILTER_RECORD ${JSON.stringify({
        sequence, action, status: 'passed', durationMs, ...evidence,
      })}`);
      duration.add(durationMs, { action, status: 'passed' });
      return true;
    } catch {
      const durationMs = started === undefined ? 0 : (await now()) - started;
      const state = await dom('status');
      let structureInspection;
      if (refresh) {
        try {
          const snapshot = await frame.evaluate(journeyDom, 'structure');
          structureInspection = {
            status: 'captured',
            widgets: tab.initialWidgets.map((title, widgetIndex) => {
              const matches = snapshot.widgets.filter((widget) => widget.title === title);
              return { widgetIndex, matches: matches.length,
                ...(matches.length === 1 ? { structure: matches[0].structure } : {}) };
            }),
          };
        } catch {
          structureInspection = { status: 'unavailable' };
          console.log('LOGIN_POC_STATUS filter_structure_unavailable');
        }
      }
      console.log(`FILTER_RECORD ${JSON.stringify({
        sequence, action, status: 'failed', durationMs, ...evidence,
        stage, guardReason: state.guardReason, originalCaptured: state.hasOriginal,
        ...(state.optionComparison ? { optionComparison: state.optionComparison } : {}),
        ...(refresh ? { refresh } : {}),
        ...(structureInspection ? { structureInspection } : {}),
      })}`);
      duration.add(durationMs, { action, status: 'failed' });
      console.log(`LOGIN_POC_STATUS ${action}_failed`);
      return false;
    }
  }
  try {
    applyPassed = await measure('filter_apply', 1, async () => {
      await open();
      // Mark before choosing so a failed post-click guard still triggers restoration.
      changed = true;
      await dom('choose');
    }, 'verify_applied');
    if (!applyPassed && changed && settings.inspectFailure) {
      try {
        await inspectFilteredResult(page);
      } catch {
        console.log('LOGIN_POC_STATUS filter_inspection_failed');
      }
    }
  } finally {
    try {
      if (changed) {
        resetPassed = await measure('filter_reset', 2, async () => {
          await open();
          await waitFor(() => dom(applyPassed ? 'applied_ready' : 'restore_ready'));
          await dom('restore');
        }, 'verify_original');
      }
    } finally {
      await dom('cleanup');
    }
  }
  if (!applyPassed || !resetPassed) throw new Error('Filter test failed; inspect sanitized action records.');
  return { complete: true };
}
