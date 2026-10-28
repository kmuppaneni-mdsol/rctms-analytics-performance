import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('k6 Chrome captures full-body timings, overlapping requests, iframe traffic and errors on loopback only', { timeout: 45000 }, async () => {
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.end('<!doctype html><body>Local API fixture</body>');
    } else if (request.url === '/frame') {
      response.end('<!doctype html><script>fetch("/widget?iframe=true",{method:"POST",' +
        'body:JSON.stringify({operationName:"LoadContextBook"})}).then(r=>r.text()).then(()=>parent.frameDone=true)</script>');
    } else if (request.url.includes('disconnect')) {
      request.socket.destroy();
    } else {
      response.writeHead(request.url.includes('fail') ? 500 : 200,
        { 'Content-Type': 'application/json', 'x-request-id': 'local-response-id' });
      response.write('{"private":"');
      setTimeout(() => response.end('PRIVATE_BODY"}'), request.url.includes('reload') ? 1000 : 200);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let child;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    child = spawn('k6', ['run', '--quiet', '--log-format=json', '--log-output=stdout',
      fileURLToPath(new URL('./experience-api-fixture.js', import.meta.url))], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
        K6_BROWSER_HEADLESS: 'true', FIXTURE_ORIGIN: origin },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const exit = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(exit, 0, output);
    const emitted = output.split('\n').filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line)).find((line) => line.msg?.startsWith('LOCAL_API '));
    assert.ok(emitted, output);
    const { records, capture } = JSON.parse(emitted.msg.slice('LOCAL_API '.length));
    assert.equal(capture.collectionErrors, 0, output);
    assert.equal(capture.complete, false); // Deliberate transport failure.
    assert.equal(records.length, 30, output);
    const reloadRequest = records.find((r) => r.action === 'journey_setup');
    assert.ok(reloadRequest);
    // k6 currently emits no terminal event for the request aborted by page.reload.
    // Accept a future runtime that reports the cancellation, but never invent RTT.
    assert.ok(['failed', 'incomplete'].includes(reloadRequest.state));
    if (reloadRequest.state === 'incomplete') {
      assert.equal(reloadRequest.elapsedMs, null);
      assert.equal(reloadRequest.completionReason, 'no_terminal_event_after_reload');
    }
    assert.equal(records.filter((r) => r.state === 'failed' && r.action !== 'journey_setup').length, 1);
    const auth = records.find((r) => r.phase === 'platform_authorization');
    assert.equal(auth.traceId, '1234567890abcdef1234567890abcdef');
    assert.equal(auth.responseRequestId, 'local-response-id');
    assert.equal(auth.action, 'dashboard_open');
    assert.ok(auth.elapsedMs >= 180, JSON.stringify(auth));
    assert.equal(records.filter((r) => r.action === 'filter_apply').length, 3);
    assert.equal(records.filter((r) => r.status === 500).length, 1);
    assert.ok(records.filter((r) => r.state === 'completed').every((r) => r.elapsedMs >= 180));
    assert.doesNotMatch(JSON.stringify({ records, capture }), /PRIVATE|cookie|variables/);
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
