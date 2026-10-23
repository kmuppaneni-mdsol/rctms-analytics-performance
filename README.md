# RCTMS Analytics performance

## Resume here

**Last handoff: 2026-10-21. Status: first combined single-user experience passed (23/23 actions, 30/30 widgets, original selection restored). Latest requested rerun failed during authenticated reload after 10.64s; no traversal/filter actions ran. Both reports are preserved; failure cause not captured. Not an SLA or concurrency baseline. Global Restore to default is out of scope.**

The goal is concurrent, real-browser E2E performance testing of Medidata Analytics
dashboards embedded through ThoughtSpot. The user chose **k6 browser**, not a
separate Playwright performance suite, to avoid implementing the same journey
twice. Existing pytest/Playwright functional automation remains unchanged.

### Combined single-user experience

```sh
npm run dashboard:experience
```

This separate mode runs authenticated reload, the full four-tab main-scroll
journey, then Study Group apply/reset in the same browser session. Complete
manual MFA, then leave the browser untouched. The existing local `.env` and
owner-only `.env.filter` are required; target names never appear in reports.
The first-tab return and filter setup are untimed. Filter setup returns to that
tab before attaching to its expected charts, including when traversal ended on
Download. This mode uses the existing one-user/one-iteration browser scenario
and both strict journey/filter completion thresholds.

Owner-only ignored `results/experience-<id>.jsonl` evidence and its `.md`
readable companion are produced automatically, including failed/incomplete runs
when the runner reaches finalization. Report-generation failure is explicit and
fails the runner. Journey and filter records retain separate sequence numbers;
the readable report lists them in execution order. Both summaries and completion
markers, browser metadata, a successful process and exactly one valid initial
reload are required for success. Neither phase can substitute for the other.
The Markdown report shows each action, action-group sums, widget coverage,
restoration and runtime/host context. It does not expose raw browser output.

Successful action timings exclude login/MFA, setup, choosing filter options and
post-render checkbox verification. Their sum is not wall-clock user journey
time. Reload/traversal use the cross-navigation host clock; filter uses host
`performance.now()` for durations only, without cross-clock subtraction.
Traversal polls at 200ms, filter at 100ms plus the existing DOM observer.
Coverage describes the unfiltered traversal; filtering checks six initial
widgets, not all offscreen charts. Caches and host conditions are uncontrolled.
No backend freshness, percentile, SLA or concurrency claim is made from one
run. Drill-downs, nested-table scrolling, exports and saved settings remain
outside this implemented scope. Separate earlier reports are not merged into a
pretend single-session result.

Local validation includes combined runner success, failed filter with successful
reset, missing reload and missing filter evidence; these retain honest failed
outcomes. The browser fixture reloads and traverses distinct tabs before
returning to filter apply/reset in the same page. All 34 filter/combined browser
checks passed. The report's sums, incomplete outcome and excluded timings have
offline tests.

**First combined live run passed (2026-10-21):**

- [Readable performance report](results/experience-829480b0-4923-4f53-83b8-12acb10f4b27.md)
- [Validated raw evidence](results/experience-829480b0-4923-4f53-83b8-12acb10f4b27.jsonl)

| Measurement | Result |
| --- | --- |
| Authenticated reload to six initial widgets ready | 17.65s |
| Four-tab warm traversal: 4 switches + 16 scroll checkpoints | 57.54s summed action durations |
| Study Group apply | 6.19s |
| Isolated reset | 3.80s |
| All measured actions | 23/23 passed; 85.18s summed durations |
| Dashboard coverage | 30/30 widgets; bottom reached on all four tabs |
| Original selection | Verified restored |

The slowest individual traversal actions were entry to Download (12.44s) and
CRA-tab scroll checkpoint 4 (7.15s); these are follow-up candidates, not proven
backend bottlenecks. The run began with approximately 1299 MiB free host memory
and load averages 4.18/4.43/4.26, so host pressure is a possible measurement
confounder. Do not claim a regression by comparing this one combined run to the
earlier non-contiguous three-run warm reference.

The process exited zero and the browser closed. Independent validation
recomputed both summaries, confirmed one reload, all action shapes, full
coverage, verified restoration, exact regeneration of the readable report and
owner-only permissions on both files. Offline validation before the run passed
28 tests and syntax checks; the combined/filter browser suite passed 34 checks.
No additional live run was made. Next, if approved, repeat the same combined
workload under comparable host conditions before drawing performance
conclusions or planning concurrency.

**Requested rerun (2026-10-21): FAIL / INCOMPLETE**

- [Readable rerun report](results/experience-ba876d8f-3df6-445b-af30-8576a13697c6.md)
- [Raw rerun evidence](results/experience-ba876d8f-3df6-445b-af30-8576a13697c6.jsonl)

Login reached Analytics, but authenticated reload failed after 10.64 seconds.
This is elapsed time to failure, not a successful dashboard completion latency.
The sanitized record does not identify the precise cause; no timeout diagnostic
snapshot was emitted. Tab/scroll traversal and filter actions never ran, so
zero coverage means not tested, not 30 broken widgets. No filter change was
performed; restoration is marked not measured. The browser closed and no
automatic retry was made. Both files, failed outcome, missing filter actions,
recomputed summary and exact report regeneration were independently verified.

Start free host memory was about 202 MiB with load averages 6.87/5.07/4.35,
versus 1299 MiB and 4.18/4.43/4.26 in the successful run. These differing host
conditions are potential confounders, not an established cause of failure.
Keep the earlier successful report unchanged; do not use 10.64 seconds as an
improvement over its 17.65-second completed reload.

This is a standalone local project. No remote repository, commit, dependency
installation, or live traffic was authorized for the scaffold phase.

### Current implementation

- [Local smoke](scripts/local-smoke.js): one browser iteration rendering inline
  HTML; no application URL, login, remote assets, or intentional external requests.
- Local runtime verification: k6 v2.3.0 on macOS arm64; the local browser smoke
  passed. This does not verify dashboard access, authentication, iframe behavior,
  or widget readiness.
- [Scenario configuration](lib/scenarios.js): local smoke only, not a load profile.
- [Offline tests](test/scaffold.test.js): scenario and inventory consistency.
- [Login inspection](scripts/inspect-login.js): observed the normal sandbox form
  at `login-sandbox.imedidata.net`, using `session[username]`,
  `session[password]`, and a submit button. No credential values are inspected.
- [Single-user login](scripts/login-poc.js) and its
  [local runner](scripts/run-login-poc.js): one headed browser iteration, using
  the local credentials through the normal form, without automatic retries.
  The corrected redirect-aware run reached the Analytics route successfully.
- [Credential tests](test/local-credentials.test.js): required-field validation,
  special-character preservation, output filtering, and runner failure behavior.
- [Widget discovery](lib/dashboard-probe.js): attach to the known ThoughtSpot
  iframe and inspect structural metadata without logging widget data.
- [Rendered-widget check](lib/widget-readiness.js) and
  [DOM predicate](lib/widget-state.js): validate the exact expected heading,
  visible Highcharts data points, and cleared loading/error signals.
- [Local iframe fixtures](scripts/dashboard-probe-local.js): positive and negative
  rendering cases, with a suite-completion threshold to catch browser errors
  even when k6 itself returns exit code zero.
- [HAR inventory](reference/dashboard-inventory.json): non-secret findings,
  captured operation counts, tab coverage, and widget names. It is a reference,
  not a contractual assertion that every future load must issue 16 requests.
- [Live UI inventory](reference/dashboard-ui-inventory.json): 30 widget titles
  observed across four tabs in a completed guided discovery session. This
  complements, rather than rewrites, the historical HAR inventory.

**Not verified:** cold-cache/first-ever dashboard-open readiness, chart interactions, data-value
correctness, filters, and live error/no-data states. API
instrumentation, workload ramping, and performance SLAs are not implemented.
Partial action timing reports exist but do not establish a performance baseline.

## Timed read-only journey (first live validation passed)

```sh
npm run dashboard:journey
```

### Authenticated reload and separate journey (first live validation passed)

```sh
npm run dashboard:open-journey
```

This separate opt-in mode first completes credential login and manual MFA. It
attaches to the dashboard, selects the first tab and resets its main scroll
position as untimed setup. It then measures `dashboard_open` from immediately
before the browser reload command until the reloaded dashboard's six expected
first-viewport widgets all pass the shared rendered-data readiness check. The
iframe is reacquired after navigation; the initial viewport must be at the top.
There are no post-reload tab clicks or scroll corrections inside this metric.
A different restored tab, missing widgets, loading, errors or no data fail rather
than being corrected into success.

The host clock uses `performance.timeOrigin + performance.now()` across the
document replacement so the timestamp does not reset at reload. Timing includes
navigation, iframe attachment, readiness polling and automation overhead; it
excludes login/MFA and setup. This is **authenticated reload to first-viewport
readiness**, not first-ever navigation, cold-cache loading, backend-only time,
or readiness of offscreen widgets. Browser/service caches remain uncontrolled.

After this action, the existing untimed second-tab setup and full warm-session
tab/scroll journey run separately. The report labels `dashboard_open` separately;
that action cannot satisfy traversal coverage. The runner requires exactly one
passed reload observation with the six expected initial widgets and top position,
as well as the normal full-journey completion gates. Partial/failed reports are
retained. The original `dashboard:journey` mode is unchanged, and the three-run
baseline aggregator rejects this different mode rather than mixing its timings.

