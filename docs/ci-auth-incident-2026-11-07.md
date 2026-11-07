# PR7 CI Auth provisioning investigation

## Evidence and attribution

Run 17 (42250151528) tested head 15e722a via GitHub's merge commit
f417973. Browser job 128004093532 failed during `enableNeonAuth`:
HTTP 412, `permission denied for database neondb`.
The metadata query showed connected role/database owner `neondb_owner`
with CONNECT/CREATE and `neon_auth` with CONNECT/CREATE after the temporary
grant. The restore step succeeded, and the temporary branch was deleted.

This is a database-permission error surfaced through Neon's control plane,
not evidence that the application owner lacks CREATE. The metadata query
runs on the app connection; it does not establish which principal, connection,
or DDL operation the managed service used. It cannot rule out a different
internal principal, stale service connection, or provider bootstrap behavior.
There is no evidence of an API-key authorization failure, quota/rate limit,
or a documented blanket prohibition on schema-only Auth provisioning.
Do not claim a confirmed Neon platform defect or grant additional privileges.

At 15e722a, schema-only branches inherited empty Auth DDL without a working
integration. `reset-ci-schema.ts` verified emptiness and dropped that schema;
`neon.ci.ts` requested fresh Auth only for the browser slot, while
`bootstrap-ci-auth.ts` temporarily granted CREATE to the existing managed role.
That assumption about the provider's bootstrap principal was unproven.
Fail-fast then cancelled independent suites, hiding their results.

Neon's API documentation describes Auth as branch-scoped, using the default
database unless database_name is supplied. It does not document the internal
DDL principal or a remedy for this 412:
https://github.com/neondatabase/website/blob/main/content/docs/auth/guides/manage-auth-api.md
A provider escalation needs the original request ID from protected logs,
project/branch/database, timestamp, CLI version (8.4.1), and privilege metadata;
never attach API keys, connection strings, users or sessions. Ask Neon to
identify the failing SQL principal/operation before revisiting fresh bootstrap.

## Current source and observed mitigation

Head 0d7b3e5 already removed the temporary privilege bootstrap, set auth:false,
and bound browser journeys to existing non-production branch `test`.
Only Auth base URL/JWKS are exported; app database and storage stay per-run.
Shared settings are checked without mutation, and only run-prefixed synthetic
users are cleaned up. This tests real managed Auth but does **not** validate
fresh Auth provisioning or recovery; those remain separate operational gates.

Run 18 (42253702207) on that head passed checks, both integration shards,
API, and hardening. Browser binding, build and browser install also passed.
Hardening browser tests failed (15 failed, 4 passed, 2 skipped), including
script-src CSP violations, missing main on unknown-order tracking, and a
product dialog not opening. Production browser journeys were consequently
skipped. These failures remain merge blockers; the mitigation is not a green CI.

## Changes in this patch

- Require Actions, explicit test flag, matching run ID/branch labels, a database
  URL and provider endpoint attestation before CI storage provisioning.
- Exercise the actual orchestration with injected provider calls: invalid
  scope and failed attestation cannot deploy; provider failure cannot trigger
  an Auth retry or a privilege workaround. Verify browser config keeps Auth off.
- Execute both browser gates after successful Auth bind/build/browser install,
  even when hardening browser tests fail. Preserve each failure as a job failure.
- Give suites separate test-results and HTML report directories so the second
  suite cannot erase the first suite's evidence.

## Verification and merge gate

Run focused provisioning/Auth scope unit regressions, lint and typechecks.
Then CI on the exact new PR head must pass checks, integration 1/2 and 2/2,
API, hardening, and both real browser suites on all configured projects.
Inspect cleanup success and both report trees. Do not substitute a rerun of
run 17 for testing the new commit. A skipped required journey is not success.
Keep PR5 targeting develop; obtain explicit user approval before merging.
No main update, production deployment, database privilege expansion, or
payment schedule activation is part of this patch.

## Run 19 browser follow-up

Run 42325441612 on 52f2cb1 passed checks, integration (both shards), API and
hardening. Storage provisioning and binding existing test Auth succeeded.
The browser job failed in both suites, not in Auth provisioning:

