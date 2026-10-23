const iframeSelector = 'iframe[src^="https://medidata-dev.thoughtspot.cloud/"]';
const widgetName = 'Study Environments with Visit Counts';

export async function dashboardWidget(page, frameSelector = iframeSelector) {
  console.log('LOGIN_POC_STATUS dashboard_probe_started');
  await page.locator(frameSelector).waitFor({ state: 'visible', timeout: 60000 });
  const deadline = Date.now() + 90000;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const iframe = await page.$(frameSelector);
      const frame = await iframe.contentFrame();
      if (!frame) throw new Error('ThoughtSpot frame not attached.');
      await frame.waitForLoadState('domcontentloaded', { timeout: Math.max(1, deadline - Date.now()) });
      await page.frameLocator(frameSelector).getByText(widgetName, { exact: true })
        .waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
      break;
    } catch (error) {
      const message = typeof error.error === 'function' ? error.error() : String(error);
      if (!/context|navigation|disposed/i.test(message) || Date.now() >= deadline || attempt >= 3) {
        throw new Error('Unable to attach to the expected widget; raw error withheld.');
      }
      console.log('LOGIN_POC_STATUS dashboard_frame_reattaching');
    }
  }
  console.log('LOGIN_POC_STATUS dashboard_title_observed');
  const tile = page.frameLocator(frameSelector)
    .locator('[data-testid="answer-content"]', { hasText: widgetName });
  if (await tile.count() !== 1) throw new Error('Expected exactly one widget container.');
  return tile;
}

export async function probeDashboard(page, frameSelector = iframeSelector) {
  const tile = await dashboardWidget(page, frameSelector);
  let renderCandidateObserved = true;
  try {
    // Discovery only: these candidates are not yet a validated readiness contract.
    await tile.locator(
      'table, [role="grid"], canvas, .highcharts-container, ' +
      '[class*="tableContainer"], [class*="chartContainer"], [data-testid*="error"]'
    ).first().waitFor({ state: 'visible', timeout: 60000 });
  } catch (error) {
    const message = typeof error.error === 'function' ? error.error() : String(error);
    if (!/timed out|timeout/i.test(message)) throw new Error('Render discovery failed; raw error withheld.');
    renderCandidateObserved = false;
  }
  const structure = await tile.evaluate(function (element) {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return {
      visible: visible(element),
      loadersVisible: Array.from(element.querySelectorAll(
        '[data-testid="answer-content-loading-indicator"], [role="progressbar"], [aria-busy="true"]'
      )).filter(visible).length,
      nodes: Array.from(element.querySelectorAll('*')).slice(-100).map((node) => ({
        tag: node.tagName,
        classes: Array.from(node.classList).filter((name) => /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(name)),
        testid: node.getAttribute('data-testid'),
        role: node.getAttribute('role'),
        visible: visible(node),
      })),
    };
  });
  console.log(`DASHBOARD_PROBE ${JSON.stringify({ renderCandidateObserved, ...structure })}`);
  console.log('LOGIN_POC_STATUS dashboard_probe_complete');
}
