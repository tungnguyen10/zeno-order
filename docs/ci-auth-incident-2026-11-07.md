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
