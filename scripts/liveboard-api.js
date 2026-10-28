import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { liveboardBody, liveboardPath, liveboardResponse } from '../lib/liveboard-api.js';

const completed = new Counter('liveboard_api_smoke_completed');
if (__ENV.LIVEBOARD_PROFILE && !['single', 'burst6'].includes(__ENV.LIVEBOARD_PROFILE)) {
  throw new Error('Unsupported API workload profile.');
}
const burst = __ENV.LIVEBOARD_PROFILE === 'burst6';
const users = burst ? 6 : 1;
export const options = {
  scenarios: { api_smoke: { executor: 'per-vu-iterations', vus: users, iterations: 1,
    maxDuration: '90s', gracefulStop: '5s' } },
  thresholds: { liveboard_api_smoke_completed: [`count==${users}`],
    http_reqs: [`count==${users}`], http_req_failed: ['rate==0'] },
  maxRedirects: 0,
  systemTags: ['status', 'method', 'name', 'scenario', 'expected_response'],
};

export default function () {
  completed.add(0);
  if (!__ENV.TS_HOST || !__ENV.LIVEBOARD_ID || !__ENV.TS_TOKEN) {
    throw new Error('API configuration missing; use the local API runner.');
  }
  const started = Date.now();
  const response = http.post(__ENV.TS_HOST + liveboardPath, liveboardBody(__ENV.LIVEBOARD_ID), {
    headers: { Authorization: `Bearer ${__ENV.TS_TOKEN}`, 'Content-Type': 'application/json',
      Accept: 'application/json' },
    redirects: 0, timeout: '60s', tags: { name: 'liveboard_data' },
  });
  const finished = Date.now();
  const result = liveboardResponse(response.status, response.headers['Content-Type'], response.body,
    __ENV.LIVEBOARD_ID);
  console.log('LIVEBOARD_API_RECORD ' + JSON.stringify({
    ...result, status: response.status, elapsedMs: finished - started,
    ...(burst ? { vu: __VU, startedAtMs: started, finishedAtMs: finished } : {}),
    durationMs: response.timings.duration, blockedMs: response.timings.blocked,
    connectingMs: response.timings.connecting, tlsMs: response.timings.tls_handshaking,
    sendingMs: response.timings.sending, waitingMs: response.timings.waiting,
    receivingMs: response.timings.receiving,
  }));
  if (!result.passed) throw new Error('Liveboard API smoke failed; raw details withheld.');
  completed.add(1);
  console.log(burst ? `LIVEBOARD_API_COMPLETE ${__VU}` : 'LIVEBOARD_API_COMPLETE');
}
