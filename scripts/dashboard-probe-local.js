import { check } from 'k6';
import { browser } from 'k6/browser';
import { Counter } from 'k6/metrics';
import { probeDashboard } from '../lib/dashboard-probe.js';
import { widgetState } from '../lib/widget-state.js';
import { checkDashboardWidget } from '../lib/widget-readiness.js';
import { localSmokeOptions } from '../lib/scenarios.js';

const completed = new Counter('widget_fixture_suite_completed');
const smokeOptions = localSmokeOptions();
export const options = {
  ...smokeOptions,
  thresholds: { ...smokeOptions.thresholds, widget_fixture_suite_completed: ['count==1'] },
};

export default async function () {
  completed.add(0);
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<!doctype html><iframe srcdoc=\'<div data-testid="answer-content">' +
      '<h2>Study Environments with Visit Counts</h2>' +
      '<table><tr><td>Local fixture</td></tr></table></div>\'></iframe>'
    );
    await probeDashboard(page, 'iframe');
    check(true, { 'local iframe probe completes without remote requests': (value) => value });
    const chart = '<div class="highcharts-container"><svg class="highcharts-root" width="100" height="100">' +
      '<g class="highcharts-series"><path class="highcharts-point" d="M0 0 L80 0 L0 80 Z"></path></g></svg></div>';
    const heading = '<h2 role="heading">Study Environments with Visit Counts</h2>';
    const cases = [
      { name: 'title alone is not ready', html: heading, expected: 'missing_chart' },
      { name: 'empty chart is not ready', html: heading + chart.replace('class="highcharts-point"', ''), expected: 'missing_points' },
      { name: 'visible spinner rejects even rendered points', html: heading + chart + '<div class="rdLoadingIndicator">Loading</div>', expected: 'loading' },
      { name: 'visible error rejects rendered points', html: heading + chart + '<div role="alert">Fixture error</div>', expected: 'error' },
      { name: 'no data is explicit rather than successful', html: heading + '<div class="highcharts-no-data">No data</div>', expected: 'no_data' },
      { name: 'hidden points are not ready', html: heading + chart.replace('<g ', '<g style="opacity:0" '), expected: 'missing_points' },
      { name: 'offscreen points are not ready', html: heading + chart.replace('<g ', '<g transform="translate(10000,0)" '), expected: 'missing_points' },
      { name: 'missing exact heading is not ready', html: chart, expected: 'missing_title' },
      { name: 'wrapper is not a spinner', html: heading + '<div data-testid="answer-content-loading-indicator">' + chart + '</div>', expected: 'ready' },
      { name: 'rendered chart with cleared spinner is ready', html: heading + chart + '<div class="rdLoadingIndicator" style="display:none">Loading</div>', expected: 'ready' },
    ];
    for (const fixture of cases) {
      const content = '<div data-testid="answer-content">' + fixture.html + '</div>';
      await page.setContent('<!doctype html><iframe srcdoc="' +
        content.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + '"></iframe>');
      const tile = page.frameLocator('iframe').locator('[data-testid="answer-content"]');
      await tile.waitFor({ state: 'visible' });
      const state = await tile.evaluate(widgetState);
      if (!check(state, { [fixture.name]: (value) => value === fixture.expected })) {
        throw new Error(`Local widget fixture failed: ${fixture.name}; got ${state}.`);
      }
    }
    await checkDashboardWidget(page, 'iframe');
    completed.add(1);
  } finally {
    await page.close();
  }
}