Local validation passes 15 offline tests, syntax checks and 23 browser checks,
including a real host-document reload, iframe reattachment and subsequent full
fixture traversal.

The approved live validation passed on 2026-10-21:

- **Authenticated reload to initial-viewport readiness: 15.58s**, with all six
  expected widgets verified and main scroll position zero.
- **Separate warm tab/scroll journey: 20/20 actions passed**, all 30 widgets
  verified, bottom reached on all four tabs. Sum of these action durations:
  **41.18s**, excluding the reload observation.
- Saved evidence:
  [journey-469f5868-f4f3-4bd4-80e8-6035d0e1acef.jsonl](results/journey-469f5868-f4f3-4bd4-80e8-6035d0e1acef.jsonl).
  The persisted schema, initial widget set, zero top position, separate traversal
  coverage and owner-only permissions were independently verified.

This is one successful reload measurement, not a reload baseline, cold-cache
result or SLA assertion. It has not been added to the earlier three-run warm
baseline. Next scope choices are repeated reload measurements or session-only
filter apply/reset discovery; neither is automatically authorized by this run.

This opt-in mode uses the same credential handling and manual MFA, one user,
one iteration, and a fixed 1280x720 browser viewport. After MFA, do not interact
with the browser while automation is running. It visits the four discovered tabs
in inventory order and moves the main dashboard scroller by 80% of its viewport
height at each checkpoint, up to 40 scroll actions per tab. It does not scroll
inside tables, change filters, drill down, save settings, or initiate exports.
The Download tab is checked only for rendered Summary Table content.

Before timing, it selects the second tab as an unmeasured setup step, then times
the switch to the first tab. All four measured tab entries are therefore real
tab-switch actions. These are **warm-session tab and scroll measurements**, not
first dashboard-open latency or cold-cache measurements. The initial widget set
for each tab is explicit in [journey-plan.js](lib/journey-plan.js), derived from
discovery. A full initial-dashboard-open measurement remains a separate step.

Each checkpoint waits for all intersecting widget containers to have a positive
render signal and no scoped loading/error/no-data marker. Charts require rendered
Highcharts points; AG Grid requires populated body cells (headers do not count);
pivots require populated data-area cells. Text/values are inspected only as
booleans, never returned or logged. Partially visible edge widgets may have their
data below the viewport: they must still have rendered data nodes. These
generalized contracts have passed local fixtures and one live traversal of all
30 inventoried widgets. Unknown renderers fail rather than being skipped.

The journey must reach the bottom and verify all expected titles in each tab:
16 + 4 + 9 + 1 = 30. Missing or unexpected widgets, loader timeouts, no data,
errors, stalled scrolling, or incomplete coverage fail the run. The operational
readiness timeout is 60 seconds, not a performance SLA. Polling is every 200 ms,
so timings include polling and browser automation overhead.

Action timings use the stable host document's monotonic `performance.now()`;
login/MFA is excluded. Per-widget `readyAfterMs` is the first observed rendered
state after that tab/scroll action, not network latency or a fresh backend query.
The local JSONL report contains the run scope, widget-index mapping, action
durations, per-widget observations, coverage, failure samples, and final outcome.
Successful-only min/max/mean summaries explicitly include failure counts; a
single run does not establish percentiles or a repeatable baseline. Reports are
ignored and owner-only, under `results/journey-<id>.jsonl`; partial runs are
preserved and must not be treated as success.

### Live validation findings

- First attempt stopped after six initial charts: a nonoverflowing outer
  `overflow:auto` wrapper was incorrectly selected as the main scroller. The
  selector now requires actual overflow; the nested-wrapper regression fixture
  passes.
- The corrected attempt selected the overflowing dashboard container
  (580px viewport, 3432px content) and passed the first tab switch and two scroll
  checkpoints, verifying 10 of the first tab's 16 widgets.
- Scroll checkpoint 3 timed out after approximately 60 seconds on
  **Visit Summary (Cumulative) by Study**, reported as `missing_cells`. Prior
  discovery confirms a DevExtreme pivot renderer, but the exact cause is not
  established: missing cells, visibility, and a selector/layout variant still
  need to be distinguished. This is not evidence of a 60-second application
  performance regression.
- The failed report is preserved locally at
  [journey-1b21946c-1e5b-4ec6-90ce-496d55f592b3.jsonl](results/journey-1b21946c-1e5b-4ec6-90ce-496d55f592b3.jsonl).
  The first tab switch took about 2.29 seconds; the two successful scroll actions
  took about 2.17 and 2.07 seconds. These are partial warm-session observations,
  not full-journey results.
- Future timeout diagnostics include the actual checkpoint, scroll geometry,
  and validated numeric counts for pivot areas, cells, visibility and population.
  No cell text or values are returned. Readiness has not been relaxed; header-only,
  empty, and hidden data still fail. Another live attempt requires user approval
  and manual MFA.
- The approved diagnostic retry reproduced the same checkpoint failure:
  **731 table cells existed, 686 were visible, but zero `.dx-area-data` elements
  matched**. This establishes that the current pivot-area selector does not
  describe the rendered table; it does not establish that its data cells are
  ready. See
  [journey-a8bb7057-bd42-40ff-a976-d79c1a7f513f.jsonl](results/journey-a8bb7057-bd42-40ff-a976-d79c1a7f513f.jsonl).
  The successful actions were approximately 2.14s, 1.86s and 2.06s.
- Counts alone did not identify the correct data-area selector. Diagnostics now
  additionally retain up to 40 distinct pivot structural signatures, restricted
  to DIV/TABLE/TR/TD tags and `dx-` vendor class tokens. No text, attributes,
  cell values or arbitrary application classes are included. This addition is
  locally tested before the next approved structural inspection.
- The structural inspection captured `TD dx-area-data-cell` in the actual pivot,
  not `.dx-area-data`. Evidence:
  [journey-0c2bf7bf-cfa5-4094-b4fc-da0c77f199ea.jsonl](results/journey-0c2bf7bf-cfa5-4094-b4fc-da0c77f199ea.jsonl).
  Readiness and numeric diagnostics now share selectors for both layouts and
  require a populated visible descendant data cell, never the data-area wrapper
  itself. Local regression fixtures include the observed nested-table layout,
  populated headers outside the data area, and hidden fake-table cells.
  The corrected selector was then submitted for an approved live validation.
- The approved corrected-selector validation **passed all 16 first-tab widgets**
  (charts, pivots and AG Grid) and all seven scroll checkpoints, reaching the
  bottom. The initial tab switch took about 2.16s; successful scrolls ranged
  from 0.27s to 3.50s. The previously blocked pivot checkpoint passed in 3.28s.
  Evidence:
  [journey-beb50d92-f68e-4467-b39a-39f18920c330.jsonl](results/journey-beb50d92-f68e-4467-b39a-39f18920c330.jsonl).
- That run then failed the **Site Communication Summary** tab switch: both
  initial charts reported `missing_points` after 60s. Historical guided discovery
  saw points in both charts, but this run did not verify qualifying rendered
  series points. The cause is not established; the failure must not be
  reclassified as success or an application performance regression. Full
  coverage remains 16/30, with no second-tab passed action and no third/fourth-tab
  measurements.
- Timeout diagnostics now also count chart roots, all points, series points,
  visible points and qualifying drawn points. These are numeric structural
  counts only, with no SVG paths, labels or values. Chart readiness is unchanged.
  No further live login was attempted after the second-tab failure.
- The next approved diagnostic run found **18 and 6 visible chart points** in
  the second-tab charts, but **zero points under `.highcharts-series`**. The
  extra series-ancestor requirement caused this readiness failure. Evidence:
  [journey-1dd5e5b4-92bf-4821-9a09-b07079725242.jsonl](results/journey-1dd5e5b4-92bf-4821-9a09-b07079725242.jsonl).
  The first tab again passed all 16 widgets and reached the bottom.
- Chart readiness now checks `.highcharts-point` within the actual Highcharts
  SVG root without requiring a series-class ancestor. It still requires visible
  nonzero geometry and nonempty path data, excludes legend/tooltip descendants,
  and rejects loading/error/no-data states. Regression fixtures cover direct-root
  points, hidden points, empty paths, points outside the chart root, and
  legend/tooltip-only points. This correction requires live validation.

### First complete live validation

The approved corrected-chart run completed successfully on 2026-10-21:

| Tab | Verified widgets | Tab switch | Scroll actions | Sum of measured action durations |
| --- | --- | --- | --- | --- |
| Monitoring Visits Summary and Metrics | 16/16 | 2.19s | 7 | 16.28s |
| Site Communication Summary | 4/4 | 1.11s | 2 | 9.21s |
| CRA Monitoring Visit Metrics | 9/9 | 2.45s | 6 | 17.97s |
| Download (render only, no export) | 1/1 | 7.65s | 1 | 7.91s |

All four tabs reached the bottom. All 20 actions passed (four tab switches and
16 scroll checkpoints), with zero failed actions. The persisted outcome and
coverage were independently revalidated through the report schema and summary.
The successful report is
[journey-f7fef026-647c-4934-95af-21aef8a0d981.jsonl](results/journey-f7fef026-647c-4934-95af-21aef8a0d981.jsonl).
Earlier failed reports remain unchanged.

The **sum of measured action durations was 51.37s**, not initial page-load time
or login-to-finish wall time. Authentication, MFA, untimed setup and gaps between
actions are excluded. Cache state is uncontrolled; repeated viewport checks can
be fast because content is already rendered. The slowest action was the Download
tab switch (7.65s); the slowest scroll was on Site Communication Summary (5.29s).
These are observations from one validation, not SLA failures or a stable baseline.

