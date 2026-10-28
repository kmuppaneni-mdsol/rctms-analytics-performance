import { browser } from 'k6/browser';
import { Counter } from 'k6/metrics';
import { probeDashboard } from '../lib/dashboard-probe.js';
import { checkDashboardWidget } from '../lib/widget-readiness.js';
import { guidedDiscovery } from '../lib/guided-discovery.js';
import { runJourney } from '../lib/journey.js';
import { journeyPlan } from '../lib/journey-plan.js';
import { runFilter } from '../lib/filter.js';
import { observeExperienceApi } from '../lib/experience-api.js';

const confirmed = new Counter('analytics_route_confirmed');
const loginHost = 'login-sandbox.imedidata.net';
const usernameSelector = 'input[name="session[username]"]';
const passwordSelector = 'input[name="session[password]"]';
const manualMfa = __ENV.ANALYTICS_MANUAL_MFA === 'true';
const inspectDashboard = __ENV.ANALYTICS_INSPECT_DASHBOARD === 'true';
const checkWidget = __ENV.ANALYTICS_CHECK_WIDGET === 'true';
const discoverJourney = __ENV.ANALYTICS_GUIDED_DISCOVERY === 'true';
const timedJourney = __ENV.ANALYTICS_TIMED_JOURNEY === 'true';
const openJourney = __ENV.ANALYTICS_OPEN_JOURNEY === 'true';
const filterTest = __ENV.ANALYTICS_FILTER_TEST === 'true';
const inspectFilter = __ENV.ANALYTICS_INSPECT_FILTER === 'true';
const experience = __ENV.ANALYTICS_EXPERIENCE === 'true';
const plan = timedJourney || filterTest ? journeyPlan(JSON.parse(open('../reference/dashboard-ui-inventory.json'))) : [];
const probeCompleted = new Counter('dashboard_probe_completed');
const widgetRendered = new Counter('dashboard_widget_rendered');
const discoveryCompleted = new Counter('guided_discovery_completed');
const journeyCompleted = new Counter('dashboard_journey_completed');
const filterCompleted = new Counter('dashboard_filter_completed');

export const options = {
  scenarios: {
    single_user_login: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: timedJourney ? '30m' : filterTest ? '12m' : discoverJourney ? '22m' : inspectDashboard || checkWidget ? '9m' : manualMfa ? '5m' : '2m',
      gracefulStop: '5s',
      options: { browser: { type: 'chromium' } },
    },
  },
  thresholds: {
    analytics_route_confirmed: ['count==1'],
    ...(inspectDashboard ? { dashboard_probe_completed: ['count==1'] } : {}),
    ...(checkWidget ? { dashboard_widget_rendered: ['count==1'] } : {}),
    ...(discoverJourney ? { guided_discovery_completed: ['count==1'] } : {}),
    ...(timedJourney ? { dashboard_journey_completed: ['count==1'] } : {}),
    ...(filterTest ? { dashboard_filter_completed: ['count==1'] } : {}),
  },
};

