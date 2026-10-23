import { browser } from 'k6/browser';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { inspectFilteredResult, runFilter } from '../lib/filter.js';
import { journeyDom } from '../lib/journey-dom.js';
import { runJourney } from '../lib/journey.js';

const completed = new Counter('filter_fixture_completed');
export const options = {
  scenarios: { filter_fixture: {
    executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '120s',
    options: { browser: { type: 'chromium' } },
  } },
  thresholds: { checks: ['rate==1'], filter_fixture_completed: ['count==1'] },
};
const title = 'Study Environments with Visit Counts';
const tab = { name: 'Summary', initialWidgets: [title] };

function setup(mode) {
  const chart = '<div class="highcharts-container"><svg class="highcharts-root" width="180" height="100">' +
    '<path class="highcharts-point" d="M 0 0 L 80 0 L 80 80 Z"></path></svg></div>';
  document.body.innerHTML = '<button role="tab" aria-selected="true">Summary</button>' +
    '<button id="trigger">Study Group Filter (Select)</button>' +
    '<main style="height:400px;overflow:auto"><section data-testid="answer-content">' +
    '<div data-testid="dynamic-title-box"><h2 role="heading">Study Environments with Visit Counts</h2></div>' +
    chart + '</section></main><div id="popup" role="dialog" style="display:none">' +
    '<h2>Apply filters and parameters</h2><button role="tab" aria-selected="true">Include</button>' +
    '<div class="attribute-filter-module__allCheckboxContainer"><input type="checkbox"></div>' +
    '<label class="toggle-module__label"><input type="checkbox" checked>PRIVATE_TOGGLE</label>' +
    '<div id="options"></div><button id="apply">Apply</button><button id="cancel">Cancel</button>' +
    '<button id="global">Restore to default</button></div>';
  let applied = false;
  let applications = 0;
  const popup = document.getElementById('popup');
  const rows = document.getElementById('options');
  const tile = document.querySelector('[data-testid="answer-content"]');
  function populate() {
    rows.innerHTML = ['PRIVATE_GROUP_A', 'PRIVATE_GROUP_B', 'PRIVATE_GROUP_C'].map((key, index) =>
      '<div class="checkbox-list-module__singleCheckboxItem"><label class="checkbox-module__label">' +
      '<input class="checkbox-module__nativeCheckbox" type="checkbox" style="display:none" ' +
      ((index === (mode === 'third_target' ? 2 : 0) && applied) || index === 1 ||
        mode === 'no_option' ? 'checked' : '') +
      '><span class="checkbox-module__customCheckbox"></span>' + key + '</label></div>'
    ).join('');
    if (mode === 'ambiguous') rows.children[1].querySelector('label').lastChild.textContent = 'PRIVATE_GROUP_A';
    if (mode === 'identity_change' && applied) {
      rows.children[0].querySelector('label').lastChild.textContent = 'PRIVATE_DIFFERENT_GROUP';
    }
    if (mode === 'reordered' && applied) rows.prepend(rows.lastElementChild);
    if (mode === 'target_disabled') rows.children[0].querySelector('input').disabled = true;
    if (mode === 'label_counter' && applied) {
      rows.children[0].querySelector('label').append(' 1 selected');
    }
    if (['case_change', 'case_collision'].includes(mode) && applied) {
      rows.children[0].querySelector('label').lastChild.textContent = 'private_group_a';
      if (mode === 'case_collision') {
        rows.children[2].querySelector('label').lastChild.textContent = 'PRIVATE_GROUP_A';
      }
    }
    if (mode === 'summary_counter') {
      document.getElementById('summary')?.remove();
      popup.insertAdjacentHTML('beforeend', '<div id="summary">' + (applied ? 1 : 0) + ' selected</div>');
    }
  }
  document.getElementById('trigger').onclick = () => {
    popup.style.display = 'block';
    rows.innerHTML = '';
    if (mode === 'delayed_options') setTimeout(populate, 250);
    else populate();
    if (applications > 0 && ['delayed_identity', 'delayed_checked', 'permanent_unchecked',
      'delayed_reset_state', 'other_changed'].includes(mode)) {
      if (mode === 'delayed_identity') {
        rows.children[0].querySelector('label').lastChild.textContent = 'PRIVATE_STALE_GROUP';
        setTimeout(populate, 400);
      } else if (mode === 'other_changed') {
        rows.children[1].querySelector('input').checked = false;
      } else if (mode !== 'delayed_reset_state' || applications === 2) {
        rows.children[0].querySelector('input').checked = !applied;
        if (mode !== 'permanent_unchecked') setTimeout(populate, 400);
      }
    }
  };
  document.getElementById('apply').onclick = () => {
    applications++;
    applied = Array.from(rows.querySelectorAll('label')).find((label) =>
      label.textContent === (mode === 'third_target' ? 'PRIVATE_GROUP_C' : 'PRIVATE_GROUP_A'))
      ?.querySelector('input').checked || false;
    document.body.dataset.applied = String(applied);
    popup.style.display = 'none';
    if (mode === 'stale') return;
    tile.style.display = '';
    if (mode !== 'no_spinner') tile.insertAdjacentHTML('beforeend', '<div class="rdLoadingIndicator">Loading</div>');
    setTimeout(() => {
      tile.querySelector('.highcharts-container').outerHTML = chart;
      tile.querySelector('.rdLoadingIndicator')?.remove();
      if (mode === 'no_data' && applied) {
        tile.insertAdjacentHTML('beforeend', '<div data-testid="no-data">No data</div>');
      } else {
        tile.querySelector('[data-testid="no-data"]')?.remove();
      }
      tile.style.display = mode === 'missing_widget' && applied ? 'none' : '';
      const heading = tile.querySelector('[role="heading"]');
      heading.textContent = mode === 'unexpected_widget' && applied ? 'PRIVATE_UNEXPECTED' :
        'Study Environments with Visit Counts';
      if (mode === 'missing_points' && applied) tile.querySelector('.highcharts-point').remove();
      if (mode === 'unsupported_message' && applied) {
        tile.querySelector('.highcharts-container').innerHTML =
          '<div class="PRIVATE_CLASS" role="PRIVATE_ROLE" data-testid="PRIVATE_ID"><p>PRIVATE_MESSAGE</p></div>';
      }
      if (mode === 'unsupported_canvas' && applied) {
        tile.querySelector('.highcharts-container').innerHTML = '<canvas width="180" height="100"></canvas>';
      }
      document.querySelector('body > [role="tab"]').textContent =
        mode === 'wrong_tab' && applied ? 'PRIVATE_OTHER_TAB' : 'Summary';
      document.getElementById('spacer')?.remove();
      if (mode === 'scrolled' && applied) {
        tile.insertAdjacentHTML('afterend', '<div id="spacer" style="height:1000px"></div>');
      }
      tile.parentElement.scrollTop = mode === 'scrolled' && applied ? 20 : 0;
    }, 200);
  };
  document.getElementById('cancel').onclick = () => { popup.style.display = 'none'; };
  document.getElementById('global').onclick = () => { document.body.dataset.globalReset = 'true'; };
}

