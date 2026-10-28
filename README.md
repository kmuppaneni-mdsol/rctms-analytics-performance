# Medidata Analytics performance testing

This project provides **k6-based performance and rendering checks for Medidata
Analytics dashboards embedded in ThoughtSpot**. It includes authenticated
single-user browser journeys, local browser fixtures, a browser-backed platform
authorization API probe, and an optional fixed-size ThoughtSpot Liveboard REST
API smoke test.

Dashboard rendering checks use k6's Chromium integration. The authorization-only
API probe uses Playwright Core with installed Google Chrome to retain a normal
authenticated browser session without exporting cookies. Existing functional
automation is outside this repository's scope.

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

k6 is a separate executable. Existing k6 workflows and offline unit tests need
no npm packages. For the authorization probe, install its pinned Playwright Core
dependency with `npm ci`; no browser download is needed (installed Google Chrome
is used).

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

## Platform authorization API probe

This is a separate **API Response** scenario for
`POST /api/analytics/portfolio/authenticate`, not an extension of the
ThoughtSpot-token-only liveboard test and not a dashboard-rendering measurement.

The endpoint needs platform authentication, not a ThoughtSpot token. This probe
uses the normal headed login/MFA flow with the credentials in owner-only `.env`.
It opens the Analytics list once to obtain the application's own authorization
request in **unspecified portfolio context** (no study group or client selected).
It validates that bootstrap response, then issues sequential authorization
requests using `fetch` inside the same browser session. It does not copy session
cookies into an HTTP client, replay HAR credentials, persist browser state, or
save returned tokens. Login/MFA and bootstrap authorization are setup and are
excluded from measured sample RTT.

```sh
npm ci
npm run api:authorization
```

**Obtain explicit approval before running this live command.** By default it
performs application bootstrap (including authorization) plus **three measured**
authorization POSTs, sequentially, with one second between successful samples.
Application bootstrap can make other background requests and application-managed
retries; their number is not controlled by this probe. This is not an
isolated service load generator. Authorization can synchronize ThoughtSpot
memberships and issue tokens. The probe does not load a selected dashboard,
render charts, export data, or invoke the liveboard REST data endpoint.

Optionally create an ignored, owner-only `.env.authorization`:

```dotenv
AUTH_SAMPLES=3
AUTH_INTERVAL_MS=1000
AUTH_TIMEOUT_MS=60000
```

```sh
chmod 600 .env.authorization
```

Bounds are 1–5 measured samples, 1,000–10,000 ms between samples, and
1,000–90,000 ms per request. Measured requests have no automatic retries or
redirects; the first failed contract/transport/timeout stops sampling. Ambiguous
concurrent authorization observations and origin changes also stop the probe.
Complete MFA in the
new Chrome window, then leave it untouched. The origin is fixed to sandbox.
Preflight, setup and collection failures produce explicit failed/incomplete
outcomes; they are not performance samples.

The contract requires JSON/HTTP 200, portfolio viewer access, nonempty eligible
study groups, a nonempty token, and consistent per-operation resource metadata.
A 200 zero-access fallback, missing token, malformed authorization, or empty
authorization list fails. No particular study-group UUID or operation count is
hard-coded. Empty datasource lists are allowed by the platform response type;
this is an authorization contract, not proof of available dashboard data.

Sanitized `results/authorization-<run-id>.json` and `.md` reports contain:

- Per-sample UTC start, RTT through complete decoded body receipt, fetch-to-header
  time, body-receipt time, HTTP status, and contract result.
- UTF-8 request and decoded response byte sizes, not compressed wire sizes.
- Request traceparent and response request ID when available; missing IDs are
  explicit `null`, not invented.
- Report ID (the run UUID used in both filenames), per-sample trace ID extracted
  from the observed traceparent, and the sandbox CloudWatch log group
  `/aws/lambda/sandbox-pfui-analytics-api-getPortfolioAuthorizations` in
  `us-east-1`. Markdown includes a correlation table with UTC request starts and
  a Logs Insights query template. Log-group metadata comes from sandbox
  infrastructure naming; the probe does not query AWS to verify logs.
  Response request IDs are not assumed to be Lambda invocation IDs.
- Aggregate counts and successful-sample min/mean/max, with the first and
  subsequent samples distinguishable in JSON. Failures are not included in
  successful-latency aggregates.

The first measured request is **not cold authorization**: bootstrap already ran.
Browser/backend cache state and Lambda cold starts are uncontrolled. Do not call
these few samples a percentile, SLA, or baseline. Do not add these API times to
the browser experience total, where authorization is already included when it
runs. Outbound Dalton/ThoughtSpot service timings require separately correlated
logs or traces.

Offline and loopback validation (no application login):

