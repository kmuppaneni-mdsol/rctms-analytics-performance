import { browser } from 'k6/browser';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { runJourney } from '../lib/journey.js';
import { journeyDom } from '../lib/journey-dom.js';

const completed = new Counter('journey_fixture_completed');
export const options = {
  scenarios: { local_journey: {
    executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '30s',
    options: { browser: { type: 'chromium' } },
  } },
  thresholds: { checks: ['rate==1'], journey_fixture_completed: ['count==1'] },
};
const tabs = [
  { name: 'First', widgets: ['First chart', 'First grid', 'First pivot'], initialWidgets: ['First chart'] },
  { name: 'Second', widgets: ['Second chart', 'Second grid', 'Second pivot'], initialWidgets: ['Second chart'] },
];

function fixtureSetup() {
  document.body.innerHTML = '<div style="height:400px;overflow-y:auto" id="outer">' +
    '<div id="tabs"></div><main style="height:220px;overflow-y:auto" id="scroll"></main></div>';
  window.selectTab = function (name) {
    for (const button of document.querySelectorAll('[role="tab"]')) {
      button.setAttribute('aria-selected', String(button.textContent === name));
    }
    const scroller = document.getElementById('scroll');
    const chart = '<div class="highcharts-container"><svg class="highcharts-root" width="180" height="100">' +
      '<g class="highcharts-series"><rect class="highcharts-point" width="100" height="80"></rect></g></svg></div>';
    const grid = '<div class="ag-root" role="grid"><div class="ag-center-cols-container">' +
      '<div class="ag-row"><div class="ag-cell">PRIVATE_CELL_VALUE</div></div></div></div>';
    const pivot = name === 'First' ?
      '<div class="dx-pivotgrid"><div class="dx-area-data">' +
      '<table><tr><td>PRIVATE_CELL_VALUE</td></tr></table></div></div>' :
      '<div class="dx-pivotgrid"><table><tr><td class="dx-area-row-cell">PRIVATE_HEADER_VALUE</td>' +
      '<td class="dx-area-data-cell"><div class="dx-pivotgrid-area"><table><tr>' +
      '<td>PRIVATE_CELL_VALUE</td></tr></table></div></td></tr></table></div>';
    scroller.innerHTML = ['chart', 'grid', 'pivot'].map((kind, index) =>
      '<section data-testid="answer-content" style="height:250px"><div data-testid="dynamic-title-box">' +
      '<h2 role="heading">' + name + ' ' + kind + '</h2></div>' +
      [chart, grid, pivot][index] + '</section>'
    ).join('');
    scroller.scrollTop = 0;
  };
  for (const name of ['First', 'Second']) {
    const tab = document.createElement('button');
    tab.setAttribute('role', 'tab');
    tab.textContent = name;
    tab.onclick = () => window.selectTab(name);
    document.getElementById('tabs').append(tab);
  }
  window.selectTab('First');
}