Next: capture browser/runtime and runner conditions, agree repetition count and
comparison criteria, and collect repeated single-user measurements. Initial
dashboard-open timing, filters/drill-downs and concurrency require separate
implementation and validation; no exports were initiated.

### Three-run baseline (completed, non-contiguous provisional reference)

The user approved three sequential repetitions with fresh browser sessions and
manual MFA. Runtime capture and [baseline aggregation](lib/baseline-report.js)
are implemented. Each new journey report records Node/k6 versions, OS release,
architecture, logical CPU count, total/free memory, system load averages, browser
user-agent version and device pixel ratio. No host name, username, process list
or credentials are captured. Chrome's user-agent version can be reduced:
these runs reported `156.0.0.0`; the installed Chrome version observed before
the batch was `156.0.8078.48`.

| Repetition | Result | Sum of measured action durations |
| --- | --- | --- |
| 1 | 30/30 widgets, 20/20 actions, all tabs reached bottom | 42.73s |
| 2 | 30/30 widgets, 20/20 actions, all tabs reached bottom | 46.38s |
| 3 (resumed after recovery) | 30/30 widgets, 20/20 actions, all tabs reached bottom | 46.67s |

Retained evidence:

- [Repetition 1](results/journey-a3ea04e5-35b8-42b2-9456-f4d160dc6045.jsonl).
- [Repetition 2](results/journey-2997b0c4-cdb5-4a03-b71f-de81cf0df5b7.jsonl).
- [Successful resumed repetition 3](results/journey-ef5fa4b0-7816-4a57-ae05-ea9cc64fea80.jsonl).
- [Interrupted repetition 3](results/journey-e12baea8-5c00-47c3-8089-dac1b7343857.jsonl).
  The process tree was stopped at the user's request. This file has no final
  outcome and no dashboard measurements, so it is incomplete and cannot count
  toward the baseline. Do not rewrite it as success.

Shared recorded conditions: Node v24.1.0, k6 v2.3.0, macOS arm64 / Darwin
25.6.0, 12 logical CPUs, 36 GiB total memory, 1280x720 viewport and device pixel
ratio 1. Free memory and load varied and are recorded per run. Other machine
workload, service-side cache and data changes are not controlled. These remain
warm-session actions despite each repetition starting a fresh browser.

After user-confirmed recovery, the remaining repetition passed. All three runs
have matching recorded runtime/configuration and identical action checkpoints.
The aggregate was generated with:

```sh
npm run dashboard:baseline-report -- \
  results/journey-a3ea04e5-35b8-42b2-9456-f4d160dc6045.jsonl \
  results/journey-2997b0c4-cdb5-4a03-b71f-de81cf0df5b7.jsonl \
  results/journey-ef5fa4b0-7816-4a57-ae05-ea9cc64fea80.jsonl
```

The summary command requires exactly three successful, complete, chronological,
nonoverlapping runs with matching runtime/configuration, inventory and action
checkpoints. It independently validates coverage rather than trusting an outcome
flag. A changed browser/k6/runtime or journey shape rejects comparison; do not
silently discard a failed run or relax checks. A substantial pause or changed
service conditions must be disclosed; use a new approved batch if a contiguous
baseline is needed.

The owner-only ignored JSON output includes source report paths, per-run
conditions, per-action/tab statistics, and three-run min/median/max/mean for
measured action totals. It does not claim percentiles, an SLA, or initial
dashboard-load timing.

The saved [three-run report](results/baseline-49da44c6-cd35-4219-baa2-48ae183b0ec4.json)
is a **provisional, non-contiguous reference**, not a controlled contiguous
baseline. Run 3 started 55m15s after run 2 finished, following the reported Okta
outage; the report explicitly records that interruption. The stopped attempt is
preserved and excluded, not converted into a successful run.

Across the three successful runs, all 60 actions passed and all 30 widgets were
verified in each run. Sum of measured action durations: min **42.73s**, median
**46.38s**, max **46.67s**, mean **45.26s**. These totals exclude authentication,
MFA, setup and between-action gaps.

| Tab | Median tab-switch duration |
| --- | --- |
| Monitoring Visits Summary and Metrics | 2.08s |
| Site Communication Summary | 1.15s |
| CRA Monitoring Visit Metrics | 2.56s |
| Download (render only) | 7.01s |

The Download tab switch was consistently the slowest tab entry, but no SLA or
backend bottleneck is inferred. Host free-memory snapshots also differed
materially (about 2.28 GiB, 3.04 GiB and 0.21 GiB respectively); these snapshots
are not full memory-pressure measurements. Service/cache conditions and competing
machine workload remain uncontrolled, so the variation cannot be attributed
solely to the dashboard.

Authenticated reload timing has since passed one live validation (see above),
separately from these warm tab/scroll metrics. Filters, drill-downs, exports and
concurrency remain outside this completed scope.

Offline validation:

```sh
npm run smoke:journey-local
```

This exercises chart/grid/pivot readiness, fixed scrolling, tab switching,
monotonic action measurement, negative rendering states, nested-scroller
selection, and privacy-safe pivot diagnostics with inline HTML.
Both observed pivot and chart variants now pass the complete live journey.
Current checks pass: 23 local browser checks, 15 offline tests, and syntax checks.
Browser/runtime versions and runner resources must also be recorded before
baseline comparisons.

## Local checks

Node.js 18+ is sufficient for the dependency-free offline tests:

```sh
npm test
npm run test:syntax
```

With k6 and Chrome/Chromium installed, validate the widget predicate offline:

```sh
npm run smoke:widget-local
```

This uses inline iframe fixtures only; no application login or `.env` is used.

No npm install is needed. k6 is a separate executable, not an npm dependency.

The local runtime was verified with k6 v2.3.0 on macOS arm64 and the
inline-HTML smoke:

```sh
k6 version
npm run smoke:local
```

The `k6/browser` API is asynchronous. Record and pin the actual validated k6 and
browser versions before introducing CI. Normal credential submission and
subsequent Analytics navigation, human-assisted MFA, iframe DOM access, and one
rendered chart have been verified. Fully non-interactive MFA is not implemented.
A standard browser can perform background activity of its own;
the local smoke does not navigate to any service.

Do not use CLI overrides to turn this smoke into a load test. It exercises only
local HTML and says nothing about dashboard capacity.

## Single-user credential login experiment

Requires Node.js 22.3+ for its built-in dotenv parser, k6, and Chrome/Chromium.
The offline tests still support Node.js 18+; the runner integration test skips
on versions without the dotenv parser.

Populate the git-ignored `.env` locally with `ANALYTICS_USERNAME` and
`ANALYTICS_PASSWORD`. Use dotenv quoting for values containing `#` or whitespace;
the runner parses the file as data, never as shell commands. Restrict permissions
with `chmod 600 .env`.

After approval for a single-user sandbox login:

```sh
npm run login:poc
```

Use the Node runner, not a direct invocation of the browser script: the runner
passes only the required credentials as environment variables, removes inherited
k6 overrides/debug/output settings, and prints only predefined status messages.
It does not print raw browser errors, save screenshots, export session state, or
write raw results. Credentials remain plaintext in the local `.env` and are
accessible to the child process; this is not a substitute for a secret manager.
The browser closes when the iteration finishes or fails.

The script verifies the expected login hostname and observed form before
submission. It submits once, then waits up to 45 seconds for the Analytics route.
Reaching that route is not a rendered-widget or authorization assertion.
It does not automate MFA, SSO redirects, or retries.

For a separately approved human-assisted MFA attempt:

```sh
npm run login:mfa
```

This explicit mode leaves the headed browser available for up to three minutes
after submission while waiting for Analytics navigation. If prompted, enter
the current code from your Okta Verify app and click Submit directly in the
browser. Never send codes through chat or put them in `.env`. The script does
not inspect or generate the code, alter "Remember this device", or export session
state. Direct navigation without an MFA prompt is also accepted; reaching the
route does not prove MFA was challenged or widgets rendered. Default
`npm run login:poc` retains its 45-second navigation timeout.

The first assisted attempt on 2026-10-20 submitted credentials once but did not
confirm Analytics navigation and exited unsuccessfully. The user requested stop;
no further attempts were made. MFA completion and the failure cause remain
unverified. Resume only when requested.

**Observed runs, 2026-10-20:** the first attempt did not confirm Analytics
navigation; the user subsequently corrected the username. A second attempt also
reported unconfirmed navigation. Local HTML reproduction then demonstrated a
test bug: DOM-based polling can lose its execution context during a redirect.
The script was changed to register `waitForURL` before clicking submit.
The corrected single-user run submitted once, reached the Analytics route, and
exited successfully. Earlier failures are not evidence of rejected credentials
or an SSO requirement. No dashboard-rendering or performance result is claimed.

## Guided single-session discovery

### Study Group filter discovery (2026-10-21)

The user approved one session-only apply/reset discovery session and selected
**Study Group** on **Monitoring Visits Summary and Metrics**. The session
completed with two owner-only, validated captures in
[discovery-f337868c-58db-4bcc-9aee-90e03862b789.jsonl](results/discovery-f337868c-58db-4bcc-9aee-90e03862b789.jsonl):
`filter_applied`, then `filter_reset`. No initial-state capture was made.

