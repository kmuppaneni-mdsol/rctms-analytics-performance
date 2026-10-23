import { browser } from 'k6/browser';
import { Counter } from 'k6/metrics';

const inspected = new Counter('login_forms_inspected');

export const options = {
  scenarios: {
    inspect_login: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '90s',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: { login_forms_inspected: ['count==1'] },
};

export default async function () {
  const page = await browser.newPage();
  inspected.add(0);
  let stage = 'navigation';
  try {
    if (__ENV.LOGIN_INSPECTION_LOCAL === 'true') {
      await page.setContent(
        '<!doctype html><input id="username" type="email">' +
        '<input id="password" type="password"><button type="submit">Sign in</button>'
      );
    } else {
      await page.goto(
        'https://home-sandbox.imedidata.net/apps/Analytics/dashboards?dashboardId=f9431c78-169f-442d-8f9e-61f8bc0ee73c',
        { waitUntil: 'domcontentloaded', timeout: 60000 }
      );
    }
    stage = 'waiting for visible login inputs';
    await page.waitForFunction(
      'Array.from(document.querySelectorAll("input")).some(input => ' +
      '["email", "password", "text"].includes(input.type) && input.getClientRects().length > 0)',
      { timeout: 20000 }
    );
    stage = 'reading form structure';
    const metadata = await page.evaluate(function () {
      const inputs = [...document.querySelectorAll('input')]
        .filter((input) => input.getClientRects().length > 0)
        .map((input) => ({
          type: input.type,
          id: input.id,
          name: input.name,
          autocomplete: input.autocomplete,
        }));
      return {
        hostname: location.hostname,
        inputs,
        buttons: [...document.querySelectorAll('button, input[type="submit"]')]
        .filter((button) => button.getClientRects().length > 0)
        .map((button) => ({
          tag: button.tagName,
          type: button.type,
          id: button.id,
          text: button.tagName === 'BUTTON' ? button.textContent.trim() : '',
        })),
      };
    });
    console.log(`LOGIN_FORM_METADATA ${JSON.stringify(metadata)}`);
    inspected.add(1);
  } catch (error) {
    const message = String(error);
    console.log(`LOGIN_FORM_METADATA ${JSON.stringify({
      failedStage: stage,
      timedOut: /timeout|timed out/i.test(message),
      connectionFailure: /ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_CERT/i.test(message),
      diagnostics: [
        'execution context', 'navigation', 'ReferenceError', 'TypeError',
        'SyntaxError', 'not defined', 'not a function', 'Object reference',
        'serialization', 'disposed', 'closed', 'undefined',
      ].filter((term) => message.toLowerCase().includes(term.toLowerCase())),
    })}`);
    throw new Error(`Login inspection failed during ${stage}; raw details withheld to protect session data.`);
  } finally {
    await page.close();
  }
}
