# Task 14 report — owner menu

Implemented `/app/menu` with a three-interaction quick add, optional categories, availability control, and owner navigation. The route composes `MenuQuickAdd` (forms), `MenuGroupedList` (grouped rows), and `useMenuAdmin` (store-scoped data and mutations). `parseVndInput` accepts Vietnamese price shorthand and separators; `ZFormField` now displays an error prop.

`useMenuAdmin` clears rows when the active store changes and uses a request generation plus store ID to ignore late responses. Mutations capture their originating store ID and never append or replace rows in another store. The availability switch displays the saved server value, so an immediate reload cannot cancel a pending optimistic change.

Verification:
- RED: parser and composable tests failed before implementation; browser journey exposed reload-before-PATCH race.
- GREEN: focused Vitest 6 files / 65 tests passed, including deferred old-store load and mutation tests.
- Playwright menu admin: 4/4 passed on mobile Chrome and Safari with `--workers=1`; earlier combined run showed all 10 onboarding tests passing. E2E config disables Nuxt devtools so real mobile nav taps are unobstructed. Browser server used port 3100; port 3000 was untouched.
- `npm run lint` and `npm run typecheck` passed.

Existing duplicate Nuxt `console.time` warnings appeared in Vitest as noted in integration notes.
