# Medidata Analytics performance testing

This project measures a single-user browser experience for Medidata Analytics
dashboards embedded in ThoughtSpot. The primary workflow captures dashboard
reload, a four-tab/scroll journey, filter apply/reset, and passive API timings
in one session.

## Capture dashboard performance

Requirements: Node.js 22.3+, k6 with browser support, and installed
Chrome/Chromium. Create a local, ignored `.env`:

```dotenv
ANALYTICS_USERNAME=your-username
ANALYTICS_PASSWORD=your-password
```

For the filter portion, create a local, ignored `.env.filter`:

```dotenv
ANALYTICS_STUDY_GROUP=exact displayed option name
```

Restrict both files to your account:

```sh
chmod 600 .env .env.filter
```

Then run the combined workflow:

```sh
npm run dashboard:experience
```

Complete MFA in the visible browser. The run reloads the dashboard, traverses
tabs and scroll positions, then applies and restores the configured filter.
Its report is written to the ignored `results/` directory as a brief Markdown
summary and a detailed JSONL companion. Review completion and failure status
before interpreting results.

**This is the only live command needed for the combined dashboard experience
capture.** Do not separately run the journey and filter commands for the same
capture. The API timings are passively observed in the same session; they do
not require separate authorization or Liveboard API probes.

Credentials remain plaintext in local files. Use an organization-approved
secret manager where available. Do not retry failed logins or repeat live runs
without approval.

## Other browser workflows

These are useful for testing one browser workflow in isolation, but are not
needed for the combined `dashboard:experience` capture:

- `npm run dashboard:journey` — tab/scroll journey without reload and filter.
- `npm run dashboard:open-journey` — reload and journey only.
- `npm run dashboard:filter` — guarded filter apply/reset only.
- `npm run dashboard:discover` — guided UI observations, not a performance
  measurement.

## API workflow tests

These are separate API workflows and should be run when validating
authorization or Liveboard API behavior. The combined dashboard capture's
passive API timings do not replace either test. Obtain explicit approval before
sending live traffic; do not increase or repeat workload without approval.

### Platform authorization

Uses the normal headed login/MFA flow and `.env` credentials from above. Install
dependencies with `npm ci`, then run:

```sh
npm run api:authorization
```

By default, the probe makes three sequential measured authorization requests
after application bootstrap. Optionally configure `.env.authorization`:

```dotenv
AUTH_SAMPLES=3
AUTH_INTERVAL_MS=1000
AUTH_TIMEOUT_MS=60000
```

It uses the sandbox origin, does not retry measured requests, and stops on a
failed contract or request. Authorization can synchronize memberships and
issue tokens. Reports contain sanitized timings and trace correlation where
available; the probe does not query AWS logs.

### ThoughtSpot Liveboard

Configure `.env.api` with a verified ThoughtSpot host, Liveboard ID, and
short-lived token. Restrict its permissions with `chmod 600 .env.api`:

```dotenv
TS_HOST=https://your-verified-host.thoughtspot.cloud
LIVEBOARD_ID=your-liveboard-guid
TS_TOKEN=
```

Run one request or the fixed six-request burst:

```sh
npm run api:liveboard
npm run api:liveboard:burst
```

Both use a fixed request shape and do not retry or follow redirects. The burst
sends six concurrent requests under one shared identity. The response contract
checks status, shape, Liveboard identity, and visualization coverage; it does
not prove data quality or populated-data performance. Use the Node runner for
live requests, not `scripts/liveboard-api.js` directly.

## Offline validation

Offline tests use local fixtures and do not log in to the application:

```sh
npm test
npm run test:syntax
npm run smoke:local
npm run smoke:widget-local
npm run smoke:journey-local
npm run smoke:discovery-local
npm run smoke:filter-local
npm run test:api-local
npm run test:authorization-local
npm run test:experience-api-local
```

## Reports and interpretation

Browser timings include automation and readiness polling. API timings are
client-observed, can overlap with UI timings, and are not backend, Lambda,
Dalton, or database execution times. Do not add them to UI totals. HTTP or
contract success does not establish data correctness or freshness; empty
visualization responses are not representative populated-data performance.
These workflows are not a capacity test, SLA, or controlled baseline.

To aggregate exactly three complete, compatible journey reports:

```sh
npm run dashboard:baseline-report -- path/to/run-1.jsonl path/to/run-2.jsonl path/to/run-3.jsonl
```

## Safety and reference data

- Obtain approval for live traffic, including target, account, scope, request
  count, and stop conditions.
- Do not bypass SSO/MFA or replay HAR credentials/session identifiers.
- Never commit credentials, tokens, cookies, response bodies, or sensitive
  tenant data.

- [Dashboard UI inventory](reference/dashboard-ui-inventory.json): observed
  widget titles used by the browser journey.
- [Dashboard request inventory](reference/dashboard-inventory.json):
  historical browser-visible request findings, not a request-count contract.