User-confirmed control sequence (not an automated locator trace):

1. Click **Study Group Filter (Select)**.
2. In **Apply filters and parameters**, select the desired checkbox.
3. Click **Apply**. Checkbox selection alone is not the apply boundary.
4. User observed a loading indicator followed by changed chart results.
5. To reset, restore the original checkbox selection and click **Apply** again.
   The user confirmed this was done before the reset capture.

Both captures observed the six initial charts with no visible spinner or alert
at capture time. Their chart point counts were identical; counts do not encode
values, so this neither proves nor disproves changed results. The report does
not record checkbox state, selected values, control selectors, loading
transitions or timings. Capture labels are operator annotations, not automated
verification of filter state or fresh results. The session's successful outcome
means captures were saved and discovery finished, not that a performance test
or reset assertion passed.

### Targeted Study Group control inspection (2026-10-21)

The next approved assisted session saved five validated checkpoints:
initial viewport, popup open before changing selection, popup open after changing
selection, applied, and reset. Evidence:
[discovery-7e1b628f-ed7e-43b7-868c-3b07323358f3.jsonl](results/discovery-7e1b628f-ed7e-43b7-868c-3b07323358f3.jsonl).

The discovery snapshot now optionally includes `filterInspection`: a bounded
list of control kinds, structural CSS paths, enabled/disabled and checked/mixed
states where native/ARIA semantics exist. It recognizes the Study Group trigger
and the known popup's Apply/Cancel controls without returning option labels,
values, arbitrary text or attributes. The `filter_open` checkpoint label lets
the operator capture the popup before applying. Historical reports remain
unchanged. The snapshot and projection pass local browser fixtures and
privacy/validation tests (16 offline tests and five discovery browser checks,
plus syntax checks).

Live findings:

- A visible `role="dialog"` containing **Apply filters and parameters** was
  identified. Apply and Cancel were present and enabled in both popup captures.
- No visible native `input[type="checkbox"]` or `[role="checkbox"]` was found.
  **An empty checkbox list means unsupported/unobserved control semantics, not
  an empty selection.** A custom or visually hidden-input implementation needs
  targeted structural inspection before automated selection is safe.
- Structural paths changed when the popup opened (including body child
  positions). Do not hard-code these positional paths as stable replay locators.
- Opening the popup adds a selected **Include** tab alongside the selected
  dashboard tab. Future filter logic must scope dashboard-tab assertions;
  do not reuse a document-wide exactly-one-selected-tab assertion inside the
  popup.
- The user deviated from restoring the original checkbox selection: they used
  **Restore to default** at the bottom of the popup. It immediately closed the
  popup and restored the dashboard. The user confirmed this control resets
  **all filters**, not only Study Group, and that the session started at defaults.
  No pre-reset restored-selection capture exists. The reset checkpoint label
  is an operator annotation, not proof of exact original-state restoration.

Do not automate the global default reset for an isolated filter test. Preserve
all original state and restore only the changed Study Group selection through
Apply. The next inspection must establish the actual checkbox implementation and
an observable refresh lifecycle before implementing timed apply/reset. No filter
performance result or automated fresh-data/reset assertion is claimed.

### Hidden-checkbox and Apply-lifecycle inspection (2026-10-21)

The next approved assisted session completed eight captures in
[discovery-81fa35d1-c834-4a1a-b452-30d089c9ad1f.jsonl](results/discovery-81fa35d1-c834-4a1a-b452-30d089c9ad1f.jsonl).
The expanded probe records bounded structural signatures and checked/selected
booleans, including hidden inputs; option labels, input values and arbitrary
attributes are not returned.

**Observed option structure:**

```css
.checkbox-list-module__singleCheckboxItem
.checkbox-module__label
input.checkbox-module__nativeCheckbox
.checkbox-module__customCheckbox
```

The option-list item contains the custom label and hidden native checkbox. A
separate all-options control and a show-all-values toggle also exist, so a future
test must scope the option input to the single-option list item, not select the
first input in the dialog. These module-class selectors are observed candidates,
not yet live-validated automation locators; fail on ambiguous or missing matches.
Do not replay positional paths or assume option ordering/labels remain stable.

The first three popup captures showed one hidden option checked, unchecked, then
checked. The first popup capture was **after** the user's first click, not before.
After the second Apply, the final confirmation popup contained no checked options.
The user explicitly confirmed the changed option was originally unchecked,
finished unchecked after the second Apply, and no other options, Select all,
Include/Exclude or toggles were changed. This supports an operator-confirmed
isolated restoration; it is not a fully automated before/after assertion.

The observer was installed before interaction and captured two Apply clicks in
the known dialog. Both had visible widget loading followed by cleared loading
and chart/grid/pivot DOM mutations. It samples every 50ms and on DOM mutations,
keeps at most ten Apply observations, caps renderer mutations at 1,000,000, and
stops each observation after two minutes or the next Apply; the observer and
listener are removed on normal discovery completion. No response bodies,
requests, chart values or mutation contents are recorded.

**Important:** observation `elapsedMs` is time since Apply at the snapshot, often
including human delay; it is not a render-completion duration. Mutation counts
can include animation or unrelated render work. Loading/DOM activity alone
does not prove a new backend result or filter-to-result correlation, and a
spinner can be too brief to observe. These are lifecycle discovery signals,
not filter performance measurements or stale-data-proof completion.

Local fixtures reproduce the observed hidden-input/label layout, apply-triggered
loading/clearing and renderer mutation, a no-refresh Apply negative case, and
observer cleanup. Privacy/schema tests reject malformed or oversized records.
Next: implement guarded selection retaining the original option identity/state,
assert applied selection after reopening, correlate the refresh to Apply and
require the affected initial widgets ready, then restore and verify only the
original Study Group selection through Apply. Any live automation requires a
separately approved run; no additional login was attempted after this inspection.

### Guarded Study Group apply/reset (live validation incomplete)

```sh
npm run dashboard:filter
```

This opt-in mode is separate from discovery and the navigation/reload baselines.
It uses one user, a fresh browser, manual MFA and a fixed 1280x720 viewport. The
user initially approved choosing the first enabled unchecked rendered Study
Group option; this policy was superseded by exact local name selection after
visual inspection identified the unintended null option (see below).
It does not use global Restore to
default, change other filter controls, save a dashboard, export or run concurrency.

Untimed setup selects the first dashboard tab, resets its main scroll to the top,
and requires all six expected initial widgets ready. The exact dialog and trigger
must be unique. Options are scoped to the observed single-option list-item
wrapper; native checkbox state is read and its containing custom label is clicked.
Missing, ambiguous, mixed, duplicate-identity, disabled or unexpected controls
fail rather than using positional paths or guessing a selection.

Original rendered option identities, checked states and auxiliary checkbox/tab
states are kept only in iframe memory. Identities use local label text to survive
option reordering; none of that text is returned or logged. The test checks the
same rendered option set on reopening; changed or virtualized sets fail safely,
not as an empty selection. Offscreen/unrendered options cannot be inventoried by
this DOM-only contract. The aggregate Select-all state may derive from option
changes; the test never clicks it. Include/Exclude and other toggles must remain
unchanged.

Each Apply action is observed before its click and must produce a visible loading
cycle, renderer activity (including renderer-node replacement), closed popup,
and readiness of all six expected initial widgets. Reopening must verify the
expected persisted checkbox state before an action can pass. Dashboard selected
tab checks exclude hidden and dialog-scoped tabs such as Include.

`filter_apply` and `filter_reset` durations run from immediately before Apply
through the first qualifying ready observation. Choosing options, popup handling,
and the subsequent selection verification are excluded. Timings include browser
automation, a 100ms readiness poll and a lightweight 50ms/mutation-triggered DOM
observer. They are UI refresh lifecycle measurements, **not backend freshness,
query latency or a proof of changed values**; unrelated chart animation may
contribute mutations. Unchanged rendered charts alone, or renderer activity
without an observed loading cycle, cannot pass. A missed brief spinner causes
an explicit failure, not a success-shaped fallback. Timeout is 60s per condition,
not an SLA.

Restoration is attempted in a finally path even if apply/verification fails. Only
the chosen option is returned to its original unchecked state, applied, reopened
and verified alongside other rendered options/toggles. If identities or other
controls differ, restoration refuses to guess and reports failure. On failure,
review restoration status; a browser close is not evidence of restoration.
Observer/listener and in-memory identities are removed afterward. No extra
credential submissions or automatic login retries occur.

Validated `FILTER_RECORD` output projects action order, status, duration,
boolean verification evidence and bounded failure diagnostics into owner-only
ignored `results/filter-*.jsonl`.
The runner requires both passed actions, completion marker, browser metadata and
successful process; k6 has a strict filter-completion threshold. A failed apply
cannot be hidden by a successful cleanup reset. No chart values, study-group
identities, credentials or session state are saved.

```sh
npm run smoke:filter-local
```

Local fixtures exercise successful apply/reset, option reordering, stale charts,
missing loading, duplicate identities, no eligible option, no-data recovery and
identity-change refusal. Offline tests cover report gates, secret projection and
existing runner-mode compatibility. The delayed-option fixture also verifies
popup-content readiness. Additional fixtures exercise a missing expected widget,
an unexpected widget, missing chart points, a wrong selected dashboard tab and
nonzero scroll, while preserving isolated restoration. This implementation is
not a filter baseline.