export default async function () {
  completed.add(0);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.setContent('<!doctype html><body></body>');
    await inspectFilteredResult(page, 10);
    if (!check(await page.locator('#k6-filter-inspection').count(), {
      'inspection expiry removes panel and returns for restoration': (count) => count === 0,
    })) throw new Error('Inspection timeout cleanup failed.');
    await page.evaluate(function () {
      window.__inspectionClicked = false;
      window.__inspectionTimer = setInterval(() => {
        const button = document.querySelector('#k6-filter-inspection button');
        if (button) {
          button.click();
          window.__inspectionClicked = true;
          clearInterval(window.__inspectionTimer);
        }
      }, 20);
    });
    await inspectFilteredResult(page, 2000);
    const continued = await page.evaluate(function () {
      const clicked = window.__inspectionClicked;
      clearInterval(window.__inspectionTimer);
      delete window.__inspectionTimer;
      delete window.__inspectionClicked;
      return clicked && !document.getElementById('k6-filter-inspection');
    });
    if (!check(continued, {
      'inspection Continue removes panel and returns for restoration': (value) => value,
    })) throw new Error('Inspection Continue failed.');
    await page.setContent('<!doctype html><iframe style="width:1100px;height:600px" srcdoc="<!doctype html><body></body>"></iframe>');
    const inspectionFrame = await (await page.$('iframe')).contentFrame();
    await inspectionFrame.waitForLoadState('domcontentloaded');
    await inspectionFrame.evaluate(setup, 'positive');
    await inspectionFrame.evaluate(function () {
      const tile = document.querySelector('[data-testid="answer-content"]');
      tile.querySelector('.highcharts-container').innerHTML =
        '<div role="PRIVATE_ROLE" class="PRIVATE_CLASS"><p>PRIVATE_MESSAGE</p>' +
        '<canvas width="30" height="20"></canvas><svg width="30" height="20"></svg>' +
        '<div role="status">PRIVATE_STATUS</div><div style="display:none"><canvas></canvas></div></div>';
    });
    const inspected = (await inspectionFrame.evaluate(journeyDom, 'structure')).widgets[0];
    if (!check(inspected.structure, {
      'bounded structure distinguishes unknown text and canvas/SVG without values': (structure) =>
        inspected.state === 'unsupported' && structure.counts.canvas === 1 && structure.counts.svg === 1 &&
        structure.counts.status === 1 && !structure.scanTruncated && !structure.treeTruncated &&
        structure.nodes.some((node) => node.role === 'other') &&
        structure.nodes.some((node) => node.tag === 'p' && node.hasDirectText) &&
        !JSON.stringify(structure).includes('PRIVATE'),
    })) throw new Error('Structural inspection privacy or marker check failed.');
    await inspectionFrame.evaluate(function () {
      document.querySelector('.highcharts-container').innerHTML =
        Array.from({ length: 250 }, () => '<span>PRIVATE</span>').join('');
    });
    const capped = (await inspectionFrame.evaluate(journeyDom, 'structure')).widgets[0].structure;
    if (!check(capped, {
      'structural inspection caps traversal and tree output explicitly': (structure) =>
        structure.scanned === 200 && structure.nodes.length === 40 &&
        structure.scanTruncated && structure.treeTruncated && !JSON.stringify(structure).includes('PRIVATE'),
    })) throw new Error('Structural inspection bounds failed.');
    for (const mode of ['positive', 'delayed_options', 'reordered', 'stale', 'no_spinner', 'ambiguous',
      'no_option', 'no_data', 'identity_change', 'missing_widget', 'unexpected_widget', 'missing_points',
      'wrong_tab', 'scrolled', 'unsupported_message', 'unsupported_canvas',
      'third_target', 'target_missing', 'target_disabled', 'delayed_identity', 'delayed_checked',
      'delayed_reset_state', 'permanent_unchecked', 'other_changed', 'summary_counter', 'label_counter',
      'case_change', 'case_collision', 'configured_case']) {
      await page.setContent('<!doctype html><iframe style="width:1100px;height:600px" srcdoc="<!doctype html><body></body>"></iframe>');
      const frame = await (await page.$('iframe')).contentFrame();
      await frame.waitForLoadState('domcontentloaded');
      await frame.evaluate(setup, mode);
      let passed = false;
      try {
        const result = await runFilter(page, tab, {
          frameSelector: 'iframe', timeout: 800,
          target: mode === 'third_target' ? 'PRIVATE_GROUP_C' :
            mode === 'configured_case' ? 'private_group_a' :
            mode === 'target_missing' ? 'PRIVATE_ABSENT' : 'PRIVATE_GROUP_A',
        });
        passed = result.complete;
      } catch {
        console.log('Expected fixture failure observed; raw details withheld.');
      }
      const state = await frame.evaluate(function () {
        return {
          applied: document.body.dataset.applied,
          globalReset: document.body.dataset.globalReset === 'true',
          cleaned: window.__k6StudyGroup === undefined && window.__k6FilterInspection === undefined,
          toggle: document.querySelector('.toggle-module__label input').checked,
          noData: !!document.querySelector('[data-testid="no-data"]'),
          firstChecked: document.querySelector('#options label input')?.checked,
        };
      });
      if (!check({ passed, state }, {
        [`${mode}: completion is strict and original selection is restored where possible`]: (value) =>
          value.passed === ['positive', 'delayed_options', 'reordered', 'third_target',
            'delayed_identity', 'delayed_checked', 'delayed_reset_state', 'summary_counter',
            'case_change', 'configured_case'].includes(mode) &&
          value.state.cleaned && value.state.toggle &&
          !value.state.globalReset &&
          (mode === 'no_data' ? !value.state.noData : true) &&
          (mode === 'third_target' ? value.state.firstChecked === false : true) &&
          (mode === 'other_changed' ? value.state.applied === 'true' : true) &&
          (['positive', 'delayed_options', 'reordered', 'stale', 'no_spinner', 'no_data',
            'missing_widget', 'unexpected_widget', 'missing_points', 'wrong_tab', 'scrolled',
            'unsupported_message', 'unsupported_canvas', 'third_target', 'delayed_identity',
            'delayed_checked', 'delayed_reset_state', 'permanent_unchecked', 'summary_counter',
            'case_change', 'configured_case'].includes(mode) ?
            value.state.applied === 'false' : true),
      })) throw new Error('Filter fixture guard or restoration failed.');
    }
    const source = '<!doctype html><body><script>(' + setup.toString() + ')("positive");' +
      'const first=document.querySelector("body > [role=tab]");' +
      'const second=first.cloneNode(true);second.textContent="Other";second.setAttribute("aria-selected","false");first.after(second);' +
      'for(const tab of [first,second]) tab.onclick=()=>{' +
      'first.setAttribute("aria-selected",String(tab===first));' +
      'second.setAttribute("aria-selected",String(tab===second));' +
      'document.querySelector("[data-testid=dynamic-title-box] h2").textContent=' +
      'tab===first?"Study Environments with Visit Counts":"Other chart";};</script></body>';
    const html = '<!doctype html><iframe style="width:1100px;height:600px" srcdoc="' +
      source.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"></iframe>';
    await page.goto('data:text/html,' + encodeURIComponent(html));
    const traversal = await runJourney(page, [
      { ...tab, widgets: [title] }, { name: 'Other', widgets: ['Other chart'], initialWidgets: ['Other chart'] },
    ], { frameSelector: 'iframe', reload: true, readyTimeout: 2000 });
    const filter = await runFilter(page, tab, {
      frameSelector: 'iframe', timeout: 800, target: 'PRIVATE_GROUP_A',
    });
    if (!check({ traversal, filter }, {
      'reload then traversal then filter apply/reset complete in the same browser': (value) =>
        value.traversal.widgetCount === 2 && value.filter.complete,
    })) throw new Error('Combined experience failed.');
    completed.add(1);
  } finally {
    await page.close();
  }
}