```sh
node --test test/authorization-api.test.js test/authorization-runner.test.js
npm run test:authorization-syntax
npm run test:authorization-local
```

The loopback test uses headless installed Chrome and synthetic local session
data only. It checks full-body RTT, byte sizes, session use, contract failure,
redirect rejection, timeout, and stop-on-first-failure behavior.

## Reports and reference data

Generated reports are written to the ignored `results/` directory. Reports
record sanitized measurements and outcomes; inspect failure status and
completion evidence before using any numbers. Incomplete runs and failed
actions are not successful performance samples.

### Same-session API evidence in the User Experience report

`npm run dashboard:experience` writes a brief performance summary in Markdown
and full sanitized evidence in its JSONL companion. It passively observes
the existing browser session; it sends no probe requests and does not change
application retries. Login authentication/MFA is not platform authorization.
The Markdown contains only the report/session UUID, UTC window, initial-widget
readiness, overall coverage and filter timings, four key API phases, capture
quality, and platform trace IDs with CloudWatch log-group links. It omits
per-scroll timings, runtime metadata, other-API tables and full request lists.
Response request IDs are also omitted from the brief Markdown report.
All that evidence remains in JSONL, linked from the summary.

The API table compares dashboard-open calls with the whole session (including
bootstrap, setup, traversal and filters). Each shows observed call count and
slowest completed browser RTT in seconds; HTTP error responses are included.
Groups with no observed requests show "not observed", never zero-second latency.
Failed UI durations are not presented as successful completion times.
There is no separate Snowflake metric: downstream data-query work is included
in the ThoughtSpot widget response, without isolating database execution time.

The allowlist covers portfolio authorization, dashboard definition, ThoughtSpot
GraphQL and non-telemetry Callosum/REST API routes on the known sandbox hosts.
Known GraphQL operations identify dashboard-session and widget-data calls;
other operations are grouped separately. Static assets and login traffic are
excluded. HTTP 200 does not establish GraphQL/application success: response
bodies are not read by this observer.

Request evidence includes UTC request-event start, request-event-to-completion
timing when available (full response, including event-dispatch overhead),
HTTP/completion status, valid observed trace ID and allowlisted response request
ID. Platform requests link to the known `us-east-1` CloudWatch Lambda groups,
with a Logs Insights trace-search template. The report does not query AWS,
verify log availability or equate response request IDs with Lambda invocation
IDs. ThoughtSpot IDs have no assumed platform CloudWatch mapping.

Missing IDs/timings and collection errors are explicit. Requests still in flight
at capture end remain incomplete. The API-capture status is separate from the
UI readiness result; a UI pass does not imply complete API evidence. UUID
lists, tokens, cookies, full URLs, queries, variables and response bodies are
not retained.
Headers are taken from browser event snapshots, without waiting for optional
raw-header events. Missing correlation headers are unavailable, not collection
errors. Native request start times disambiguate concurrent identical requests;
matching claims a request synchronously before any asynchronous metadata work.
Response-object lookups have a two-second deadline, and final API draining has
a five-second deadline. A timeout preserves available evidence and marks the
capture incomplete instead of waiting indefinitely. Sanitized diagnostic
counts distinguish request metadata, matching, response metadata, request-limit
and drain-timeout errors. Terminal status messages distinguish API finalization
from subsequent browser cleanup.
The installed k6 browser runtime can omit both completion and failure events
for an in-flight fetch interrupted by page reload (covered by the loopback
test). Unresolved calls already outstanding at reload are labeled
`no_terminal_event_after_reload`; other unresolved calls are labeled
`no_terminal_event_at_capture_end`. These are missing lifecycle evidence,
not inferred HTTP success, cancellation, timeout or measured RTT. A capture
can therefore have zero collector errors yet remain incomplete. Missing
correlation headers are also not evidence that the underlying service lacks
tracing.

API durations are already within the observed experience, can overlap, and must
not be added to UI totals. Browser RTT is not Lambda execution, Dalton time or
Snowflake query time. The standalone `api:authorization` workflow remains
separate and does not supply these same-session measurements.

Offline checks (no application login or AWS access):

```sh
node --test test/experience-api.test.js test/experience-report.test.js
npm run test:experience-api-local
```

The browser check uses k6, installed headless Chrome and loopback fixtures only.

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
- Do not bypass SSO/MFA or replay captured HAR credentials or session identifiers.
  The authorization probe uses a normal login and same-origin browser requests;
  it never posts login credentials to the authorization API or exports cookies.
- Do not store credentials, tokens, cookies, raw response bodies, or sensitive
  tenant data in source control or reports.
- Browser rendering, REST response timing, and server-side/database performance
  are distinct measurements. This project does not claim server telemetry,
  backend query latency, data freshness, or a performance SLA.