The first approved live attempt failed during preparation before either Apply
timing began; both records have zero timed duration and no refresh evidence.
Evidence:
[filter-ea1cd0df-10bd-412d-979f-2ea00a2d3f35.jsonl](results/filter-ea1cd0df-10bd-412d-979f-2ea00a2d3f35.jsonl).
The original record did not identify the exact failed guard, so neither the root
cause nor restoration can be claimed from it. This is not an application latency
result. No automatic credential retry was made.

Before another attempt, the implementation now waits for popup option inputs and
labels to mount and popup loaders to clear; a delayed-option local fixture covers
that readiness gap. This is a verified local race correction, not a confirmed
explanation of the first live failure. Failure records additionally retain only
predefined preparation/apply/refresh/verification stages, guard reason codes and
whether original state had been captured. No raw exception, label or value is
logged.

The user separately approved one additional assisted validation:
[filter-a80f8083-2008-4527-ac12-f11c17743ee1.jsonl](results/filter-a80f8083-2008-4527-ac12-f11c17743ee1.jsonl).
This attempt reached Apply. Loading was observed and cleared, and renderer
activity was observed, but the six-widget readiness predicate did not pass within
60 seconds. The failed action lasted 60.44 seconds including polling overhead;
this is a timeout, not a successful dashboard completion measurement. No control
guard failed. The exact unmet readiness condition was not captured and remains
unresolved; do not infer a slow backend or stale results from this record.

The isolated reset then passed in 3.75 seconds, including loading/renderer/widget
readiness and subsequent verification of the original checkbox selection. The
outcome is `success: false`, `complete: false`, `restorationVerified: true`. The
browser closed and no additional login was attempted.

Failure diagnostics now preserve the last refresh observation **before reset**:
whether exactly one Apply was observed, whether the popup closed, scroll offset,
selected-tab count and whether the expected tab was selected, visible/unexpected
widget counts, and each expected initial widget's zero-based inventory position,
match count and readiness state. Missing or duplicate titles are reported as
`missing` or `duplicate`; other states distinguish loading, no-data/error,
missing chart points/table rows/pivot cells and unsupported renderers. The runner
prints one-based widget positions for readability. Only counts, indices,
booleans and predefined state codes are retained, never tab/widget titles,
option identities, chart values or raw exceptions. The last observation is
captured during refresh polling, not after reset has replaced the result.

Readiness still requires all expected widgets, the expected sole dashboard tab,
top scroll, and the existing loading/renderer/persisted-selection evidence.
Duplicate expected widgets now explicitly fail rather than being accepted as
independent matches. Error/no-data results still fail once the observed refresh
cycle has cleared; transient old no-data during reset is not mistaken for its
new result. These diagnostics do not establish the cause of the previous live
timeout retrospectively. Next: one separately approved assisted validation to
identify the unmet condition, without relaxing readiness or declaring backend
freshness. No live login was made while adding these diagnostics.

The user then approved one diagnostic validation:
[filter-3cdca394-2e12-4082-9a26-940989b46389.jsonl](results/filter-3cdca394-2e12-4082-9a26-940989b46389.jsonl).
Apply again timed out (60.39 seconds). This time the last observation identifies
the unmet predicate: all six expected widgets were present exactly once but
classified as `unsupported`. The selected dashboard tab and top scroll were
correct, with no unexpected visible widgets; one Apply, popup closure, loading
seen/cleared and renderer activity were observed. `unsupported` means no
recognized Highcharts SVG, AG Grid or pivot renderer was found in those tiles;
it is not proof of no data, an application error, or a slow backend.

Isolated reset passed in 3.61 seconds, including widget readiness and original
checkbox verification. Overall completion remains false; restoration is
verified. The browser closed without a retry. Next: bounded structural
inspection of the filtered tiles to distinguish an unrecognized result renderer
from an empty/error state not covered by current selectors. Do not treat
`unsupported` as ready or assume the same cause in prior runs. Any further
assisted login requires approval.

Bounded structural inspection is now implemented for failed refresh/verification
actions. After recording the failed action duration and before isolated reset,
it takes a separate viewport snapshot. Each uniquely matched expected widget
gets an element-only scan of at most 200 descendants, excluding its title box
and script/style/template subtrees. Counts cover visible SVG, canvas, iframe,
table, image, known renderer roots and alert/status/progress markers. A maximum
40-node preorder sample contains only predefined tag/role codes, capped depth,
visibility and a boolean for direct nonempty text. Unknown tags/roles map to
`other`. Scan/tree truncation is explicit; counts describe the scanned subset,
not an exhaustive inventory when truncated. Nested iframe contents are not read.
No text, HTML, classes, arbitrary attributes, URLs or image/canvas data are
returned or persisted. A missing/ambiguous widget has only its match count.

The `structureInspection` snapshot is distinct from the final readiness poll;
the DOM can change between them. It is diagnostic evidence only and never
changes success criteria or contributes to the measured duration. Inspection
failure is reported as `unavailable` with a predefined message, without
preventing the isolated restoration attempt. Historical reports without this
optional field remain valid. The runner projects and validates the field before
persisting it and prints only a bounded marker-count summary.

Validation: 11 targeted offline tests, 18 filter browser checks (16 apply/reset
scenarios plus privacy/shape and traversal-limit checks), 23 shared
journey/reload checks, and syntax checks passed. Both new unsupported-result
scenarios remained failed, retained distinct text-container/canvas shapes and
passed isolated reset. All 32 emitted action records passed report validation
without private fixture identities. No live login was made for this change.
Existing `unsupported` widgets remain failures until their actual result state
is understood and supported by evidence.

The user then approved one assisted structural diagnostic run:
[filter-1feca60d-c5a9-40b0-baaa-f3913381ea3a.jsonl](results/filter-1feca60d-c5a9-40b0-baaa-f3913381ea3a.jsonl).
Apply timed out in 60.19 seconds with the same six `unsupported` states.
Structural inspection succeeded before reset. Every tile had 49 scanned
descendants (31 visible), one visible SVG, and no visible known renderer root,
canvas, iframe, table, image, alert/status/progress marker. The element scan was
complete; its 40-node tree sample was truncated. An SVG alone could be an icon
and is not proof of a rendered chart. The structural evidence does not identify
an empty/error message or establish a backend cause; no text was captured.

Reset passed in 3.69 seconds and the original checkbox selection was verified.
Overall completion remains false and restoration is verified. The browser
closed and no retry was made. Before another live run, obtain human confirmation
of the filtered screen's state or define a focused, privacy-preserving
message/renderer inspection from verified UI evidence. Do not accept generic
SVG presence as readiness or automatically select a different option to make
the test pass.

A subsequent assisted visual session finished normally with one initial-viewport
capture:
[discovery-5249fb51-5527-4feb-90ad-6b14e2a96022.jsonl](results/discovery-5249fb51-5527-4feb-90ad-6b14e2a96022.jsonl).
The user confirmed no filter selection was changed in that session. Their
observation of charts therefore does not establish the filtered result's state.
No restoration was necessary. Repeating the full filter-discovery sequence was
unnecessary: the interaction is already implemented; the remaining investigation
is the result/readiness mismatch after automated Apply. Do not treat this
initial-view capture as new filtered-state evidence or a performance result.

For a targeted observation of the **automatically applied** result, use the
separate opt-in mode:

```sh
npm run dashboard:filter-inspect
```

It performs the same guarded choice and Apply, with the same strict failure
criteria and action reports. If Apply fails after selection was attempted, a
host-page inspection panel holds the result for up to three minutes, outside
the action timing. The operator observes only; no repeated discovery captures
or manual filter replay are needed. Click **Continue and restore original
selection** to resume isolated restoration sooner. Expiry, a failed panel, and
explicit continuation have separate predefined status messages; none changes
the failed action into a pass. Normal filter mode has no inspection pause.
The report session records `visualInspectionEnabled`; it does not infer a
human observation. Restoration is still attempted in the finally path.

Local validation for this addition: 11 targeted offline tests, 20 filter
browser checks and syntax checks passed, including panel continuation/expiry
cleanup and inspection-flag isolation. A full single-user test/report must
remain blocked until the filtered result and its completion predicate are
resolved; this inspection run is not that full test. Intended combined scope
is authenticated reload, four-tab main-scroll traversal and Study Group
apply/reset, not unimplemented drill-downs, nested-table scrolling or exports.

During the approved held inspection
([filter-fe337a1f-34b0-4f68-bd00-0ed56f98867a.jsonl](results/filter-fe337a1f-34b0-4f68-bd00-0ed56f98867a.jsonl)),
the user identified the workload error: the first-unchecked policy selected the
null option rather than the intended named group. Apply remained a failed
60.20-second timeout; the hold expired and isolated reset passed in 3.58 seconds.
The user chose exact-name matching instead of positional selection. This
identifies an unsuitable test selection, not evidence that the dashboard's
filtered data was ready or that no-data states should be accepted.

Filter modes now require `ANALYTICS_STUDY_GROUP` in owner-only ignored
`.env.filter` (permissions `600`). Use the exact displayed option name.
The target stays out of source-controlled files, command arguments, console
messages and reports. The runner reads it only for filter modes, does not inherit
an ambient target and passes only this validated field to k6. Missing/blank or
insecure local configuration stops before login. The chosen option must be
uniquely identified, enabled and unchecked; missing, disabled, already checked
or duplicate-identity targets fail without a fallback to a different option.
The original rendered selections remain the restoration contract.
The report stores only `selectionPolicy: exact-local-name`, not the name.