- Hardening: 15 failed, 4 passed, 2 explicitly non-Chromium Lighthouse skips.
- Production journeys: 153 passed, 18 failed; 45.5 minutes with one worker.
- Shared test Auth cleanup and ephemeral branch deletion succeeded.

Trace evidence shows WebKit sign-up returned 200 with a Secure, SameSite=None
provider-domain cookie; the following get-session request sent no cookies and
returned null. The app then redirected from onboarding to login. Long journey
timeouts repeatedly waited for an onboarding form that was no longer present.
This is a real cross-site session persistence failure, not permission provisioning.

The follow-up routes the five currently used email/session/token operations
through same-origin /api/auth endpoints. The upstream is server-configured;
mutations require the exact configured app Origin; unrelated cookies and
Authorization/forwarded-host headers are not forwarded. Provider session cookies
are host-only, HttpOnly, Secure, SameSite=Lax and unpartitioned; expiry/deletion
are retained. No local session or alternate JWT issuer is created. Existing
application APIs still verify provider JWTs as before. OAuth is not exposed by
these endpoints. Local browser CI runs HTTPS with a generated localhost-only
certificate; only its certificate trust is relaxed, never cookie privacy or CSP.

Other fixes from trace/source comparison:

- Tracking page rendered its correct not-found state but lacked a main landmark;
  the page now provides main for all states.
- The hostile-text product fixture had no options, so the intended behavior was
  direct add-to-cart. Add an option group to exercise the actual product dialog.
- Axe injects dynamic-code feature probes. Run page-level accessibility scans in
  a separate document while keeping the original page's CSP observer active;
  no CSP directive or violation assertion is relaxed. Dialog scans remain on the
  live dialog, and the original application page continues to collect errors.
- Fulfillment toggles could overlap parent refreshes and roll back to stale
  values. Serialize mode writes and retain the component's current mode state
  across older same-store prop refreshes. The component is keyed by store ID.
- Assert onboarding form visibility before fill, so session regressions fail at
  the normal assertion timeout instead of repeatedly exhausting whole journeys.

Regression coverage includes provider-cookie rebinding/deletion, rejected
mutation origins/methods/large bodies, filtered upstream headers with the real
SDK forwarder, provider denials, and stale refresh during a denied last-mode
change. Real browser success must still be established by CI on this patch.
Local Playwright installation failed because the browser CDN returned an invalid
ZIP; no local Chromium/WebKit pass is claimed.

## Run 20 follow-up

Run 42331928510 on f66a5e5 passed every non-browser job. The real browser
production journeys reached 169/171 passes; Safari onboarding/session tests,
fulfillment rollback, and the product dialog journey no longer failed.
Both remaining production failures were the reconciliation success locator:
it matched the visible toast title and its hidden live-region announcement.
Use an exact text match while retaining the payment-status and duplicate-payment
assertions that follow it.

Hardening reached 7 passes, 12 failures and 2 expected Lighthouse project skips.
Tracking's loading div was genuinely missing a role permitting its aria-label;
add role=status and a Nuxt regression for the named loading state/main landmark.

The earlier attribution of the single script-src event to Axe was incomplete:
separating Axe did not fix it. The observed page still called Playwright's
main-world waitForFunction before auditing, then evaluate to read the array.
The pinned Playwright UtilityScript uses global eval for evaluations, and
waitForFunction also evaluates its expression in the main world. Remove those
operations from CSP-observed documents. These ssr:false routes already expose
main only after client rendering; use DOM locator assertions instead.

Record complete CSP details (directive, blockedURI, source and line) in DOM
markers via the native violation callback, and read them through locators.
Native animation callbacks record viewport overflow without main-world
Playwright evaluations. No events are filtered, no observers are suspended,
and the policy and zero-violation assertion remain enforced. Add a browser
negative control that loads an intentionally forbidden script and requires the
observer to catch exactly that violation. Axe still runs with the original CSP
in a separate document. Any real remaining application violation must still
fail and now leaves its source details in the trace.

Focused validation: loading-state Nuxt regression, lint, Nuxt typecheck and
hardening typecheck. Full browser validation remains gated on the next CI run;
passing ordinary unit/component tests alone does not establish CSP success.
