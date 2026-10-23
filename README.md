# Medidata Analytics performance testing

This project provides **k6-based performance and rendering checks for Medidata
Analytics dashboards embedded in ThoughtSpot**. It includes authenticated
single-user browser journeys, local browser fixtures, and an optional,
fixed-size ThoughtSpot Liveboard REST API smoke test.

Browser checks use k6's Chromium integration rather than a separate
Playwright-based performance suite. Existing functional automation is outside
this repository's scope.

## Project status and scope

- A four-tab, read-only browser journey verifies rendered widgets and scrolling.
- A guarded Study Group workflow applies one configured filter, checks the
  refresh and widget readiness, then restores and verifies the original
  selection.
- A combined browser run performs authenticated reload, the tab/scroll journey,
  and filter apply/reset in one session.
- The Liveboard API smoke validates the response contract for 30
  visualizations. Its optional six-VU profile makes six requests using one
  shared identity; it is not six independent browser users or a sustained load
  test.
- Local fixture tests cover rendering, reports, failure handling, and API
  response validation without accessing the dashboard.

These workflows are not an established service-level objective or capacity
test. Browser timing includes automation and readiness polling; API timing is
client-observed. A successful response contract does not prove data correctness
or freshness. Recent API results contained empty visualizations, so they should
not be interpreted as populated-data performance. Browser runs have also
produced incomplete failures; consult each run's report rather than treating a
partial run as a successful measurement.

## Requirements

- Node.js 18+ for the dependency-free offline tests.
- Node.js 22.3+ for the local credential/API runners.
- k6 with browser support and Chrome/Chromium for browser workflows.
- k6 for the API loopback integration test.

k6 is a separate executable; no npm dependency installation is required.

## Offline validation

```sh
npm test
npm run test:syntax
```

Local browser fixtures use inline HTML and do not log in to the application:

```sh
npm run smoke:local
npm run smoke:widget-local
npm run smoke:journey-local
npm run smoke:discovery-local
npm run smoke:filter-local
```

The API implementation has dependency-free unit coverage in `npm test`. Its
k6-backed loopback integration test can be run separately:

```sh
npm run test:api-local
npm run test:api-syntax
```

## Authenticated browser workflows

Create a local, ignored `.env` file with the following fields, then restrict
its permissions:

```dotenv
ANALYTICS_USERNAME=your-username
ANALYTICS_PASSWORD=your-password
```

```sh
chmod 600 .env
```

The runner reads the file as dotenv data, passes credentials only to the child
process, and does not print them. Credentials remain plaintext on disk; use an
organization-approved secret manager where available.

After approval for a single-user sandbox run, use the Node runner:

| Command | Workflow |
| --- | --- |
| `npm run login:poc` | Submit the normal login form and verify Analytics navigation. |
| `npm run login:mfa` | Login with a visible browser and allow human-assisted MFA. |
| `npm run dashboard:inspect` | Inspect dashboard structure after login. |
| `npm run dashboard:smoke` | Check one known rendered widget. |
| `npm run dashboard:discover` | Capture guided, non-performance UI observations. |
| `npm run dashboard:journey` | Run the timed tab and scroll journey. |
| `npm run dashboard:open-journey` | Time authenticated reload, then run the journey. |
| `npm run dashboard:filter` | Run guarded filter apply and isolated reset. |
| `npm run dashboard:filter-inspect` | Run filter workflow with a bounded visual-inspection pause on failure. |
| `npm run dashboard:experience` | Run reload, journey, and filter apply/reset in one session. |

The discovery and browser workflows require a headed browser. Complete any MFA
challenge directly in that browser. MFA is not automated. Do not retry a failed
login or start additional live tests without approval.

Filter and combined workflows also require a local, ignored `.env.filter`:

```dotenv
ANALYTICS_STUDY_GROUP=exact displayed option name
```

```sh
chmod 600 .env.filter
```

The selected value is kept out of source code, console output, and reports.
The filter workflow uses the exact configured option, checks that it is unique,
and restores only that selection. It does not use the dashboard-wide
“Restore to default” control.

## Liveboard REST API smoke

The API workflow is a separate, opt-in test of
`POST /api/rest/2.0/metadata/liveboard/data`. Configure a verified ThoughtSpot
Cloud origin, Liveboard GUID, and short-lived Bearer token in a local,
ignored `.env.api` file:

```dotenv
TS_HOST=https://your-verified-host.thoughtspot.cloud
LIVEBOARD_ID=your-liveboard-guid
TS_TOKEN=
```

Restrict the file permissions with `chmod 600 .env.api`. Alternatively, provide
`TS_TOKEN` through a secure process environment; an environment value overrides
the file. Never put secrets in command-line arguments, chat, tracked files, or
shell history.

```sh
npm run api:liveboard
npm run api:liveboard:burst
```

The first command makes exactly one POST. The burst command makes six
per-Virtual-User requests, one per VU, concurrently under the same identity.
Both use a fixed request shape, make no retries or redirects, and require
explicit approval before live execution. Use the Node runner; do not invoke
`scripts/liveboard-api.js` directly against a live host. The runner validates
the destination and response, filters output, and writes sanitized reports.

The contract checks HTTP status, JSON shape, Liveboard identity, 30 unique
visualization IDs, and consistent row/column counts. A contract pass is not a
data-quality check or a latency threshold. An all-empty response is reported as
empty and must not be presented as representative populated-data performance.

## Reports and reference data

Generated reports are written to the ignored `results/` directory. Reports
record sanitized measurements and outcomes; inspect failure status and
completion evidence before using any numbers. Incomplete runs and failed
actions are not successful performance samples.

- [Dashboard UI inventory](reference/dashboard-ui-inventory.json): observed
  widget titles across four tabs; used by the browser journey.
- [Dashboard request inventory](reference/dashboard-inventory.json): historical
  browser-visible request findings, not a required request-count contract.

To aggregate exactly three complete, compatible journey reports:

```sh
npm run dashboard:baseline-report -- path/to/run-1.jsonl path/to/run-2.jsonl path/to/run-3.jsonl
```

The aggregate rejects incomplete or incompatible runs. Three samples are only
a small reference and do not establish percentiles, an SLA, regression, or
controlled service-side conditions.

## Safety and interpretation

- A sandbox endpoint does not itself authorize load. Obtain approval for live
  traffic, including the target, account, scope, request count, and stop
  conditions.
- Do not start concurrency, increase workload, or repeat live requests without
  explicit approval.
- Do not bypass SSO/MFA or use captured HAR requests, session identifiers, or
  browser credentials as API authentication.
- Do not store credentials, tokens, cookies, raw response bodies, or sensitive
  tenant data in source control or reports.
- Browser rendering, REST response timing, and server-side/database performance
  are distinct measurements. This project does not claim server telemetry,
  backend query latency, data freshness, or a performance SLA.
