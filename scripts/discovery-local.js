import { check } from 'k6';
import { browser } from 'k6/browser';
import { Counter } from 'k6/metrics';
import { guidedDiscovery, dashboardSnapshot } from '../lib/guided-discovery.js';
import { localSmokeOptions } from '../lib/scenarios.js';

const completed = new Counter('discovery_fixture_completed');
const localOptions = localSmokeOptions();
export const options = {
  ...localOptions,
  thresholds: { ...localOptions.thresholds, discovery_fixture_completed: ['count==1'] },
};

export default async function () {
  completed.add(0);
  const page = await browser.newPage();
  try {
    const fixture = '<button role="tab" aria-selected="true">Summary</button>' +
      '<div data-testid="answer-content"><div data-testid="dynamic-title-box">' +
      '<h2 role="heading">Study Environments with Visit Counts</h2></div>' +
      '<table><tr><td>PRIVATE_CELL_VALUE</td></tr></table></div>' +
      '<button>Study Group Filter (Select)</button>' +
      '<div role="dialog"><h2>Apply filters and parameters</h2>' +
      '<label><input type="checkbox" checked value="PRIVATE_FILTER_VALUE">PRIVATE_FILTER_LABEL</label>' +
      '<div class="checkbox-list-module__singleCheckboxItem checkbox-module__container">' +
      '<label class="checkbox-module__label"><input class="checkbox-module__nativeCheckbox" ' +
      'type="checkbox" style="display:none" checked value="PRIVATE_HIDDEN_VALUE">' +
      '<span class="checkbox-module__customCheckbox"></span>PRIVATE_HIDDEN_LABEL</label></div>' +
      '<button>Apply</button><button>Cancel</button></div>';
    await page.setContent('<!doctype html><iframe srcdoc="' +
      fixture.replaceAll('"', '&quot;') + '"></iframe>');
    const frame = await (await page.$('iframe')).contentFrame();
    const snapshot = await frame.evaluate(dashboardSnapshot);
    if (!check(snapshot, {
      'captures title and selected tab': (value) =>
        value.widgets[0].title === 'Study Environments with Visit Counts' && value.tabs[0].selected,
      'does not capture cell values': (value) => !JSON.stringify(value).includes('PRIVATE_CELL_VALUE'),
      'captures popup and checkbox state without values or labels': (value) =>
        value.filterInspection.popupVisible &&
        value.filterInspection.controls.map((control) => control.kind).join(',') === 'study_group,checkbox,apply,cancel' &&
        value.filterInspection.controls[1].checked &&
        !JSON.stringify(value).includes('PRIVATE_FILTER'),
      'captures hidden checkbox state and custom wrapper without labels': (value) =>
        value.filterInspection.customControls.some((control) =>
          control.signature === 'INPUT checkbox-module__nativeCheckbox' && control.checked === true && !control.visible) &&
        value.filterInspection.customControls.some((control) => control.signature === 'LABEL checkbox-module__label') &&
        !JSON.stringify(value).includes('PRIVATE_HIDDEN'),
    })) throw new Error('Discovery snapshot fixture failed.');
    await Promise.all([
      guidedDiscovery(page, 'iframe'),
      (async () => {
        await page.locator('#k6-discovery-panel').waitFor({ state: 'visible' });
        const hiddenState = await frame.evaluate(function () {
          const option = document.querySelector(
            '[role="dialog"] .checkbox-list-module__singleCheckboxItem input[type="checkbox"]'
          );
          const before = option.checked;
          option.closest('label').click();
          const changed = option.checked;
          option.closest('label').click();
          return { before, changed, restored: option.checked };
        });
        if (!check(hiddenState, {
          'observed custom label toggles hidden option checkbox and restores original state': (state) =>
            state.before === true && state.changed === false && state.restored === true,
        })) throw new Error('Custom checkbox fixture failed.');
        await frame.evaluate(function () {
          const tile = document.querySelector('[data-testid="answer-content"]');
          tile.insertAdjacentHTML('beforeend', '<div class="highcharts-container"></div>');
          document.querySelector('[role="dialog"] button').onclick = () => {
            tile.insertAdjacentHTML('beforeend', '<div class="rdLoadingIndicator">Loading</div>');
            setTimeout(() => {
              tile.querySelector('.highcharts-container').innerHTML = '<svg></svg>';
              tile.querySelector('.rdLoadingIndicator').remove();
            }, 200);
          };
          document.querySelector('[role="dialog"] button').click();
        });
        await frame.waitForFunction(
          'window.__k6FilterInspection.applications[0]?.spinnerCleared === true'
        );
        const observed = await frame.evaluate(dashboardSnapshot);
        if (!check(observed.filterInspection.applications[0], {
          'Apply observer records loading, clearing and renderer mutation': (entry) =>
            entry.index === 1 && entry.spinnerSeen && entry.spinnerCleared && entry.chartMutations > 0,
        })) throw new Error('Filter transition observer failed.');
        await frame.evaluate(function () {
          document.querySelector('[role="dialog"] button').onclick = null;
          document.querySelector('[role="dialog"] button').click();
        });
        const noRefresh = await frame.evaluate(dashboardSnapshot);
        if (!check(noRefresh.filterInspection.applications[1], {
          'Apply without a refresh does not invent loading or renderer changes': (entry) =>
            !entry.spinnerSeen && !entry.spinnerCleared && entry.chartMutations === 0,
        })) throw new Error('Stale-content observation failed.');
        await page.locator('[data-command="capture"]').click();
        await page.waitForFunction(
          'document.getElementById("k6-discovery-status").textContent.startsWith("Checkpoint 1 captured.")'
        );
        await page.locator('input[name="k6-discovery-step"][value="scroll_checkpoint"]').check();
        const selectedStep = await page.evaluate(function () {
          return document.querySelector('input[name="k6-discovery-step"]:checked').value;
        });
        if (!check(selectedStep, {
          'checkpoint type radio can be selected': (value) => value === 'scroll_checkpoint',
        })) throw new Error('Checkpoint type radio selection failed.');
        await page.locator('[data-command="capture"]').click();
        await page.waitForFunction(
          'document.getElementById("k6-discovery-status").textContent.startsWith("Checkpoint 2 captured.")'
        );
        await page.locator('[data-command="finish"]').click();
      })(),
    ]);
    if (!check(await page.locator('#k6-discovery-panel').count(), {
      'removes discovery panel on finish': (count) => count === 0,
    })) throw new Error('Discovery panel was not removed.');
    if (!check(await frame.evaluate(function () { return window.__k6FilterInspection === undefined; }), {
      'filter observer is removed when discovery finishes': (removed) => removed,
    })) throw new Error('Filter observer was not removed.');
    completed.add(1);
  } finally {
    await page.close();
  }
}
