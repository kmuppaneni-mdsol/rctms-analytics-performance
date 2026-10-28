import { browser } from 'k6/browser';
import { observeExperienceApi } from '../lib/experience-api.js';

export const options = {
  scenarios: { local_api: {
    executor: 'shared-iterations', vus: 1, iterations: 1, maxDuration: '30s',
    options: { browser: { type: 'chromium' } },
  } },
};

export default async function () {
  const origin = __ENV.FIXTURE_ORIGIN;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error('Loopback origin required');
  const page = await browser.newPage();
  const records = [];
  // Remap only the classifier's view of loopback URLs, not actual browser traffic.
  const observedPage = {
    on(event, handler) {
      page.on(event, (request) => {
        handler({
          url: () => request.url().replace(origin + '/auth', 'https://home-sandbox.imedidata.net/api/analytics/portfolio/authenticate')
            .replace(origin + '/widget', 'https://medidata-dev.thoughtspot.cloud/prism/'),
          method: () => request.method(), postData: () => request.postData(),
          timing: () => request.timing(),
          headers: () => request.headers(),
          response: () => request.response(),
        });
      });
    },
  };
  const collector = observeExperienceApi(observedPage, (r) => records.push(r));
  try {
    await page.goto(origin);
    collector.action('dashboard_open', 1);
    await page.evaluate(async () => {
      await Promise.all([fetch('/auth', { method: 'POST', headers: {
        traceparent: '00-1234567890abcdef1234567890abcdef-1234567890abcdef-01',
      } }).then((r) => r.text()), fetch('/widget', { method: 'POST',
        body: JSON.stringify({ operationName: 'LoadContextBook', variables: 'PRIVATE' }),
      }).then((r) => r.text())]);
      await Promise.all(Array.from({ length: 24 }, () => fetch('/widget?identical=true', { method: 'POST',
        body: JSON.stringify({ operationName: 'LoadContextBook' }),
      }).then((r) => r.text())));
    });
    collector.action('filter_apply', 1);
    await page.evaluate(async () => {
      await fetch('/widget?fail=true', { method: 'POST',
        body: JSON.stringify({ operationName: 'LoadContextBook' }),
      }).then((r) => r.text());
      await fetch('/widget?disconnect=true', { method: 'POST',
        body: JSON.stringify({ operationName: 'LoadContextBook' }),
      }).catch(() => {});
      const frame = document.createElement('iframe');
      frame.src = '/frame';
      document.body.append(frame);
    });
    await page.waitForFunction('window.frameDone === true');
    collector.action('journey_setup');
    await page.evaluate(() => {
      fetch('/widget?reload=true', { method: 'POST',
        body: JSON.stringify({ operationName: 'LoadContextBook' }),
      }).catch(() => {});
    });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    collector.action('dashboard_open', 2);
    await page.reload();
    // Let requestfinished handlers complete without issuing any additional request.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const capture = await collector.finish();
    console.log(`LOCAL_API ${JSON.stringify({ records, capture })}`);
  } finally {
    await page.close();
  }
}