Local checks passed: 11 targeted offline tests, 23 filter browser checks and
syntax checks. A new fixture targets the third individual option while leaving
the first unchecked, then restores it; missing and disabled exact targets are
negative cases. Previous first-unchecked reports remain historical evidence and
must not be mixed with the new workload as a comparable filter baseline.
Next: approve one live exact-target apply/reset validation, then combine the
validated actions for the full single-user report.

The first approved exact-target attempt was stopped at the user's request after
Okta rejected a code:
[filter-1f7c2f2f-1322-4358-878c-bad19d3d5930.jsonl](results/filter-1f7c2f2f-1322-4358-878c-bad19d3d5930.jsonl).
The report contains session/browser metadata only, with no filter measurements
or final outcome. It is an interrupted authentication attempt, not validation
of the exact-target change or an application-performance result. No filter
action was recorded. The process tree was stopped; no automatic retry was made.
Wait for the user to authorize a fresh attempt after the MFA issue clears.

The user authorized resuming after the MFA pause:
[filter-f3b8cba7-7940-4a12-aa7c-d372ad2fe1bf.jsonl](results/filter-f3b8cba7-7940-4a12-aa7c-d372ad2fe1bf.jsonl).
Authentication completed. Apply observed loading/clearing, renderer activity,
the correct tab/top position and all six initial charts ready. However,
persisted-selection verification failed with guard `selection`; the failed
action duration was 4.96 seconds, including verification, not a successful
Apply-to-ready timing. Reset then failed before Apply (0 timed milliseconds)
with guard `option_set`, which in this restore path means the original target
identity was not found in the reopened option rows. The report does not establish
why that identity disappeared; asynchronous or filtered option lists remain
unproven possibilities, not diagnoses.

Overall `success`, `complete` and `restorationVerified` are all false. The
browser closed and no retry was made. The user was notified immediately and
chose to check and restore the original selection manually. Do not start a
further live test until restoration is confirmed. Next investigate reopened
option readiness/identity handling without weakening guards or substituting
another option. The exact-target change resolved chart rendering for this run,
but the full filter workflow and combined single-user report remain blocked.

Joint manual follow-up:
[discovery-bcdc2aed-f3ac-4532-b8c7-ed6e84da1e3a.jsonl](results/discovery-bcdc2aed-f3ac-4532-b8c7-ed6e84da1e3a.jsonl)
expired with only one `filter_open` capture. The user had observed a checked
target after Apply, then became distracted before restoration was confirmed.
That partial session is not restoration evidence.

At the user's request, a fresh joint session repeated the cycle:
[discovery-f50db623-b8cc-4183-8366-0b0ae41653b1.jsonl](results/discovery-f50db623-b8cc-4183-8366-0b0ae41653b1.jsonl).
The user confirmed the target was initially unchecked, applied only that target,
observed plotted charts, then reopened the popup and found it checked with a
stable, unchanged option list. They restored only that checkbox through Apply,
verified the original states and ready charts, and finished discovery normally.
Three captures (`filter_open`, `filter_applied`, `filter_reset`) were saved.
The untruncated structural captures show two individual option rows throughout,
one native checkbox false/true/false, the remaining checkbox states unchanged,
and observed loading/clearing and renderer activity for both Apply clicks.
Names are not captured, so target identity is supported by the operator's
confirmation, not inferred from these boolean records.

Restoration is now manually confirmed for the completed joint session. This
does not rewrite the earlier automated restoration failure or validate its
implementation. Observation elapsed times include human delay and are not
performance timings. The browser closed normally. Next investigate the
automated label identity/persisted-state handling and reopened-option readiness;
the successful manual cycle establishes that the intended interaction can
work, not which automation condition caused the failure. No additional live
run was started.

The automated verifier now polls for the complete original option identity set,
enable states, auxiliary state and expected checkbox values after reopening,
before its final assertion. Previously popup readiness meant only that rows,
inputs and labels existed; the next instruction immediately asserted persisted
selection. That structural readiness does not ensure asynchronously populated
options/checked values have reached their final state.

The same bounded 60-second condition timeout applies. Before resetting a
successfully verified Apply, the popup must again show the applied checked
selection, not a stale original unchecked state. On a failed Apply, restoration
continues to accept only the known original or test selection with unchanged
identities/other controls. No checkbox is clicked while those conditions are
unmet. Missing identities or wrong states retain their predefined guard codes;
permanent mismatches still fail, and malformed/duplicate controls still fail
immediately. Verification waits remain outside successful Apply-to-render
timings. There is no arbitrary fixed delay or alternative-target fallback.

Local validation: 28 filter browser checks, 11 targeted offline tests and syntax
checks passed. New cases cover delayed identity replacement, delayed persisted
checked state, delayed original state after reset, permanently incorrect state
and unexpected changes to another option. One local regression exposed stale
unchecked state being accepted too early before reset; requiring the applied
state after successful Apply fixed it. This establishes a local readiness race,
not the proven cause of the application's prior failure. Live validation of
this change is pending; the full combined test remains blocked on it.

The user approved one live validation of bounded option-state polling:
[filter-3808ab91-28d5-4b6b-a0db-1e9ad70fb7f3.jsonl](results/filter-3808ab91-28d5-4b6b-a0db-1e9ad70fb7f3.jsonl).
All six initial charts reached readiness, but reopened-selection verification
timed out after the full condition wait with guard `option_set`. The failed
64.93-second action includes verification delay and is not an Apply-to-ready
performance result. Reset also timed out in untimed preparation with
`option_set`; its recorded action duration is zero because Apply never began.
Automatic restoration is not verified. The user was notified and subsequently
confirmed checking/restoring the original selection manually.

This run shows that adding a bounded wait alone does not resolve the live
identity mismatch. The guard cannot distinguish changed label text from a
changed option set using the current evidence. Do not claim a timing root cause,
relax the identity contract, or run further blind retries. The browser closed,
the failed report is preserved unchanged, and no retry was made. Next obtain
focused identity/label-structure comparison in browser memory with only
sanitized match/count diagnostics leaving the page. The locally tested waiting
behavior remains useful for transient updates but is not a completed live fix.
Full combined test/report remains blocked.

The user observed that the options remain the same while the selection summary
changes from "0 selected" to "1 selected". Option identity currently uses the
native input's enclosing custom label's normalized full text. A summary outside
that label does not affect matching; one included inside it could affect
identity. Its live placement has not yet been established, so no counter text
is stripped from operational identities.

Failed action records can now include `optionComparison`: original/current row
counts, exact identity-match count, a diagnostic-only match count after removing
the standalone numeric "N selected" phrase, target-presence and auxiliary-state
equality booleans. Comparisons occur only in page memory; no label, name, hash,
raw text or substring is returned. Diagnostic counter removal is never used to
select, verify or restore an option. Counts are bounded/validated before saving.
The comparison is the last successful structural read, not proof of the DOM's
state after capture or a complete explanation of a failure.

Validation passed: 30 filter browser checks, 12 targeted offline tests and syntax
checks. A changing external summary passes apply/reset unchanged; a counter
embedded in a label fails with the original three rows still present, two exact
identity matches and three counter-independent matches. Its reset still refuses
the unsafe identity mismatch. Actual emitted records were validated for those
exact counts and absence of private fixture labels. No live login was made for
this diagnostic addition. A safe identity fix still requires evidence of the
actual summary/label structure, rather than removing arbitrary numeric text or
ignoring missing options.

The user clarified that the selection count is a separate summary, and approved
one diagnostic run:
[filter-bc731aa0-2700-4c47-b747-e6a92f0c216c.jsonl](results/filter-bc731aa0-2700-4c47-b747-e6a92f0c216c.jsonl).
Both failed verification and reset observations show original/current counts
2/2, exact matches 1, counter-independent matches 1, target present false and
auxiliary state matches true. Select all is not an individual option row.
This narrows the mismatch to the target's normalized label identity, not a row
count change or the standalone numeric selection summary. It does not reveal
whether label decoration, hidden text or the actual option identity changed.
No raw label comparison was exported.

All six charts reached readiness, but Apply failed during verification after
64.94 seconds including the untimed verification wait. Reset failed during
preparation without clicking Apply. Automatic restoration is not verified by
the report. The user was notified and confirmed manual restoration afterward.
The browser closed and no retry was made. Next inspect the target label's
identity-bearing structure in page memory, rather than strip arbitrary text or
select by position. This remains a blocked filter investigation, not a completed
filter baseline or full single-user performance report.

The user supplied a screenshot showing the intended checked option in lowercase
while local configuration had originally matched its mixed-case name. The
separate "1 selected" summary and two individual rows are visible. This suggests
a possible case-only display change, but a screenshot of one state does not
establish the initial DOM label or prove case-insensitive values are equivalent.

In-page `optionComparison` now additionally reports case-insensitive match count,
case-insensitive target candidate count, and whether both option sets are unique
under lowercasing. Only these counts/booleans leave the page. All operational
choice, persisted-selection and restoration checks still use exact identities.
Historical diagnostic records without the optional case fields remain valid.
No case-insensitive fallback or positional selection was introduced.

Validation passed: 13 targeted offline tests, 32 filter browser checks and syntax
checks. Actual emitted records distinguish a unique case-only change (three
case-insensitive matches versus two exact matches, one target candidate) from
two target candidates colliding under lowercasing. Both remain failed under
the unchanged exact contract. Private labels are excluded. No live login was
made for this change. Next obtain one approved live comparison to confirm or
rule out a unique case-only change before considering an identity-policy change.

