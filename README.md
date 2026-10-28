# Medidata Analytics performance testing

k6-based browser and API checks for Medidata Analytics dashboards embedded in
ThoughtSpot. Browser workflows use k6's Chromium integration; the
authorization-only probe uses Playwright Core with installed Google Chrome.

## Requirements and offline checks

- Node.js 18+ for offline tests; Node.js 22.3+ for local runners.
- k6; browser workflows and browser-backed fixtures also need Chrome/Chromium.
- Run `npm ci` to install the pinned Playwright Core dependency used by the
  authorization probe.

```sh
npm test
npm run test:syntax
npm run smoke:local
npm run smoke:widget-local
npm run smoke:journey-local
npm run smoke:discovery-local
npm run smoke:filter-local
```

API loopback tests use local fixtures and do not log in to the application:

```sh
npm run test:api-local
npm run test:authorization-local
npm run test:experience-api-local
```

## Browser workflows

Create a local, ignored `.env` and restrict access:

```dotenv
ANALYTICS_USERNAME=your-username
ANALYTICS_PASSWORD=your-password
```

```sh
chmod 600 .env
```

Credentials are passed only to the runner's child process, but remain
plaintext in the file. Use an approved secret manager when available.

| Command | Purpose |
| --- | --- |
| `npm run login:poc` / `npm run login:mfa` | Verify login; MFA is completed manually in the visible browser. |
| `npm run dashboard:inspect` / `npm run dashboard:smoke` | Inspect dashboard structure or check a rendered widget. |
| `npm run dashboard:discover` | Capture guided UI observations; not a performance measurement. |
| `npm run dashboard:journey` | Measure a read-only tab and scroll journey. |
| `npm run dashboard:open-journey` | Measure authenticated reload followed by the journey. |
| `npm run dashboard:filter` | Apply one configured filter, check readiness, and restore it. |
| `npm run dashboard:filter-inspect` | Allow bounded visual inspection if filter application fails. |
| `npm run dashboard:experience` | Combine reload, journey, and filter apply/reset in one session. |

Filter workflows also need an ignored `.env.filter`:

```dotenv
ANALYTICS_STUDY_GROUP=exact displayed option name
```

```sh
chmod 600 .env.filter
```

The value is not written to reports or console output. The filter workflow
checks that the option is unique and restores only that selection. Browser
workflows require a headed browser; MFA is not automated.

## API workflows

### ThoughtSpot Liveboard

The optional REST smoke checks
`POST /api/rest/2.0/metadata/liveboard/data`. Configure `.env.api` with a
verified host, Liveboard ID, and short-lived token; keep the file local and
restrict its permissions with `chmod 600 .env.api`.

```dotenv
TS_HOST=https://your-verified-host.thoughtspot.cloud
LIVEBOARD_ID=your-liveboard-guid
TS_TOKEN=
```

```sh
npm run api:liveboard
npm run api:liveboard:burst
```

The first command sends one request; the burst sends six concurrent requests
under one shared identity. Both use a fixed request shape, with no retries or
redirects. Use the runner, not `scripts/liveboard-api.js`, for live traffic.
The response contract checks status, shape, Liveboard identity, and 30 unique
visualizations. A contract pass does not prove data quality or populated-data
performance; empty results are reported as empty.

### Platform authorization

This separate probe checks
`POST /api/analytics/portfolio/authenticate` using the normal headed
login/MFA flow and `.env` credentials. It validates the application's
bootstrap authorization, then makes sequential requests in the same browser
session. It does not export cookies or save tokens. Bootstrap is setup, not a
measured sample.

```sh
npm run api:authorization
```

Obtain explicit approval before running either API workflow against a live
service. Authorization defaults to three measured requests, one second apart;
`.env.authorization` can set `AUTH_SAMPLES` (1–5), `AUTH_INTERVAL_MS`
(1,000–10,000), and `AUTH_TIMEOUT_MS` (1,000–90,000). Requests are not retried;
a failed contract, transport, or timeout stops sampling. The origin is fixed
to sandbox.

The authorization contract checks HTTP/JSON, viewer access, eligible study
groups, token presence, and consistent resource metadata. Passing it does not
prove dashboard data is available. Reports are sanitized and include sample
timings and trace correlation where available; AWS logs are not queried.

## Reports and interpretation

Reports are written to the ignored `results/` directory. The combined
experience workflow writes a concise Markdown summary and a JSONL companion
with sanitized request and action evidence. API observations are passive:
they add no requests and do not change application retries. Missing evidence
is reported as incomplete, separately from the UI result.

The browser journey checks rendered widgets across four tabs. The baseline
command aggregates exactly three complete, compatible journey reports:

```sh
npm run dashboard:baseline-report -- path/to/run-1.jsonl path/to/run-2.jsonl path/to/run-3.jsonl
```

These workflows are not a capacity test, SLA, or controlled baseline. Browser
timings include automation and readiness polling; API timings are
client-observed and can overlap with UI timings. Do not add them to UI totals
or interpret them as backend, Lambda, Dalton, or database execution time.
HTTP/contract success does not establish data correctness or freshness.

## Safety

- Get explicit approval for live traffic, including target, account, scope,
  request count, and stop conditions. Do not increase or repeat live workload
  without approval.
- Do not bypass SSO/MFA or replay HAR credentials/session identifiers.
- Never commit credentials, tokens, cookies, response bodies, or sensitive
  tenant data. Do not place secrets in command-line arguments or shell history.
- Inspect each report's completion and failure status before interpreting
  measurements. Failed or incomplete actions are not successful samples.

## Reference data

- [Dashboard UI inventory](reference/dashboard-ui-inventory.json): observed
  widget titles used by the browser journey.
- [Dashboard request inventory](reference/dashboard-inventory.json):
  historical browser-visible request findings, not a request-count contract.