export default async function () {
  completed.add(0);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    const source = '<!doctype html><body><script>(' + fixtureSetup.toString() + ')();</script></body>';
    const html = '<!doctype html><iframe style="width:1000px;height:400px" srcdoc="' +
      source.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></iframe>';
    await page.goto('data:text/html,' + encodeURIComponent(html));
    let frame = await (await page.$('iframe')).contentFrame();
    await frame.waitForLoadState('domcontentloaded');
    await frame.evaluate(fixtureSetup);
    const initialGeometry = await frame.evaluate(journeyDom, 'snapshot');
    if (!check(initialGeometry.scroll, {
      'ignores nonoverflowing auto-scroll ancestors': (scroll) => scroll.height === 220 && !scroll.bottom,
    })) throw new Error('Wrong scroll container selected.');
    const chartDiagnostic = await frame.evaluate(journeyDom, 'diagnostic');
    if (!check(chartDiagnostic.widgets[0].renderSignals, {
      'chart diagnostic counts match qualifying rendered series points': (signals) =>
        signals.chartCount === 1 && signals.pointCount === 1 && signals.visiblePointCount === 1 &&
        signals.seriesPointCount === 1 && signals.visibleSeriesPointCount === 1 &&
        signals.drawnSeriesPointCount === 1,
    })) throw new Error('Chart structural diagnostics failed.');
    const result = await runJourney(page, tabs, { frameSelector: 'iframe', readyTimeout: 2000 });
    if (!check(result, {
      'journey verifies six widgets across both tabs': (value) => value.widgetCount === 6,
      'journey records tab and scroll durations': (value) => value.actionCount > 2 && value.durationMs > 0,
    })) throw new Error('Local journey coverage failed.');
    const reopened = await runJourney(page, tabs, {
      frameSelector: 'iframe', readyTimeout: 2000, reload: true,
    });
    if (!check(reopened, {
      'authenticated reload plus separate traversal verifies every widget': (value) =>
        value.widgetCount === 6 && value.actionCount === result.actionCount + 1 && value.durationMs > 0,
    })) throw new Error('Local reload journey failed.');
    frame = await (await page.$('iframe')).contentFrame();
    await frame.evaluate(function () { window.selectTab('First'); });
    for (const state of ['loading', 'error', 'no_data', 'unsupported', 'missing_points', 'missing_rows', 'missing_cells']) {
      await frame.evaluate(function (state) {
        window.selectTab('First');
        const tile = document.querySelector('[data-testid="answer-content"]');
        if (state === 'loading') tile.insertAdjacentHTML('beforeend', '<div class="rdLoadingIndicator">Loading</div>');
        if (state === 'error') tile.insertAdjacentHTML('beforeend', '<div role="alert">Fixture error</div>');
        if (state === 'no_data') tile.insertAdjacentHTML('beforeend', '<div class="ag-overlay-no-rows-center">No rows</div>');
        if (state === 'unsupported') tile.querySelector('.highcharts-container').remove();
        if (state === 'missing_points') tile.querySelector('.highcharts-series').innerHTML = '';
        if (state === 'missing_rows') {
          tile.querySelector('.highcharts-container').outerHTML =
            '<div class="ag-root" role="grid"><div class="ag-header">Header only</div></div>';
        }
        if (state === 'missing_cells') {
          tile.querySelector('.highcharts-container').outerHTML =
            '<div class="dx-pivotgrid"><table><tr><th>Header only</th></tr></table></div>';
        }
      }, state);
      const snapshot = await frame.evaluate(journeyDom, 'snapshot');
      if (!check(snapshot.widgets[0].state, {
        [`rejects ${state} as ready`]: (value) => value === state,
      })) throw new Error('Local journey state rejection failed.');
    }
    await frame.evaluate(function () {
      const tile = document.querySelector('[data-testid="answer-content"]');
      tile.querySelector('.dx-pivotgrid').innerHTML =
        '<div class="dx-area-data"><table><tr><td style="width:20px;height:20px"></td>' +
        '<td style="display:none">PRIVATE_CELL_VALUE</td></tr></table></div>' +
        '<table><tr><td>PRIVATE_HEADER_VALUE</td></tr></table>';
    });
    const diagnostic = await frame.evaluate(journeyDom, 'diagnostic');
    if (!check(diagnostic.widgets[0], {
      'hidden data and outside-area cells do not satisfy pivot readiness': (widget) =>
        widget.state === 'missing_cells',
      'pivot diagnostics contain structural counts without cell values': (widget) =>
        widget.renderSignals.dataAreaCount === 1 && widget.renderSignals.dataCellCount === 2 &&
        widget.renderSignals.visibleDataCellCount === 1 && widget.renderSignals.populatedDataCellCount === 1 &&
        widget.renderSignals.visiblePopulatedDataCellCount === 0 && widget.renderSignals.tableCellCount === 3 &&
        widget.renderSignals.visibleTableCellCount === 2 && !JSON.stringify(widget).includes('PRIVATE_'),
      'pivot structure exposes only vendor classes and tags': (widget) =>
        widget.pivotStructure.includes('DIV dx-area-data') &&
        widget.pivotStructure.includes('TD') && !JSON.stringify(widget.pivotStructure).includes('PRIVATE_'),
    })) throw new Error('Local pivot diagnostics failed.');
    for (const populated of [false, true]) {
      await frame.evaluate(function (populated) {
        const tile = document.querySelector('[data-testid="answer-content"]');
        tile.querySelector('.dx-pivotgrid').innerHTML =
          '<table><tr><td class="dx-area-row-cell">PRIVATE_HEADER_VALUE</td>' +
          '<td class="dx-area-data-cell"><div class="dx-pivotgrid-area">' +
          '<table class="dx-pivot-grid-fake-table" style="display:none"><tr><td>PRIVATE_HIDDEN_VALUE</td></tr></table>' +
          '<table><tr><td style="width:20px;height:20px">' +
          (populated ? 'PRIVATE_DATA_VALUE' : '') + '</td></tr></table></div></td></tr></table>';
      }, populated);
      const actualLayout = await frame.evaluate(journeyDom, 'diagnostic');
      if (!check(actualLayout.widgets[0], {
        [`live-layout pivot ${populated ? 'accepts populated data' : 'rejects headers and hidden data'}`]: (widget) =>
          widget.state === (populated ? 'ready_pivot' : 'missing_cells') &&
          widget.renderSignals.dataAreaCount === 1 &&
          widget.renderSignals.visiblePopulatedDataCellCount === (populated ? 1 : 0) &&
          !JSON.stringify(widget).includes('PRIVATE_'),
      })) throw new Error('Live-layout pivot readiness failed.');
    }
    for (const variant of ['direct', 'hidden', 'empty_path', 'outside_root', 'legend', 'tooltip']) {
      await frame.evaluate(function (variant) {
        window.selectTab('First');
        const tile = document.querySelector('[data-testid="answer-content"]');
        const svg = tile.querySelector('svg.highcharts-root');
        const point = '<path class="highcharts-point" d="M 0 0 L 80 0 L 80 80 Z"></path>';
        if (variant === 'direct') svg.innerHTML = point;
        if (variant === 'hidden') svg.innerHTML = '<g style="display:none">' + point + '</g>';
        if (variant === 'empty_path') svg.innerHTML = '<path class="highcharts-point" d=" "></path>';
        if (variant === 'outside_root') {
          svg.innerHTML = '';
          tile.insertAdjacentHTML('beforeend', '<svg width="100" height="100">' + point + '</svg>');
        }
        if (variant === 'legend' || variant === 'tooltip') {
          svg.innerHTML = '<g class="highcharts-' + variant + '">' + point + '</g>';
        }
      }, variant);
      const snapshot = await frame.evaluate(journeyDom, 'snapshot');
      if (!check(snapshot.widgets[0].state, {
        [`chart ${variant} ${variant === 'direct' ? 'is ready' : 'is not ready'}`]: (state) =>
          state === (variant === 'direct' ? 'ready_chart' : 'missing_points'),
      })) throw new Error('Chart point layout regression failed.');
    }
    completed.add(1);
  } finally {
    await page.close();
  }
}