The approved live comparison confirmed the casing discrepancy:
[filter-09ff62fb-66bb-419b-9074-dbced32bed53.jsonl](results/filter-09ff62fb-66bb-419b-9074-dbced32bed53.jsonl).
Both before/after sets contained two rows, with one exact match but two
case-insensitive matches, exactly one case-insensitive target candidate and
unique identities under lowercasing. Auxiliary state matched and all six charts
were ready. The screenshot showed the popup held open by the verifier, not a
need for another Apply. The old exact-case checks failed verification/reset;
the user confirmed manual restoration afterward. Failed Apply duration 66.13
seconds includes verification waiting, not successful completion timing.

Based on this live evidence, operational matching now compares normalized option
labels case-insensitively throughout target selection, persisted verification
and isolated restoration. Every rendered option must be unique under lowercasing;
case collisions fail immediately rather than selecting the first candidate.
Original row counts, identities modulo case, enabled states, auxiliary controls
and checkbox states remain required. No counter, punctuation or arbitrary text
is removed. Reports label the new policy
`unique-case-insensitive-local-name`; historical reports retain their original
policy and outcomes.

Local validation passes 33 filter browser checks, 13 targeted offline tests
and syntax checks. Case-only post-Apply display changes now complete apply/reset,
configured target casing is supported, while colliding case variants and actual
identity changes remain failures. Live validation of this fix is still pending;
no new login was started after implementing it.

The user approved a live validation of the capitalization fix:
[filter-644e95c0-1ca1-472d-9589-ebf9e93c45cd.jsonl](results/filter-644e95c0-1ca1-472d-9589-ebf9e93c45cd.jsonl).
The login attempt did not confirm Analytics navigation within the three-minute
assisted-MFA window. The exact authentication failure reason is not established.
No dashboard filter action ran and the saved outcome contains no measurements.
Its `restorationVerified: false` reflects absence of a reset measurement, not a
recorded filter change. The browser closed; no automatic retry was made.
At that point the capitalization fix remained locally validated but not live validated.

The next user-approved live filter validation passed:
[filter-2f06c8fa-30ac-497e-8721-6cc751394c0a.jsonl](results/filter-2f06c8fa-30ac-497e-8721-6cc751394c0a.jsonl).
One user/iteration completed the normal login and manual MFA, then:

| Action | Apply-to-ready duration | Result |
| --- | --- | --- |
| Filter apply | 3.6946s | Loading seen/cleared, renderer activity, six widgets ready and reopened selection verified |
| Isolated reset | 3.7616s | Same lifecycle/readiness checks plus original selection verified |

The final outcome has `success: true`, `complete: true` and
`restorationVerified: true`; the process exited zero and the browser closed.
Both records, action order, report summary and owner-only permissions were
independently validated. Successful timings exclude login/MFA, option choice and
post-render checkbox verification. This is one UI-lifecycle sample per action,
not a filter baseline, backend-freshness proof, SLA result or combined journey.
Host free memory was approximately 212 MiB at session start; caches and host
conditions were uncontrolled and must accompany later comparisons.

The capitalization fix is now live validated. Next implement and locally test
the combined authenticated reload, four-tab main-scroll traversal and filter
apply/reset mode with a unified report, then obtain approval for its full live
run. Do not combine earlier separate-session measurements into an apparent
single-session result. Drill-downs, nested-table scrolling and exports remain
outside the implemented scope.

Next implementation needs a bounded control/transition inspection: establish
unambiguous filter, popup, checkbox and Apply locators; keep the chosen value
local and out of logs; retain original checkbox state; observe an actual refresh
transition after Apply and wait for affected widgets to become ready; then
restore and verify the original selection through Apply. Time apply/reset from
the Apply action, not from opening the popup or choosing the checkbox. Do not
accept already-rendered pre-filter charts as refresh completion or rely solely
on a spinner that may be missed. No automated filter replay, timing baseline,
saved-settings change or export was performed in this discovery session.

For an approved, human-guided discovery session:

```sh
npm run dashboard:discover
```

Complete MFA in the headed browser. After the known dashboard widget appears,
a local **k6 discovery** panel is added to the host page. The session remains
open for up to 15 minutes of discovery (60 captures maximum); it is still one
browser user with one credential submission. It does not record arbitrary clicks
or automatically navigate, export, change saved settings, or measure performance.

1. Leave the dashboard at its initial position. Select **Initial viewport** in
   the panel and click **Capture checkpoint**.
2. Select **Scroll checkpoint**. Scroll the dashboard approximately one viewport
   at a time, with some overlap; capture each position after loading settles.
   Continue to the bottom. Capturing a loading state is allowed and does not
   count as a readiness assertion.
3. Return to the top, visit the next dashboard tab, select **Tab switch**, and
   capture. Repeat scroll checkpoints on each tab. Visiting the Download tab is
   permitted for discovery, but do not initiate an export without agreeing scope.
4. Session-only filter/apply/reset checkpoint labels are available. Agree the
   representative filter before using these; field names and selected values
   are not recorded, so exact replay configuration still needs separate design.
5. Click **Finish discovery** to close the browser and finalize the report.
   Closing the window, a timeout, or a failed capture is an incomplete session.

Each capture saves widget titles, tab labels/selection, iframe viewport geometry,
scroll positions, structural selectors, and counts of rendering/loading/error
signals to a unique, ignored `results/discovery-<id>.jsonl` file with owner-only
permissions. The runner validates and projects the report fields. Widget cell
values, chart labels, filter values, credentials, OTPs, URLs, and session state
are not captured. Names of widgets/tabs remain application metadata: keep the
report local. Captures are persisted incrementally, including on failed runs
when possible; check the final outcome record before interpreting a report.

The snapshot is iframe-scoped, not proof of host-viewport visibility or that all
lazy-loaded widgets were visited. A completed session means the operator
explicitly finished after at least one capture, not full-dashboard coverage.
Review the captured inventory against expected coverage before building the
automated readiness and action-timing journey.

Offline validation (no credentials or application traffic):

```sh
npm run smoke:discovery-local
```

**Completed discovery, 2026-10-21:** the user completed MFA, captured 30
checkpoints, and clicked Finish. The command exited successfully and the browser
closed. Coverage observed:

| Tab | Checkpoints | Widget titles |
| --- | --- | --- |
| Monitoring Visits Summary and Metrics | 1-10 | 16 |
| Site Communication Summary | 11-17 | 4 |
| CRA Monitoring Visit Metrics | 18-27 | 9 |
| Download (layout only; no export) | 28-30 | 1 |

All listed titles were observed intersecting the iframe viewport at some point.
Charts and table structures were captured, but several tracking/summary widgets
did not expose either generic signal. Those need widget-specific inspection;
their titles alone cannot satisfy readiness. At least one CRA widget had a
visible spinner in a captured snapshot, so the captures are not all ready states.

The checkpoint-type dropdown flashed shut during this session. All 30 raw labels
therefore remained `initial_viewport`; selected tabs, geometry, and scroll
positions still identify the observations. The user scrolled both the main page
and nested widgets. Do not interpret this sequence as a repeatable scroll profile
or rewrite the original evidence. The panel now uses radio buttons, validated
with a local browser selection test, for future sessions.

Next: turn this observed inventory into a deterministic main-page scroll/tab
journey; distinguish nested widget scrolling, validate each visualization's
rendering/error/no-data signals, then add action-to-ready timings. Representative
filter/drill-down scope and exact control locators still need discovery.

## Single-user rendered-widget proof of concept

After approval for one single-user dashboard run:

```sh
npm run dashboard:smoke
```

The runner fills the normal login form from `.env`. Complete MFA directly in the
visible browser if prompted; the same session then checks
**Study Environments with Visit Counts** in the ThoughtSpot iframe.
There is no automated credential/MFA retry, session export, scrolling, tab switch,
filter change, or concurrency. The browser closes after success or failure.

The check requires all of the following in the same widget snapshot:

- Exactly one visible heading with the expected widget title.
- One visible `.highcharts-container svg.highcharts-root` chart.
- At least one visible `.highcharts-series path.highcharts-point` with a nonempty
  path and a bounding box intersecting the iframe viewport.
- No visible `.rdLoadingIndicator`, progress bar, or busy indicator.
- No visible scoped alert/error marker or recognized no-data state.

`[data-testid="answer-content-loading-indicator"]` wraps the rendered chart and
is not itself the spinner. Waiting for that wrapper to disappear is incorrect.
The real `.rdLoadingIndicator` was observed alongside chart points during
loading; the check does not pass until that spinner clears.

The widget is polled for up to 60 seconds after attachment, not delayed by a
fixed readiness sleep. Failure or no data is reported explicitly; no data does
not pass this rendered-data proof of concept. Error/no-data guards are validated
with local fixtures, but their live application variants remain to be observed.
The runner requires both Analytics navigation and the widget-rendered completion
signal; a title, chart shell, or successful HTTP response cannot pass by itself.

**Verified 2026-10-21:** after the user completed MFA, one single-user live
rendered-widget run passed and exited successfully. Five Node tests, syntax
checks, and all 11 local browser checks passed. No OTP, credentials, query data,
or session state were printed or saved in results.

This is a rendering proof of concept, not a timing/SLA result. It does not yet
measure dashboard-click-to-ready latency, prove the full viewport is ready, or
exercise chart interactions. Keep manual authentication outside any future
dashboard performance duration.

