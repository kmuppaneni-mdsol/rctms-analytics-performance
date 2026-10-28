import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { authorizationConfig, authorizationPath, runAuthorizationSamples } from '../lib/authorization-api.js';

test('local browser-backed authorization: session, bytes, full body RTT, stop conditions and redirects', async () => {
  const sg = '00000000-0000-0000-0000-000000000001';
  const response = {
    token: 'local-token-not-for-report', appPrivileges: { portfolio_analytics_viewer: true },
    eligibleSGUUIDs: [sg], authorizations: [{ read_visits: {
      availableSGUUIDs: [sg], datasourceGroup: 'fixture', dataSources: [],
    } }],
  };
  let mode = 'success';
  let posts = 0;
  let redirected = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'fixture_session=local; HttpOnly; SameSite=Strict' });
      res.end('<!doctype html><title>Local authorization fixture</title>');
      return;
    }
    if (req.url === '/redirect') { redirected++; res.end('unexpected'); return; }
    if (req.url !== authorizationPath) { res.writeHead(404); res.end(); return; }
    posts++;
    let body = '';
    for await (const chunk of req) body += chunk;
    assert.equal(req.method, 'POST');
    assert.ok(req.headers.cookie?.includes('fixture_session=local'));
    assert.equal(JSON.parse(body).contextType, 'unspecified');
    if (mode === 'redirect') { res.writeHead(302, { Location: '/redirect' }); res.end(); return; }
    if (mode === 'timeout') {
      req.socket.once('close', () => res.destroy());
      return;
    }
    const status = mode === 'http_error' ? 500 : 200;
    res.writeHead(status, { 'Content-Type': 'application/json',
      'x-request-id': 'local-correlation-id' });
    const payload = JSON.stringify(mode === 'zero_access' ?
      { ...response, token: null, eligibleSGUUIDs: [] } : response);
    const split = Math.floor(payload.length / 2);
    res.write(payload.slice(0, split));
    setTimeout(() => res.end(payload.slice(split)), 80);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const body = { contextType: 'unspecified', contextUUID: '',
      displayName: 'Synthetic üser', userLocale: 'eng' };
    const config = authorizationConfig({ AUTH_SAMPLES: '2', AUTH_TIMEOUT_MS: '1000' });
    const emitted = [];
    const measurements = await runAuthorizationSamples(page, body, config, (m) => emitted.push(m));
    assert.equal(posts, 2);
    assert.equal(measurements.length, 2);
    assert.ok(measurements.every((m) => m.passed && m.elapsedMs >= 60 && m.receiveMs >= 60));
    assert.equal(measurements[0].requestBodyBytes, Buffer.byteLength(JSON.stringify(body)));
    assert.equal(measurements[0].responseDecodedBytes, Buffer.byteLength(JSON.stringify(response)));
    assert.equal(measurements[0].responseRequestId, 'local-correlation-id');
    assert.ok(!JSON.stringify(emitted).includes(response.token));
    for (const [next, reason] of [
      ['http_error', 'http_status'], ['zero_access', 'zero_access'],
      ['redirect', 'transport_or_redirect'], ['timeout', 'timeout'],
    ]) {
      mode = next;
      const before = posts;
      const failed = await runAuthorizationSamples(page, body, config, () => {});
      assert.equal(posts - before, 1);
      assert.equal(failed.length, 1);
      assert.equal(failed[0].passed, false);
      assert.equal(failed[0].reason, reason);
    }
    assert.equal(redirected, 0);
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
