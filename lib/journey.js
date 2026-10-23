import { sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { journeyDom } from './journey-dom.js';

const duration = new Trend('dashboard_action_duration', true);
const iframeSelector = 'iframe[src^="https://medidata-dev.thoughtspot.cloud/"]';
const readyStates = ['ready_chart', 'ready_grid', 'ready_pivot'];

export async function runJourney(page, tabs, settings = {}) {
  const selector = settings.frameSelector || iframeSelector;
  const readyTimeout = settings.readyTimeout || 60000;
  // Including timeOrigin preserves the clock boundary across a host-document reload.
  const now = settings.reload ?
    () => page.evaluate(function () { return performance.timeOrigin + performance.now(); }) :
    () => page.evaluate(function () { return performance.now(); });
  const clockOrigin = await now();
  const records = [];
  let frame;
  async function attach() {
    await page.locator(selector).waitFor({ state: 'visible', timeout: 60000 });
    const element = await page.$(selector);
    frame = await element.contentFrame();
    if (!frame) throw new Error('Dashboard frame not attached.');
    await frame.waitForLoadState('domcontentloaded', { timeout: 60000 });
  }
  function emit(record) {
    records.push(record);
    console.log(`JOURNEY_RECORD ${JSON.stringify(record)}`);
    if (record.action !== 'readiness_diagnostic') {
      duration.add(record.durationMs, { action: record.action, tab: String(record.tabIndex), status: record.status });
    }
  }
  async function action(actionName, tabIndex, checkpoint, initiate, completion) {
    const started = await now();
    try {
      await initiate();
      const result = await completion(started);
      emit({
        sequence: records.length + 1, action: actionName, tabIndex, checkpoint,
        durationMs: (await now()) - started, status: 'passed', ...result,
      });
      return result;
    } catch {
      emit({
        sequence: records.length + 1, action: actionName, tabIndex, checkpoint,
        durationMs: (await now()) - started, status: 'failed',
      });
      throw new Error('Dashboard action failed; see sanitized journey records.');
    }
  }
  async function ready(tab, required = [], started, checkpoint = 0) {
    const deadline = (await now()) + readyTimeout;
    const observations = new Map();
    let last;
    do {
      last = await frame.evaluate(journeyDom, 'snapshot');
      if (last.selectedTabs.length !== 1 || last.selectedTabs[0] !== tab.name) {
        sleep(0.2);
        continue;
      }
      const expected = new Set(tab.widgets);
      if (last.widgets.some((widget) => !expected.has(widget.title))) {
        throw new Error('Unexpected widget title in active tab.');
      }
      if (last.widgets.some((widget) => widget.state === 'error' || widget.state === 'no_data')) {
        console.log('LOGIN_POC_STATUS journey_widget_error_or_no_data');
        throw new Error('Explicit error/no-data does not satisfy this rendered-data journey.');
      }
      const titles = last.widgets.map((widget) => widget.title);
      const observedAt = (await now()) - started;
      for (const widget of last.widgets) {
        if (readyStates.includes(widget.state) && !observations.has(widget.title)) {
          observations.set(widget.title, observedAt);
        }
      }
      if (last.selectedTabs.length === 1 && last.selectedTabs[0] === tab.name &&
          titles.length > 0 && new Set(titles).size === titles.length &&
          required.every((title) => titles.includes(title)) &&
          last.widgets.every((widget) => readyStates.includes(widget.state))) {
        return { widgets: last.widgets.map((widget) => ({
          widgetIndex: tab.widgets.indexOf(widget.title), state: widget.state,
          readyAfterMs: observations.get(widget.title),
        })), scroll: last.scroll };
      }
      sleep(0.2);
    } while ((await now()) < deadline);
    const diagnostic = await frame.evaluate(journeyDom, 'diagnostic');
    emit({
      sequence: records.length + 1, action: 'readiness_diagnostic',
      tabIndex: tabs.indexOf(tab), checkpoint, durationMs: 0, status: 'failed',
      scroll: diagnostic.scroll,
      widgets: diagnostic.widgets.map((widget) => ({
        widgetIndex: tab.widgets.indexOf(widget.title), state: widget.state,
        renderSignals: widget.renderSignals, pivotStructure: widget.pivotStructure,
      })),
    });
    throw new Error('Visible widget readiness timed out.');
  }

  await attach();
  if (settings.reload) {
    await page.frameLocator(selector).getByRole('tab', { name: tabs[0].name, exact: true }).click();
    await frame.waitForFunction(
      'Array.from(document.querySelectorAll(\'[role="tab"][aria-selected="true"]\'))' +
      '.some(tab => tab.textContent.trim() === ' + JSON.stringify(tabs[0].name) + ')',
      { timeout: readyTimeout }
    );
    await frame.evaluate(journeyDom, 'top');
    await action('dashboard_open', 0, 0, async () => {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: readyTimeout });
      await attach();
    }, async (started) => {
      const result = await ready(tabs[0], tabs[0].initialWidgets, started);
      if (result.scroll.top !== 0) throw new Error('Reload did not restore the initial viewport.');
      return result;
    });
  }
  // Establish a real first tab-switch action after login, not a click on an already-selected tab.
  if (tabs.length > 1) {
    await page.frameLocator(selector).getByRole('tab', { name: tabs[1].name, exact: true }).click();
    await frame.waitForFunction(
      'Array.from(document.querySelectorAll(\'[role="tab"][aria-selected="true"]\'))' +
      '.some(tab => tab.textContent.trim() === ' + JSON.stringify(tabs[1].name) + ')',
      { timeout: readyTimeout }
    );
  }
  const visited = [];
  for (let tabIndex = 0; tabIndex < tabs.length; tabIndex += 1) {
    const tab = tabs[tabIndex];
    let initial;
    if (tabIndex === 0) {
      initial = await action('tab_switch', tabIndex, 0, async () => {
        const tabLocator = page.frameLocator(selector).getByRole('tab', { name: tab.name, exact: true });
        await tabLocator.waitFor({ state: 'visible', timeout: readyTimeout });
        await tabLocator.click();
        await frame.evaluate(journeyDom, 'top');
      }, (started) => ready(tab, tab.initialWidgets, started));
    } else {
      initial = await action('tab_switch', tabIndex, 0, async () => {
        await frame.evaluate(journeyDom, 'top');
        await page.frameLocator(selector).getByRole('tab', { name: tab.name, exact: true }).click();
        await frame.evaluate(journeyDom, 'top');
      }, (started) => ready(tab, tab.initialWidgets, started));
    }
    const covered = new Set(initial.widgets.map((widget) => widget.widgetIndex));
    let position = initial.scroll;
    let checkpoint = 0;
    while (!position.bottom) {
      checkpoint += 1;
      if (checkpoint > 40) throw new Error('Scroll checkpoint limit exceeded.');
      const before = position.top;
      const result = await action('scroll', tabIndex, checkpoint, async () => {
        await frame.evaluate(journeyDom, 'next');
      }, (started) => ready(tab, [], started, checkpoint));
      for (const widget of result.widgets) covered.add(widget.widgetIndex);
      position = result.scroll;
      if (position.top <= before && !position.bottom) throw new Error('Dashboard scroll made no progress.');
    }
    if (covered.size !== tab.widgets.length) {
      console.log('LOGIN_POC_STATUS journey_coverage_incomplete');
      throw new Error('Not all expected widgets were verified during traversal.');
    }
    visited.push(covered.size);
  }
  return { actionCount: records.length, widgetCount: visited.reduce((sum, count) => sum + count, 0),
    durationMs: (await now()) - clockOrigin };
}
