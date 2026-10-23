import { sleep } from 'k6';
import { dashboardWidget } from './dashboard-probe.js';
import { widgetState } from './widget-state.js';

export async function checkDashboardWidget(page, frameSelector) {
  const tile = await dashboardWidget(page, frameSelector);
  const deadline = Date.now() + 60000;
  let state;
  do {
    state = await tile.evaluate(widgetState);
    if (state === 'ready') {
      console.log('LOGIN_POC_STATUS widget_rendered');
      return;
    }
    if (state === 'error' || state === 'no_data') {
      console.log(`LOGIN_POC_STATUS widget_${state}`);
      throw new Error('Widget cannot satisfy the rendered-data contract.');
    }
    sleep(0.2);
  } while (Date.now() < deadline);
  console.log('LOGIN_POC_STATUS widget_render_timeout');
  throw new Error('Widget rendering timed out; no data values were logged.');
}