### Inspection history

On 2026-10-21, the user authorized resuming one-user testing with credentials
from `.env` and manual MFA in the visible browser. The opt-in
`npm run dashboard:inspect` command continues into the same session after login
and probes the known widget. It prints only structural DOM metadata (tags,
classes, test IDs, and roles), not text content, cell values, URLs, or credentials.
The probe is diagnostic: candidate render selectors are not a validated
readiness contract and a completed probe is not a dashboard performance result.

On 2026-10-20, single-user exploratory runs reached the ThoughtSpot iframe and
observed the expected Summary and Metrics widget titles. Structural findings:

- Dashboard iframe: `iframe[src^="https://medidata-dev.thoughtspot.cloud/"]`.
  A separate hidden ServiceNow iframe exists; do not select the first iframe.
- `page.frameLocator(...)` can locate content inside the ThoughtSpot iframe.
  Wait for the iframe's `domcontentloaded` lifecycle before inspecting it;
  attaching during its navigation produced execution-context failures.
- The heading `Study Environments with Visit Counts` is inside a
  `[data-testid="answer-content"]` container. Scope any readiness checks to the
  container with that exact heading, not the entire dashboard.
- `[data-testid="answer-content-loading-indicator"]` exists within the widget.
  Its hidden state alone was insufficient: no rendered-data signal was verified.

The user reported that the Okta service was temporarily unavailable while
inspection was in progress. The active run was stopped and live testing paused.
This report does not establish the cause of earlier iframe inspection failures.
Temporary inspection code from that day was removed; `npm run login:poc` remains
the login-only experiment. The user authorized resuming on 2026-10-21, and the
new discovery/check commands above were validated. Earlier iframe failures were
not established to be caused by the outage.

## Source context and evidence

Original automation repository:
`/Users/JMI11/Projects/rctms-automation-test`

Source HAR, intentionally not copied into this project:
`/Users/JMI11/Projects/rctms-automation-test/home-sandbox.imedidata.net.har`

The HAR may contain credentials, cookies, sensitive response data, and tenant
information. Keep it local and out of version control. Never use captured
credentials or hardcoded session identifiers as test authentication.

Dashboard:
`https://home-sandbox.imedidata.net/apps/Analytics/dashboards?dashboardId=f9431c78-169f-442d-8f9e-61f8bc0ee73c`

The 2026-10-20 capture contains 509 requests, with request start times spanning
approximately 94 seconds. Key findings:

1. Medidata dashboard metadata comes from
   `GET /api/analytics/dashboards/f9431c78-169f-442d-8f9e-61f8bc0ee73c`.
   It took approximately 8.33 seconds in this one capture.
2. ThoughtSpot operations use
   `POST https://medidata-dev.thoughtspot.cloud/prism/`.
   Differentiate them by GraphQL `operationName`, not URL alone.
3. `LoadPinboardSession` returns tabs, layout, tile references, permissions,
   and filters. `getPinboardDataSources` returns worksheet/column metadata.
4. Sixteen `LoadContextBook` calls were mapped to the Summary and Metrics tab.
   Their responses include visualization definitions and data, including
   `columnDataLite`, `totalRowCount`, and query-performance statistics.
   Individual request durations were approximately 1.02-3.44 seconds.
5. Match `contextBookId` / `vizId` against the returned dashboard definitions
   when building instrumentation; do not infer widget identity by request order.
6. The datasource is `[Portfolio] CTMS - Monitoring Visits`, with 83 columns.
7. Definitions exist for four tabs, but visualization data was captured only
   for Monitoring Visits Summary and Metrics. The other three tabs still need
   observation. Empty widget lists in the inventory mean unknown, not no widgets.
8. `GetCommunicationConnections` failed with HTTP 500 and
   `GRAPHQL_VALIDATION_FAILED`. Medidata recorded the error through
   `/api/analytics/frontend-error`. This does not establish failure of the
   Site Communication Summary tab.
9. All sixteen captured visualization-data calls returned HTTP 200 without
   top-level GraphQL errors. This alone does not prove successful UI rendering.
10. Two file-resource requests and three icon-font requests returned 404.
    Session/bootstrap, feature flags, telemetry, and static assets are distinct
    from monitoring-visit metric data.

Widget requests were spread over roughly 35 seconds. Scrolling, lazy loading,
and user interactions may explain that spread. Do not label it initial page-load
time or sum concurrent request durations into an E2E duration.

The HAR cannot expose ThoughtSpot's internal SQL requests or upstream ingestion
APIs. Snowflake concurrency/SQL replay is a separate diagnostic layer, not a
replacement for browser E2E testing.

## Measurement contract to implement

Primary metric: dashboard click to expected initial-viewport widgets rendered
and usable. Verify actual DOM/rendering signals in the ThoughtSpot iframe;
an iframe being visible or an HTTP 200 response is not sufficient.

Record separately:

- Login/session establishment.
- Initial viewport readiness from the initiating click.
- Per-widget readiness from the relevant dashboard/tab/filter action.
- Full-tab traversal using a fixed, documented scroll sequence.
- Tab-switch and filter-refresh readiness.
- Export completion if downloads are included in scope.
- API operations and durations, with failed/cancelled requests identified.

Use monotonic timings for elapsed durations. Avoid fixed sleeps and `networkidle`
as readiness criteria: telemetry and session traffic can continue indefinitely.
Verify that expected content is visible and its loader has cleared. Handle
legitimate no-data states explicitly, reject error states, and prove filter
results refreshed rather than counting stale pre-filter content as ready.

Verify supported k6 APIs for iframe interaction and network instrumentation in
the installed version before designing around Playwright-like APIs. Only the
normal login form selectors have been observed; no dashboard selectors or SSO
method are verified. Do not substitute token injection or internal HAR replay
for the authenticated user journey without an agreed design.

## Milestones and prerequisites

1. **One-user proof of concept (next):** confirm the k6/browser runtime, approved
   authentication approach, iframe access, and one reliable rendered-widget
   completion condition. Inspect the real application before adding locators.
2. **Full journey:** initial viewport, fixed scroll checkpoints, remaining tabs,
   and a representative filter. Define downloads separately if required.
3. **Repeatable baseline:** repeated single-user measurements; record cache/data
   conditions, versions, viewport, and runner resources. Fresh browser contexts
   do not guarantee cold ThoughtSpot/Snowflake caches.
4. **Concurrency:** agree user levels, ramps, duration, pacing, account/tenant
   mix, stop conditions, and test window. Use isolated contexts and an approved
   identity pool. Scale the same validated journey; do not build a second suite.
5. **Gates/reporting:** agree thresholds from requirements and baseline evidence.
   Report sample counts, latency percentiles, throughput, errors, and timeouts.
   Never silently discard failed iterations from performance conclusions.

Five users may be a first approved experiment, not an assumed safe target.
Monitor load-generator CPU/memory: k6 browser users still require real browsers.
Only consider distributing runners after measuring local/CI capacity.

## Safety and decisions still needed

- Obtain approval for sandbox/ThoughtSpot load, including shared-tenant impact
  and applicable service/contract limits. A sandbox URL is not load authorization.
- Confirm account provisioning, MFA/SSO handling, and tenant/data permissions.
- Agree whether authentication is included in the primary SLA.
- Agree initial viewport, expected widgets, scroll pacing, filter, and tab scope.
- Agree concurrency, hold duration, percentiles, latency targets, error budget,
  and stop conditions. No performance SLA is defined yet.
- Do not log credentials, authorization headers, cookies, session identifiers,
  raw query results, or sensitive tenant data. Keep auth state and results ignored.
- For the single-user login experiment, the local, git-ignored `.env` file uses
  `ANALYTICS_USERNAME` and `ANALYTICS_PASSWORD` fields. These are
  project-defined names, not confirmed SSO settings. Fill them locally only if
  local credential storage is permitted by your organization. Keep the file
  readable only by your user; never commit it, paste it into chat, or print its
  contents. Do not source it as a shell script.
- k6 does not automatically load `.env`; use the local Node runner described
  above. If the normal login requires SSO or MFA, stop and establish a
  supported approach; do not bypass those controls. For repeatable automation,
  prefer an approved secret manager. Never pass secrets as CLI arguments or log
  their values.
- Keep output local unless an approved reporting destination is selected.
- Raw `/prism/` replay needs dynamic session correlation and does not measure
  rendering. HTTP-only load, if later needed, is a separately designed workload.

## Continuing in a new session

Open this project in VS Code and ask:

> Read README.md and reference/dashboard-inventory.json. Continue with the
> one-user k6 browser proof of concept. First verify prerequisites and obtain
> approval before making live requests. Do not launch concurrency or assume
> authentication methods, selectors, readiness conditions, or SLAs.

This repository is the durable handoff; chat/browser session state is not.
The normal login form, human-assisted MFA, Analytics navigation, and one
rendered-widget condition have been verified with k6. Next agree the initial
viewport widget set and initiating dashboard action, then add monotonic timing
and validate the remaining readiness signals. Do not describe the one-widget
smoke as a full dashboard performance test or introduce concurrency without
separate approval.

## Official references

- [k6 browser test execution](https://grafana.com/docs/k6/latest/using-k6-browser/running-browser-tests/)
- [k6 browser API](https://grafana.com/docs/k6/latest/javascript-api/k6-browser/)
- [k6 scenarios](https://grafana.com/docs/k6/latest/using-k6/scenarios/)
