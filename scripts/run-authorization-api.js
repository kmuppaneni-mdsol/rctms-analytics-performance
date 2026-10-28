import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loginCredentials } from '../lib/local-credentials.js';
import { authorizationCloudWatch, authorizationConfig, authorizationOrigin, authorizationPath, authorizationRequest,
  authorizationResponse, authorizationMarkdown, authorizationSummary,
  runAuthorizationSamples } from '../lib/authorization-api.js';

if (!process.argv[1] ||
    realpathSync(process.argv[1]) !== realpathSync(fileURLToPath(import.meta.url))) {
  throw new Error('Authorization runner is executable-only; use lib/authorization-api.js for helpers.');
}
if (process.argv.length !== 2) {
  console.error('Usage: npm run api:authorization (configure bounded samples in .env.authorization).');
  process.exit(1);
}

async function main() {
  let browser;
  let context;
  let session;
  let report;
  let markdown;
  let bootstrap;
  let measurements = [];
  let success = false;
  let stage = 'preflight';
  let failureStage;
  const persist = () => writeFileSync(report, JSON.stringify({
    reportId: session.runId, cloudWatch: authorizationCloudWatch,
    session, bootstrap, measurements, summary: authorizationSummary(measurements, session.samples),
    success, outcome: success ? 'authorization-contract-passed' : failureStage ? 'failed' : 'incomplete',
    ...(failureStage ? { failureStage } : {}),
  }, null, 2) + '\n', { mode: 0o600 });
  try {
    const file = new URL('../.env', import.meta.url);
    if (process.platform !== 'win32' && (statSync(file).mode & 0o077)) throw new Error('Permissions');
    const credentials = loginCredentials(parseEnv(readFileSync(file, 'utf8')));
    const configFile = new URL('../.env.authorization', import.meta.url);
    let values = {};
    try {
      const info = statSync(configFile);
      if (process.platform !== 'win32' && (info.mode & 0o077)) throw new Error('Permissions');
      values = parseEnv(readFileSync(configFile, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const config = authorizationConfig(values);
    const { chromium } = await import('playwright-core');
    session = {
      runId: randomUUID(), startedAt: new Date().toISOString(),
      mode: 'platform-authorization-browser-backed', users: 1, contextType: 'unspecified',
      ...config, origin: authorizationOrigin, endpoint: authorizationPath,
      setupExcluded: true, backendCacheControlled: false, measuredAutomaticRetries: 0,
      bootstrapBackgroundRequestsControlled: false,
      runner: { node: process.version, platform: process.platform, architecture: process.arch },
    };
    report = new URL(`../results/authorization-${session.runId}.json`, import.meta.url);
    markdown = new URL(`../results/authorization-${session.runId}.md`, import.meta.url);
    mkdirSync(new URL('../results/', import.meta.url), { recursive: true, mode: 0o700 });
    writeFileSync(report, '{}\n', { flag: 'wx', mode: 0o600 });
    persist();
    stage = 'browser_launch';
    browser = await chromium.launch({ channel: 'chrome', headless: false });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    stage = 'login';
    await page.goto(authorizationOrigin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('input[name="session[password]"]').waitFor({ state: 'visible', timeout: 60000 });
    if (new URL(page.url()).origin !== 'https://login-sandbox.imedidata.net' ||
        await page.locator('input[name="session[username]"]').count() !== 1 ||
        await page.locator('button[type="submit"]').count() !== 1) throw new Error('Login origin/form');
    await page.locator('input[name="session[username]"]').fill(credentials.ANALYTICS_USERNAME);
    await page.locator('input[name="session[password]"]').fill(credentials.ANALYTICS_PASSWORD);
    if (new URL(page.url()).origin !== 'https://login-sandbox.imedidata.net') throw new Error('Login origin');
    console.log('Complete MFA in the new Chrome window if requested. Do not interact after login.');
    await Promise.all([
      page.waitForURL((url) => url.origin === authorizationOrigin,
        { waitUntil: 'domcontentloaded', timeout: 240000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    stage = 'application_bootstrap';
    const responsePromise = page.waitForResponse((response) =>
      response.url() === authorizationOrigin + authorizationPath &&
      response.request().method() === 'POST', { timeout: 90000 });
    const [response] = await Promise.all([
      responsePromise,
      page.goto(authorizationOrigin + '/apps/Analytics/dashboards',
        { waitUntil: 'domcontentloaded', timeout: 90000 }),
    ]);
    const body = response.request().postDataJSON();
    authorizationRequest(body);
    if (await response.finished()) throw new Error('Bootstrap response failed');
    bootstrap = authorizationResponse(response.status(), response.headers()['content-type'],
      await response.text());
    if (!bootstrap.passed) throw new Error('Bootstrap contract failed');
    if (new URL(page.url()).origin !== authorizationOrigin) throw new Error('Unexpected origin');
    console.log(`Setup complete; measuring ${config.samples} sequential authorization request(s).`);
    stage = 'authorization_samples';
    measurements = await runAuthorizationSamples(page, body, config, (measurement) => {
      measurements.push(measurement);
      persist();
      console.log(`Sample ${measurement.sequence}: ${measurement.reason}, ${measurement.elapsedMs.toFixed(0)} ms.`);
    });
    success = authorizationSummary(measurements, config.samples).complete;
    if (!success) failureStage = stage;
  } catch {
    failureStage = stage;
    console.error(`Authorization probe failed at ${stage}; raw details withheld. No retry.`);
  } finally {
    for (const resource of [context, browser]) {
      try {
        if (resource) await resource.close();
      } catch {
        success = false;
        failureStage = 'browser_cleanup';
        console.error('Could not verify browser shutdown.');
      }
    }
    if (report) {
      try {
        session.finishedAt = new Date().toISOString();
        persist();
        writeFileSync(markdown, authorizationMarkdown(session, measurements, success),
          { flag: 'wx', mode: 0o600 });
        console.log(`Authorization report: ${fileURLToPath(markdown)}`);
      } catch {
        success = false;
        console.error('Could not finalize authorization evidence; run is incomplete.');
      }
    }
    if (!success) process.exitCode = 1;
  }
}

await main();
