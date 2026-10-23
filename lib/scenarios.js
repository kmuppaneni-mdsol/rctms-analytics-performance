export function localSmokeOptions() {
  return {
    scenarios: {
      local_browser_smoke: {
        executor: 'shared-iterations',
        vus: 1,
        iterations: 1,
        maxDuration: '30s',
        options: {
          browser: {
            type: 'chromium',
          },
        },
      },
    },
    thresholds: {
      checks: ['rate==1'],
    },
  };
}
