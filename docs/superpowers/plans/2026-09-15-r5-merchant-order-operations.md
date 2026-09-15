# R5 — Merchant Order Operations Implementation Plan

1. Write pgTAP for the transition matrix, audit history, timestamps, roles and cross-tenant denial; add the trigger and security-invoker RPC migration.
2. Write unit/Nuxt tests for bearer authentication, user-JWT Supabase forwarding, safe DTOs and error mapping; implement merchant repositories and Nitro routes without service-role access.
3. Write component/page tests; implement Auth login, protected admin layout, store selection, mobile order queue/detail and status actions.
4. Add a store-filtered Realtime refresh composable plus reconnect, focus and manual-refresh fallbacks.
5. Add authenticated E2E coverage, run all pgTAP, lint, typecheck, unit/Nuxt, build, client-secret scan and Playwright.

Acceptance: owner/admin inherit all organization stores; assigned owner/manager/staff see only their stores; outsiders and cross-tenant requests are denied; invalid transitions cannot bypass the state machine; every accepted transition has one history row; no merchant endpoint creates a privileged generic client.
