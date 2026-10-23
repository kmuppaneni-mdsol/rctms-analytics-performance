import { check } from 'k6';
import { browser } from 'k6/browser';
import { localSmokeOptions } from '../lib/scenarios.js';

export const options = localSmokeOptions();

export default async function () {
  const page = await browser.newPage();

  try {
    await page.setContent(
      '<!doctype html><html><head><title>Local k6 smoke</title></head>' +
      '<body><main><h1 id="ready">Local browser ready</h1></main></body></html>'
    );
    const heading = await page.locator('#ready').textContent();
    if (!check(heading, {
      'local browser renders expected content': (value) => value === 'Local browser ready',
    })) {
      throw new Error('Local browser smoke failed: expected heading was not rendered.');
    }
  } finally {
    await page.close();
  }
}