export default async function () {
  confirmed.add(0);
  if (inspectDashboard) probeCompleted.add(0);
  if (checkWidget) widgetRendered.add(0);
  if (discoverJourney) discoveryCompleted.add(0);
  if (timedJourney) journeyCompleted.add(0);
  if (filterTest) filterCompleted.add(0);
  if (!__ENV.ANALYTICS_USERNAME || !__ENV.ANALYTICS_PASSWORD) {
    throw new Error('Credentials missing; use npm run login:poc.');
  }
  const page = await browser.newPage(timedJourney || filterTest ? { viewport: { width: 1280, height: 720 } } : {});
  const api = experience ? observeExperienceApi(page,
    (record) => console.log(`EXPERIENCE_API ${JSON.stringify(record)}`)) : null;
  let stage = 'opening_login';
  try {
    if (timedJourney || filterTest) {
      const metadata = await page.evaluate(function () {
        const match = navigator.userAgent.match(/(?:HeadlessChrome|Chrome)\/(\d+\.\d+\.\d+\.\d+)/);
        if (!match) throw new Error('Chromium version unavailable.');
        return { version: match[1], devicePixelRatio };
      });
      console.log(`JOURNEY_BROWSER ${JSON.stringify(metadata)}`);
    }
    await page.goto(
      'https://home-sandbox.imedidata.net/apps/Analytics/dashboards?dashboardId=f9431c78-169f-442d-8f9e-61f8bc0ee73c',
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );
    await page.locator(passwordSelector).waitFor({ state: 'visible', timeout: 20000 });
    stage = 'validating_form';
    const hostname = await page.evaluate(function () { return location.hostname; });
    if (hostname !== loginHost ||
        await page.locator(usernameSelector).count() !== 1 ||
        await page.locator(passwordSelector).count() !== 1 ||
        await page.locator('button[type="submit"]').count() !== 1) {
      throw new Error('Unexpected login origin or form; credentials were not submitted.');
    }
    stage = 'filling_form';
    await page.locator(usernameSelector).fill(__ENV.ANALYTICS_USERNAME);
    await page.locator(passwordSelector).fill(__ENV.ANALYTICS_PASSWORD);
    if (await page.evaluate(function () { return location.hostname; }) !== loginHost) {
      throw new Error('Login origin changed; submission stopped.');
    }
    stage = 'submitting_login';
    if (manualMfa) console.log('LOGIN_POC_STATUS manual_mfa_window');
    // Register the navigation wait before clicking; DOM polling loses its context on redirects.
    await Promise.all([
      page.waitForURL(
        /^https:\/\/home-sandbox\.imedidata\.net\/apps\/Analytics(?:\/|[?#]|$)/,
        { waitUntil: 'domcontentloaded', timeout: manualMfa ? 180000 : 45000 }
      ),
      (async () => {
        await page.locator('button[type="submit"]').click();
        console.log('LOGIN_POC_STATUS credentials_submitted');
        stage = 'waiting_for_analytics';
      })(),
    ]);
    confirmed.add(1);
    console.log('LOGIN_POC_STATUS analytics_route_confirmed');
    if (inspectDashboard) {
      stage = 'probing_dashboard';
      await probeDashboard(page);
      probeCompleted.add(1);
    }
    if (checkWidget) {
      stage = 'checking_widget';
      await checkDashboardWidget(page);
      widgetRendered.add(1);
    }
    if (discoverJourney) {
      stage = 'discovering_journey';
      await guidedDiscovery(page);
      discoveryCompleted.add(1);
    }
    if (timedJourney) {
      stage = 'running_journey';
      console.log('LOGIN_POC_STATUS journey_started');
      api?.action('journey_setup');
      await runJourney(page, plan, { reload: openJourney, onAction: api?.action });
      journeyCompleted.add(1);
      console.log('LOGIN_POC_STATUS journey_complete');
    }
    if (filterTest) {
      stage = 'running_filter';
      console.log('LOGIN_POC_STATUS filter_started');
      api?.action('filter_setup');
      await runFilter(page, plan[0], {
        inspectFailure: inspectFilter, target: __ENV.ANALYTICS_STUDY_GROUP,
        onAction: api?.action,
      });
      filterCompleted.add(1);
      console.log('LOGIN_POC_STATUS filter_complete');
    }
  } catch {
    console.log(`LOGIN_POC_STATUS ${stage}_failed`);
    throw new Error('Single-user login did not complete; raw details withheld to protect credentials and session data.');
  } finally {
    try {
      if (api) {
        console.log('LOGIN_POC_STATUS api_capture_finalizing');
        console.log(`EXPERIENCE_API_CAPTURE ${JSON.stringify(await api.finish())}`);
        console.log('LOGIN_POC_STATUS api_capture_finalized');
      }
    } finally {
      await page.close();
    }
  }
}
