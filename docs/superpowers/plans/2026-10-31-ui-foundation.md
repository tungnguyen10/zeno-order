# ZENO UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the CafeBlend-based, mobile-first design system (tokens, `Z*` primitives, `App*` components) and apply it to every Phase 1 screen.

**Architecture:**
- Design tokens live as CSS variables in `app/assets/css/main.css`, in a light (cream) set and a dark (espresso) set, and are mapped onto Nuxt UI's `--ui-*` variables.
- `Z*` primitives in `app/components/z/` wrap Nuxt UI components and own all styling.
- `App*` components in `app/components/app/` compose the primitives. Pages and layouts consume only `Z*`/`App*`; ESLint enforces this.

**Tech Stack:** Nuxt 4.5, Nuxt UI 4.12 (Reka UI, Tailwind v4, @nuxt/fonts, @nuxtjs/color-mode, @nuxt/icon), Vitest 5 + @nuxt/test-utils 4 (`nuxt` environment, happy-dom), @testing-library/vue, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-31-ui-foundation-design.md`

## Global Constraints

- Mobile-first at 360px wide. No horizontal scroll at 360px. Every interactive control has a hit area of at least 44px.
- UI copy is Vietnamese. `<html lang="vi">` is already set.
- Fonts: Fraunces 500/600 (headings only), Work Sans 400/500/600, IBM Plex Mono 400/500. Subsets are `vietnamese` + `latin`.
- Body and input text are 16px. Never smaller than 16px inside inputs.
- Light tokens: bg #FDF6EC, surface #FFFFFF, inset #F0E6D6, border #E8DDD0, text #3E2723, muted #6D4C41, primary #8B5E3C.
- Dark tokens: bg #1C1410, surface #2A1F19, inset #15100C, border #3D2E25, text #F5EBDD, muted #C9B8A6, primary #D4A373.
- WCAG AA (4.5:1) for all text, in both modes. When a palette value fails AA, the darker shade wins. For example: chip/alert text uses Tailwind 800 on a 50/100 background, and `--ui-error` is red-700 in light mode.
- Do not use #C4956A (caramel) for text.
- Neumorphic `raised`/`inset` shadows appear only in light mode. In dark mode they become a flat shadow plus a 1px ring.
- Pages and layouts must not use `UButton`, `UInput`, `USelect`, `USwitch`, `UCard`, `UAlert`, `UBadge` or `UFormField` directly.
- Do not change routes, APIs, business logic, or existing labels and button names, with two exceptions:
  - Sign-out moves into the "Tài khoản" menu on mobile.
  - The landing h1 becomes "Đặt món tại bàn, không cần app".
- Dependency versions are pinned exactly (no `^`), following the existing `package.json` convention.
- Commit messages: `feat(ui)`, `fix(ui)`, `test(ui)`, `docs(ui)`, ending with the trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Review Focus

1. Vietnamese diacritics in headings (`ạ ế ở ữ`) must render in Fraunces, not a fallback font. Task 10 asserts this with `document.fonts.check` after `fonts.ready`.
2. A long store name, a long email, or a long public URL at 360px must truncate or wrap without causing horizontal scroll. Task 8 saves a ~60-character store name and asserts there is no overflow on `/app/settings` and `/app/orders`.
3. Dark mode chosen by the user must survive a reload and must not cause SSR hydration mismatches on `/`. Task 5 wraps the toggle in `<ClientOnly>`; Task 10 asserts persistence after reload.
4. The password reveal button must not break label-based lookup or autofill. The input keeps its `<label>`, and the toggle has its own `aria-label`. Task 3 unit-tests the toggle; Task 6 updates E2E locators to `exact: true`.
5. The unsaved-changes guard must prompt only when the form is dirty. It must not prompt after a successful save or after "Hủy". Task 8 E2E covers both: a dismissed prompt keeps the user on the page, and navigating after save shows no dialog.

---

## File Structure

| Path | Responsibility |
|---|---|
| `app/assets/css/main.css` | Tokens (light/dark), palettes, radius, shadows, type utilities, reduced motion |
| `app/app.config.ts` | Nuxt UI color aliases (`coffee`, `caramel`, `cream`…) and existing touch-target overrides |
| `nuxt.config.ts` | Fonts, color mode, icon bundling, head (title template, favicon, manifest) |
| `app/app.vue` | `UApp`, toaster position, loading indicator, dynamic `theme-color` |
| `app/error.vue` | 404/500 page |
| `public/favicon.svg`, `public/*.png`, `public/site.webmanifest` | Brand icons and PWA manifest |
| `scripts/generate-icons.mjs` | Renders the PNG icons from `favicon.svg` with Playwright |
| `app/components/z/{Button,Input,FormField,Select,Switch,Card,Alert,Badge}.vue` | Primitives |
| `app/components/app/{Logo,PageHeader,EmptyState,ColorModeToggle,CopyField,AuthShell,StoreSwitcher,AccountMenu}.vue` | App-level components |
| `app/components/landing/PhoneMockup.vue` | Decorative CSS phone mockup for `/` |
| `app/composables/useUnsavedChangesGuard.ts` | Route-leave and `beforeunload` guard |
| `app/utils/password-strength.ts` | Pure password strength scoring |
| `tests/unit/app/theme-contrast.test.ts` | Parses `main.css` and asserts AA contrast |
| `tests/unit/app/password-strength.test.ts` | Unit test |
| `tests/nuxt/**/*.test.ts` | Component tests (`nuxt` Vitest project) |
| `tests/e2e/ui-foundation.spec.ts` | Overflow, dark mode, font E2E |

---

### Task 1: Theme foundation (tokens, fonts, color mode, icons, metadata)

**Files:**
- Modify: `app/assets/css/main.css`, `app/app.config.ts`, `nuxt.config.ts`, `app/app.vue`, `package.json`
- Create: `public/favicon.svg`, `public/site.webmanifest`, `scripts/generate-icons.mjs`, `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`
- Test: `tests/unit/app/theme-contrast.test.ts`

**Interfaces:**
- Produces:
  - CSS variables `--zeno-{bg,surface,surface-inset,surface-inset-hover,surface-hover,surface-disabled,border,text,text-muted,text-dimmed,primary,primary-hover,on-primary,error-wash,shadow-raised,shadow-raised-sm,shadow-inset}`.
  - Tailwind utilities `shadow-raised`, `shadow-raised-sm`, `shadow-inset`, `font-display`, `font-mono`, `text-h1`, `text-h2`, `text-h3`.
  - Palettes `coffee`, `caramel`, `cream`.
  - Nuxt UI color aliases: primary=coffee, secondary=caramel, neutral=cream, success=emerald, warning=amber, error=red, info=indigo.

- [ ] **Step 1: Write the failing contrast test** in `tests/unit/app/theme-contrast.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../../app/assets/css/main.css', import.meta.url), 'utf8')

function block(selector: string): Record<string, string> {
  const match = css.match(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))
  if (!match) throw new Error(`missing ${selector} block`)
  return Object.fromEntries([...match[1]!.matchAll(/--zeno-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(m => [m[1]!, m[2]!.toLowerCase()]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const PAIRS: Array<[fg: string, bg: string]> = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-inset'], ['text', 'surface-hover'],
  ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-inset'],
  ['primary', 'bg'], ['primary', 'surface'], ['primary', 'surface-inset'], ['primary', 'surface-hover'],
  ['on-primary', 'primary'], ['on-primary', 'primary-hover'], ['text', 'error-wash'],
]

describe.each([':root', '.dark'])('theme tokens in %s', (selector) => {
  const tokens = block(selector)

  it.each(PAIRS)('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(tokens[fg], `--zeno-${fg}`).toBeDefined()
    expect(tokens[bg], `--zeno-${bg}`).toBeDefined()
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project unit tests/unit/app/theme-contrast.test.ts`
Expected: FAIL with `missing :root block`.

- [ ] **Step 3: Replace `app/assets/css/main.css`**

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme static {
  --font-sans: "Work Sans", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Fraunces", ui-serif, Georgia, serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;

  --color-coffee-50: #faf4ee;
  --color-coffee-100: #f2e4d5;
  --color-coffee-200: #e4c9ac;
  --color-coffee-300: #d4a97f;
  --color-coffee-400: #c08a5e;
  --color-coffee-500: #a87348;
  --color-coffee-600: #8b5e3c;
  --color-coffee-700: #6b4226;
  --color-coffee-800: #553420;
  --color-coffee-900: #3e2723;
  --color-coffee-950: #24160f;

  --color-caramel-50: #fbf5ee;
  --color-caramel-100: #f5e7d6;
  --color-caramel-200: #ebcfad;
  --color-caramel-300: #ddb387;
  --color-caramel-400: #c4956a;
  --color-caramel-500: #b07d52;
  --color-caramel-600: #946441;
  --color-caramel-700: #774f35;
  --color-caramel-800: #5e3f2c;
  --color-caramel-900: #4a3224;
  --color-caramel-950: #2a1b13;

  --color-cream-50: #fdf6ec;
  --color-cream-100: #faf0e1;
  --color-cream-200: #f0e6d6;
  --color-cream-300: #e8ddd0;
  --color-cream-400: #c9b8a6;
  --color-cream-500: #a08c7a;
  --color-cream-600: #7d6656;
  --color-cream-700: #6d4c41;
  --color-cream-800: #3d2e25;
  --color-cream-900: #2a1f19;
  --color-cream-950: #1c1410;

  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
}

@theme inline {
  --shadow-raised: var(--zeno-shadow-raised);
  --shadow-raised-sm: var(--zeno-shadow-raised-sm);
  --shadow-inset: var(--zeno-shadow-inset);
}

:root {
  --zeno-bg: #fdf6ec;
  --zeno-surface: #ffffff;
  --zeno-surface-inset: #f0e6d6;
  --zeno-surface-inset-hover: #ebe0d0;
  --zeno-surface-hover: #faf0e1;
  --zeno-surface-disabled: #f5ede3;
  --zeno-border: #e8ddd0;
  --zeno-text: #3e2723;
  --zeno-text-muted: #6d4c41;
  --zeno-text-dimmed: #8d7466;
  --zeno-primary: #8b5e3c;
  --zeno-primary-hover: #6b4226;
  --zeno-on-primary: #ffffff;
  --zeno-error-wash: #fef2f2;
  --zeno-shadow-raised: 6px 6px 12px #d5c9b8, -6px -6px 12px #ffffff;
  --zeno-shadow-raised-sm: 3px 3px 6px #d5c9b8, -3px -3px 6px #ffffff;
  --zeno-shadow-inset: inset 4px 4px 8px #d5c9b8, inset -4px -4px 8px #ffffff;

  --ui-radius: 0.5rem;
  --ui-primary: var(--zeno-primary);
  --ui-success: var(--ui-color-success-700);
  --ui-warning: var(--ui-color-warning-700);
  --ui-error: var(--ui-color-error-700);
  --ui-info: var(--ui-color-info-600);
  --ui-bg: var(--zeno-bg);
  --ui-bg-muted: var(--zeno-surface-hover);
  --ui-bg-elevated: var(--zeno-surface-hover);
  --ui-bg-accented: var(--zeno-surface-inset);
  --ui-border: var(--zeno-border);
  --ui-border-muted: var(--zeno-border);
  --ui-border-accented: #d9cbb8;
  --ui-text: var(--zeno-text);
  --ui-text-highlighted: var(--zeno-text);
  --ui-text-toned: var(--zeno-text);
  --ui-text-muted: var(--zeno-text-muted);
  --ui-text-dimmed: var(--zeno-text-dimmed);
  --ui-text-inverted: var(--zeno-on-primary);
}

.dark {
  --zeno-bg: #1c1410;
  --zeno-surface: #2a1f19;
  --zeno-surface-inset: #15100c;
  --zeno-surface-inset-hover: #1e1611;
  --zeno-surface-hover: #33261f;
  --zeno-surface-disabled: #221913;
  --zeno-border: #3d2e25;
  --zeno-text: #f5ebdd;
  --zeno-text-muted: #c9b8a6;
  --zeno-text-dimmed: #9c8a7a;
  --zeno-primary: #d4a373;
  --zeno-primary-hover: #e0b88e;
  --zeno-on-primary: #1c1410;
  --zeno-error-wash: #2b1414;
  --zeno-shadow-raised: 0 4px 12px rgb(0 0 0 / 0.35);
  --zeno-shadow-raised-sm: 0 2px 4px rgb(0 0 0 / 0.3);
  --zeno-shadow-inset: inset 0 1px 2px rgb(0 0 0 / 0.4);

  --ui-success: var(--ui-color-success-400);
  --ui-warning: var(--ui-color-warning-400);
  --ui-error: var(--ui-color-error-400);
  --ui-info: var(--ui-color-info-400);
  --ui-border-accented: #4a3a2f;
}

@utility text-h1 {
  font-family: var(--font-display);
  font-weight: 600;
  font-size: 1.875rem;
  line-height: 2.375rem;
  letter-spacing: -0.01em;
  @media (width >= 40rem) {
    font-size: 2.125rem;
    line-height: 2.625rem;
  }
}

@utility text-h2 {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.5rem;
  line-height: 2rem;
  @media (width >= 40rem) {
    font-size: 1.625rem;
    line-height: 2.125rem;
  }
}

@utility text-h3 {
  font-family: var(--font-sans);
  font-weight: 600;
  font-size: 1.25rem;
  line-height: 1.75rem;
}

@layer base {
  html {
    -webkit-tap-highlight-color: transparent;
    text-size-adjust: 100%;
  }

  body {
    font-family: var(--font-sans);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 4: Run the contrast test and confirm it passes**

Run: `npx vitest run --project unit tests/unit/app/theme-contrast.test.ts`
Expected: PASS (28 tests).

- [ ] **Step 5: Update `app/app.config.ts`**

Keep the touch-target comments and objects; replace `colors`:

```ts
    colors: {
      primary: 'coffee',
      secondary: 'caramel',
      neutral: 'cream',
      success: 'emerald',
      warning: 'amber',
      error: 'red',
      info: 'indigo',
    },
```

- [ ] **Step 6: Install the icon collection**

Run: `npm install --save-exact @iconify-json/lucide@1.2.149`

- [ ] **Step 7: Update `nuxt.config.ts`**

Add these top-level keys and replace the existing `app.head`:

```ts
  fonts: {
    defaults: { subsets: ['vietnamese', 'latin'], styles: ['normal'] },
    families: [
      { name: 'Fraunces', provider: 'google', weights: [500, 600], preload: true },
      { name: 'Work Sans', provider: 'google', weights: [400, 500, 600] },
      { name: 'IBM Plex Mono', provider: 'google', weights: [400, 500] },
    ],
  },
  colorMode: { preference: 'system', fallback: 'light', storageKey: 'zeno-color-mode' },
  icon: { serverBundle: 'local', clientBundle: { scan: true } },
  app: {
    head: {
      htmlAttrs: { lang: 'vi' },
      titleTemplate: '%s — ZENO',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'description', content: 'Đặt món tại bàn qua QR cho quán cafe & trà sữa.' },
        { name: 'apple-mobile-web-app-title', content: 'ZENO' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },
```

- [ ] **Step 8: Replace `app/app.vue`**

```vue
<script setup lang="ts">
const colorMode = useColorMode()

useHead({
  meta: [{ name: 'theme-color', content: () => (colorMode.value === 'dark' ? '#1c1410' : '#fdf6ec') }],
})
</script>

<template>
  <UApp :toaster="{ position: 'top-center' }">
    <NuxtLoadingIndicator color="var(--ui-primary)" :height="3" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

- [ ] **Step 9: Create `public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#8b5e3c"/>
  <path d="M17 27h24v9a12 12 0 0 1-12 12h0a12 12 0 0 1-12-12z" fill="#fdf6ec"/>
  <path d="M41 30h3a5.5 5.5 0 0 1 0 11h-3.5" fill="none" stroke="#fdf6ec" stroke-width="3.5" stroke-linecap="round"/>
  <path d="M24 13c-2.5 2.8 2.5 5.2 0 8.5M32 13c-2.5 2.8 2.5 5.2 0 8.5" fill="none" stroke="#e4c9ac" stroke-width="3" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 10: Create `scripts/generate-icons.mjs`** and run it

```js
// Renders PNG app icons from public/favicon.svg. Run: node scripts/generate-icons.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const targets = [
  ['apple-touch-icon.png', 180, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['icon-maskable-512.png', 512, 0.12],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [file, size, pad] of targets) {
  const inner = Math.round(size * (1 - 2 * pad))
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<body style="margin:0;background:#8b5e3c;display:grid;place-items:center;height:${size}px">${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</body>`)
  await writeFile(new URL(`../public/${file}`, import.meta.url), await page.screenshot({ type: 'png' }))
}
await browser.close()
```

Run: `node scripts/generate-icons.mjs && ls -la public`
Expected: the four PNG files exist and are non-empty.

- [ ] **Step 11: Create `public/site.webmanifest`**

```json
{
  "name": "ZENO Order",
  "short_name": "ZENO",
  "lang": "vi",
  "start_url": "/app/orders",
  "display": "standalone",
  "background_color": "#fdf6ec",
  "theme_color": "#8b5e3c",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 12: Remove the ` — ZENO` suffix** from every existing `useHead({ title })`, because the title template now adds it:
  - `login.vue` → `'Đăng nhập'`
  - `signup.vue` → `'Tạo tài khoản'`
  - `onboarding.vue` → `'Tạo cửa hàng'`
  - `app/orders.vue` → `'Đơn hàng'`
  - `app/settings.vue` → `'Cài đặt'`
  - `index.vue`: change to `useHead({ title: 'ZENO Order', titleTemplate: '%s' })`.

- [ ] **Step 13: Verify that the build and the overrides actually apply**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all pass.

Then start `npx nuxt dev --port 3200` and run this in the browser on `/login`:

```js
getComputedStyle(document.documentElement).getPropertyValue('--ui-primary')
```

Expected: it resolves to `#8b5e3c`. If Nuxt UI's injected color style wins instead, move the `--ui-*` overrides into `:root:root` / `.dark.dark` to raise specificity, then re-check.

Also confirm that a `shadow-raised` element has a non-`none` computed `box-shadow`.

- [ ] **Step 14: Commit**

```bash
git add -A app/assets/css/main.css app/app.config.ts app/app.vue nuxt.config.ts package.json package-lock.json public scripts tests/unit/app/theme-contrast.test.ts app/pages
git commit -m "feat(ui): add CafeBlend tokens, fonts, color mode and brand icons" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Component test harness, `ZButton`, and the ESLint guard

**Files:**
- Modify: `vitest.config.ts`, `package.json` (scripts), `.github/workflows/ci.yml`, `eslint.config.mjs`
- Create: `app/components/z/Button.vue`
- Test: `tests/nuxt/z/button.test.ts`

**Interfaces:**
- Produces: the `ZButton` props below (default slot = label). All non-prop attributes (`aria-label`, `form`, `data-testid`, `onClick`) fall through to the rendered `<button>`/`<a>`.

```ts
{
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' // default 'primary'
  size?: 'sm' | 'md' | 'lg'                                   // default 'md'
  type?: 'button' | 'submit' | 'reset'                         // default 'button'
  to?: RouteLocationRaw
  target?: '_blank' | '_self'
  icon?: string
  trailingIcon?: string
  loading?: boolean
  disabled?: boolean
  block?: boolean
  square?: boolean
}
```

- [ ] **Step 1: Add the `nuxt` Vitest project** in `vitest.config.ts`. Import `defineVitestProject` from `@nuxt/test-utils/config` and append this to `projects`:

```ts
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['tests/nuxt/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: { nuxt: { domEnvironment: 'happy-dom' } },
        },
      }),
```

- [ ] **Step 2: Update the scripts** in `package.json`:

```json
    "test": "vitest run --project unit --project nuxt",
    "test:nuxt": "vitest run --project nuxt",
```

In `.github/workflows/ci.yml`, add `- run: npm run test:nuxt` after `- run: npm run test:unit`.

- [ ] **Step 3: Write the failing test** in `tests/nuxt/z/button.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import ZButton from '~/components/z/Button.vue'

function renderButton(props: Record<string, unknown> = {}, label = 'Lưu') {
  return renderSuspended(ZButton, { props, slots: { default: () => h('span', label) } })
}

describe('ZButton', () => {
  it('renders a primary, 44px, type=button button by default', async () => {
    await renderButton()
    const button = screen.getByRole('button', { name: 'Lưu' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toContain('bg-primary')
    expect(button.className).toContain('min-h-11')
  })

  it('marks itself busy and disabled while loading', async () => {
    await renderButton({ loading: true })
    const button = screen.getByRole('button', { name: /Lưu/ })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['sm', 'min-h-9'],
    ['lg', 'min-h-[50px]'],
  ])('size %s uses %s', async (size, cls) => {
    await renderButton({ size })
    expect(screen.getByRole('button').className).toContain(cls)
  })

  it('uses the error color for destructive', async () => {
    await renderButton({ variant: 'destructive' }, 'Xoá')
    expect(screen.getByRole('button', { name: 'Xoá' }).className).toContain('bg-error')
  })

  it('renders a link when given `to`', async () => {
    await renderButton({ to: '/signup' }, 'Đăng ký')
    expect(screen.getByRole('link', { name: 'Đăng ký' }).getAttribute('href')).toBe('/signup')
  })
})
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run --project nuxt tests/nuxt/z/button.test.ts`
Expected: FAIL with a cannot-resolve error for `~/components/z/Button.vue`.

- [ ] **Step 5: Implement `app/components/z/Button.vue`**

```vue
<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

type Variant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type Size = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
  type?: 'button' | 'submit' | 'reset'
  to?: RouteLocationRaw
  target?: '_blank' | '_self'
  icon?: string
  trailingIcon?: string
  loading?: boolean
  disabled?: boolean
  block?: boolean
  square?: boolean
}>(), { variant: 'primary', size: 'md', type: 'button' })

const variants = {
  primary: {
    color: 'primary',
    variant: 'solid',
    class: 'bg-primary text-(--zeno-on-primary) hover:bg-(--zeno-primary-hover) shadow-raised-sm active:shadow-none dark:shadow-none',
  },
  secondary: {
    color: 'primary',
    variant: 'soft',
    class: 'bg-(--zeno-surface-hover) text-primary hover:bg-(--zeno-surface-inset) shadow-raised-sm active:shadow-none dark:shadow-none dark:ring-1 dark:ring-default',
  },
  ghost: {
    color: 'neutral',
    variant: 'ghost',
    class: 'text-(--zeno-text-muted) hover:bg-(--zeno-surface-hover) hover:text-default',
  },
  destructive: {
    color: 'error',
    variant: 'solid',
    class: 'bg-error text-white hover:bg-red-800 dark:text-(--zeno-on-primary) dark:hover:bg-red-300',
  },
} as const

// `sm` is 36px tall; the ::before pad extends its hit area to 44px.
const sizes: Record<Size, string> = {
  sm: "min-h-9 px-3.5 text-sm gap-1.5 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
  md: 'min-h-11 px-[18px] text-base gap-2',
  lg: 'min-h-[50px] px-6 text-base font-semibold gap-2',
}

const classes = computed(() => [
  'relative rounded-md font-medium justify-center transition-[background-color,box-shadow,color] duration-150',
  'disabled:opacity-40 aria-disabled:opacity-40 disabled:shadow-none aria-disabled:shadow-none',
  props.square ? 'px-0 min-w-11' : '',
  sizes[props.size],
  variants[props.variant].class,
])
</script>

<template>
  <UButton
    :to="to"
    :target="target"
    :type="type"
    :icon="icon"
    :trailing-icon="trailingIcon"
    :loading="loading"
    :disabled="disabled"
    :block="block"
    :square="square"
    :color="variants[variant].color"
    :variant="variants[variant].variant"
    :class="classes"
    :aria-busy="loading || undefined"
  >
    <slot />
  </UButton>
</template>
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `npx vitest run --project nuxt tests/nuxt/z/button.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Add the ESLint guard** in `eslint.config.mjs`:

```js
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  files: ['app/pages/**/*.vue', 'app/layouts/**/*.vue'],
  rules: {
    'vue/multi-word-component-names': 'off',
    // 'warn' until Task 9 migrates the last page; Task 9 Step 6 switches it to 'error'.
    'vue/no-restricted-syntax': ['warn', {
      selector: 'VElement[rawName=/^U(Button|Input|Select|Switch|Card|Alert|Badge|FormField)$/]',
      message: 'Use the Z* primitives (app/components/z) instead of Nuxt UI components in pages and layouts.',
    }],
  },
})
```

- [ ] **Step 8: Verify the guard fires**

Run: `npx eslint app/pages app/layouts`
Expected: warnings on existing `UButton`/`UInput` usages, which proves the rule works (Tasks 6–9 remove them). `npm run lint` still exits 0.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts package.json .github/workflows/ci.yml eslint.config.mjs app/components/z/Button.vue tests/nuxt/z/button.test.ts
git commit -m "feat(ui): add ZButton, nuxt component test project and Z* lint guard" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Form primitives — `ZInput`, `ZFormField`, `ZSelect`, `ZSwitch`

**Files:**
- Create: `app/components/z/Input.vue`, `app/components/z/FormField.vue`, `app/components/z/Select.vue`, `app/components/z/Switch.vue`
- Test: `tests/nuxt/z/form.test.ts`

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces:
  - `ZInput`
    - `v-model: string | number | null | undefined`
    - props: `type?: 'text'|'email'|'password'|'tel'|'url'|'search'|'number'` (default `'text'`), `size?: 'md'|'lg'` (default `'md'`: 48px; `lg`: 52px), `icon?`, `placeholder?`, `autocomplete?`, `readonly?`, `disabled?`
    - slots: `leading`, `trailing`
    - other attributes (`inputmode`, `autocapitalize`, `spellcheck`, `onFocus`, `onInput`) fall through to `<input>`
    - password inputs render a toggle button labelled `Hiện mật khẩu` / `Ẩn mật khẩu` with `aria-pressed`
  - `ZFormField`
    - props: `label?`, `name?`, `hint?`, `help?`, `description?`, `required?`
    - slots: `default`, `help`, `hint`
    - wires `<label for>` and `aria-describedby` through `UFormField`
  - `ZSelect`
    - `v-model: string | undefined`
    - props: `items: Array<{ label: string, value: string }>`, `placeholder?`, `size?: 'md'|'lg'`
    - other attributes fall through
  - `ZSwitch`
    - `v-model: boolean`
    - props: `label?`, `description?`, `disabled?`
    - the control is `role="switch"` with an accessible name equal to `label`, and a ≥44px hit area

- [ ] **Step 1: Write the failing tests** in `tests/nuxt/z/form.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ZFormField from '~/components/z/FormField.vue'
import ZInput from '~/components/z/Input.vue'
import ZSwitch from '~/components/z/Switch.vue'

describe('ZInput', () => {
  it('toggles password visibility with an accessible button', async () => {
    await renderSuspended(ZInput, { props: { type: 'password', modelValue: 'secret12' } })
    const input = document.querySelector('input')!
    expect(input.type).toBe('password')

    const toggle = screen.getByRole('button', { name: 'Hiện mật khẩu' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    await fireEvent.click(toggle)

    expect(input.type).toBe('text')
    const hide = screen.getByRole('button', { name: 'Ẩn mật khẩu' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')
  })

  it('does not render a toggle for non-password inputs', async () => {
    await renderSuspended(ZInput, { props: { type: 'email' } })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('emits v-model updates and uses 16px text', async () => {
    const onUpdate = vi.fn()
    await renderSuspended(ZInput, { props: { 'modelValue': '', 'onUpdate:modelValue': onUpdate } })
    const input = document.querySelector('input')!
    expect(input.className).toContain('text-base')
    await fireEvent.update(input, 'Trà sữa')
    expect(onUpdate).toHaveBeenLastCalledWith('Trà sữa')
  })
})

describe('ZFormField', () => {
  it('labels its input and shows help text', async () => {
    const Field = defineComponent({
      setup: () => () => h(ZFormField, { label: 'Email', name: 'email', help: 'Dùng email công việc' }, {
        default: () => h(ZInput, { type: 'email' }),
      }),
    })
    await renderSuspended(Field)
    const input = screen.getByLabelText('Email')
    expect(input.tagName).toBe('INPUT')
    expect(screen.getByText('Dùng email công việc')).toBeTruthy()
  })
})

describe('ZSwitch', () => {
  it('exposes a named switch that toggles its model', async () => {
    const Host = defineComponent({
      setup: () => {
        const on = ref(false)
        return () => [
          h(ZSwitch, { 'label': 'Đang nhận đơn', 'modelValue': on.value, 'onUpdate:modelValue': (v: boolean) => { on.value = v } }),
          h('output', on.value ? 'on' : 'off'),
        ]
      },
    })
    await renderSuspended(Host)
    const control = screen.getByRole('switch', { name: 'Đang nhận đơn' })
    expect(control.getAttribute('aria-checked')).toBe('false')
    await fireEvent.click(control)
    expect(screen.getByText('on')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run --project nuxt tests/nuxt/z/form.test.ts`
Expected: FAIL with an unresolved-import error for `~/components/z/FormField.vue`.

- [ ] **Step 3: Implement `app/components/z/Input.vue`**

```vue
<script setup lang="ts">
const model = defineModel<string | number | null | undefined>()

const props = withDefaults(defineProps<{
  type?: 'text' | 'email' | 'password' | 'tel' | 'url' | 'search' | 'number'
  size?: 'md' | 'lg'
  icon?: string
  placeholder?: string
  autocomplete?: string
  readonly?: boolean
  disabled?: boolean
}>(), { type: 'text', size: 'md' })

const slots = defineSlots<{ leading?: () => unknown, trailing?: () => unknown }>()

const revealed = ref(false)
const isPassword = computed(() => props.type === 'password')
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))

const ui = computed(() => ({
  root: 'w-full',
  base: [
    'rounded-md border-0 bg-(--zeno-surface-inset) text-base text-default placeholder:text-dimmed shadow-inset',
    'hover:bg-(--zeno-surface-inset-hover) dark:inset-ring dark:inset-ring-(--zeno-border)',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    'aria-invalid:ring-2 aria-invalid:ring-error aria-invalid:bg-(--zeno-error-wash) aria-invalid:shadow-none',
    'disabled:bg-(--zeno-surface-disabled) disabled:opacity-100 disabled:text-muted disabled:shadow-none',
    props.size === 'lg' ? 'min-h-[52px] px-4' : 'min-h-12 px-3.5',
    isPassword.value ? 'pe-12' : '',
  ].join(' '),
  leadingIcon: 'size-5 text-muted',
  trailing: 'pe-1',
}))
</script>

<template>
  <UInput
    v-model="model"
    :type="inputType"
    :icon="icon"
    :placeholder="placeholder"
    :autocomplete="autocomplete"
    :readonly="readonly"
    :disabled="disabled"
    variant="none"
    size="lg"
    :ui="ui"
  >
    <template v-if="slots.leading" #leading>
      <slot name="leading" />
    </template>
    <template v-if="isPassword || slots.trailing" #trailing>
      <slot name="trailing">
        <button
          type="button"
          class="flex size-11 items-center justify-center rounded-md text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="revealed ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'"
          :aria-pressed="revealed"
          @click="revealed = !revealed"
        >
          <UIcon :name="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'" class="size-5" />
        </button>
      </slot>
    </template>
  </UInput>
</template>
```

- [ ] **Step 4: Implement `app/components/z/FormField.vue`**

```vue
<script setup lang="ts">
defineProps<{
  label?: string
  name?: string
  hint?: string
  help?: string
  description?: string
  required?: boolean
}>()

const slots = defineSlots<{ default?: () => unknown, help?: () => unknown, hint?: () => unknown }>()

const ui = {
  root: 'w-full',
  labelWrapper: 'mb-1.5 flex items-baseline justify-between gap-2',
  label: 'block text-sm font-medium text-default',
  hint: 'text-[13px] text-muted',
  description: 'text-[13px] text-muted',
  help: 'mt-1.5 text-[13px] text-muted',
  error: 'mt-1.5 text-[13px] font-medium text-error',
}
</script>

<template>
  <UFormField :label="label" :name="name" :hint="hint" :help="help" :description="description" :required="required" :ui="ui">
    <slot />
    <template v-if="slots.help" #help>
      <slot name="help" />
    </template>
    <template v-if="slots.hint" #hint>
      <slot name="hint" />
    </template>
  </UFormField>
</template>
```

- [ ] **Step 5: Implement `app/components/z/Select.vue`**

```vue
<script setup lang="ts">
const model = defineModel<string | undefined>()

const props = withDefaults(defineProps<{
  items: Array<{ label: string, value: string }>
  placeholder?: string
  size?: 'md' | 'lg'
}>(), { size: 'md' })

const ui = computed(() => ({
  base: [
    'w-full rounded-md bg-(--zeno-surface-inset) text-base text-default shadow-inset ring-0',
    'hover:bg-(--zeno-surface-inset-hover) dark:inset-ring dark:inset-ring-(--zeno-border)',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    props.size === 'lg' ? 'min-h-[52px] ps-4 pe-10' : 'min-h-12 ps-3.5 pe-10',
  ].join(' '),
  value: 'text-base font-medium',
  trailingIcon: 'size-5 text-muted',
  content: 'bg-(--zeno-surface) ring-default',
  item: 'min-h-11 items-center text-base',
}))
</script>

<template>
  <USelect v-model="model" :items="items" :placeholder="placeholder" variant="none" size="lg" :ui="ui" />
</template>
```

- [ ] **Step 6: Implement `app/components/z/Switch.vue`**

```vue
<script setup lang="ts">
const model = defineModel<boolean>({ default: false })

defineProps<{ label?: string, description?: string, disabled?: boolean }>()

// The label row is 44px tall and an invisible ::before pad grows the toggle's own hit area to ≥44px.
const ui = {
  root: 'min-h-11 items-center gap-1',
  base: "relative before:absolute before:-inset-4 before:content-[''] data-[state=checked]:bg-primary data-[state=unchecked]:bg-(--zeno-surface-inset) dark:data-[state=unchecked]:bg-(--zeno-border)",
  wrapper: 'ms-3',
  label: 'flex min-h-11 items-center text-base font-medium text-default',
  description: '-mt-2 text-[13px] text-muted',
}
</script>

<template>
  <USwitch v-model="model" :label="label" :description="description" :disabled="disabled" size="lg" :ui="ui" />
</template>
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run --project nuxt tests/nuxt/z/form.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Commit**

```bash
git add app/components/z tests/nuxt/z/form.test.ts
git commit -m "feat(ui): add ZInput, ZFormField, ZSelect and ZSwitch primitives" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Surface primitives — `ZCard`, `ZAlert`, `ZBadge`

**Files:**
- Create: `app/components/z/Card.vue`, `app/components/z/Alert.vue`, `app/components/z/Badge.vue`
- Test: `tests/nuxt/z/surface.test.ts`

**Interfaces:**
- Produces:
  - `ZCard`
    - props: `variant?: 'raised'|'elevated'|'flat'` (default `'raised'`), `padding?: 'md'|'lg'` (default `'lg'`), `title?`, `description?`
    - slots: `default`, `header`, `footer`
  - `ZAlert`
    - props: `color?: 'info'|'success'|'warning'|'error'` (default `'info'`), `title?`, `description?`, `icon?`
    - slots: `description`, `actions`
    - root has `role="alert"` for error/warning and `role="status"` otherwise
  - `ZBadge`
    - props: `status?: 'success'|'warning'|'error'|'info'|'neutral'` (default `'neutral'`), `size?: 'sm'|'md'` (default `'md'`), `icon?`
    - default slot = text

- [ ] **Step 1: Write the failing tests** in `tests/nuxt/z/surface.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import ZAlert from '~/components/z/Alert.vue'
import ZBadge from '~/components/z/Badge.vue'
import ZCard from '~/components/z/Card.vue'

describe('ZAlert', () => {
  it.each([
    ['error', 'alert'],
    ['warning', 'alert'],
    ['info', 'status'],
    ['success', 'status'],
  ])('%s uses role=%s', async (color, role) => {
    await renderSuspended(ZAlert, { props: { color, title: 'Thông báo' } })
    expect(screen.getByRole(role).textContent).toContain('Thông báo')
  })

  it('renders an actions slot', async () => {
    await renderSuspended(ZAlert, {
      props: { color: 'warning', title: 'Tạm nghỉ' },
      slots: { actions: () => h('button', 'Bật nhận đơn') },
    })
    expect(screen.getByRole('button', { name: 'Bật nhận đơn' })).toBeTruthy()
  })
})

describe('ZBadge', () => {
  it.each([
    ['success', 'bg-emerald-100'],
    ['warning', 'bg-amber-100'],
    ['error', 'bg-red-100'],
    ['info', 'bg-indigo-100'],
  ])('%s uses %s', async (status, cls) => {
    await renderSuspended(ZBadge, { props: { status }, slots: { default: () => 'Nhãn' } })
    expect(screen.getByText('Nhãn').closest('span[class*="rounded-full"]')!.className).toContain(cls)
  })
})

describe('ZCard', () => {
  it('renders title and body, raised by default', async () => {
    const { container } = await renderSuspended(ZCard, {
      props: { title: 'Nhận đơn' },
      slots: { default: () => h('p', 'Nội dung') },
    })
    expect(screen.getByText('Nhận đơn')).toBeTruthy()
    expect(screen.getByText('Nội dung')).toBeTruthy()
    expect((container.firstElementChild as HTMLElement).className).toContain('shadow-raised')
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run --project nuxt tests/nuxt/z/surface.test.ts`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement `app/components/z/Card.vue`**

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{
  variant?: 'raised' | 'elevated' | 'flat'
  padding?: 'md' | 'lg'
  title?: string
  description?: string
}>(), { variant: 'raised', padding: 'lg' })

const slots = defineSlots<{ default?: () => unknown, header?: () => unknown, footer?: () => unknown }>()

const surfaces = {
  raised: 'shadow-raised dark:ring-1 dark:ring-default',
  elevated: 'shadow-md dark:ring-1 dark:ring-default',
  flat: 'ring-1 ring-default',
}

const ui = computed(() => {
  const pad = props.padding === 'lg' ? 'p-4 sm:p-6' : 'p-4'
  return {
    root: `rounded-md bg-(--zeno-surface) overflow-visible divide-y-0 ${surfaces[props.variant]}`,
    header: `${pad} pb-0 sm:pb-0`,
    title: 'text-h3 text-default',
    description: 'mt-1 text-sm text-muted',
    body: pad,
    footer: `${pad} pt-0 sm:pt-0`,
  }
})
</script>

<template>
  <UCard :title="title" :description="description" :ui="ui">
    <template v-if="slots.header" #header>
      <slot name="header" />
    </template>
    <slot />
    <template v-if="slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
```

If `UCard` does not accept `title`/`description` props in 4.12 (check `node_modules/@nuxt/ui/dist/runtime/components/Card.vue.d.ts`), render them inside the `header` slot instead:

```vue
<template v-if="title || description || slots.header" #header>
  <slot name="header">
    <h2 v-if="title" class="text-h3 text-default">{{ title }}</h2>
    <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
  </slot>
</template>
```

- [ ] **Step 4: Implement `app/components/z/Alert.vue`**

```vue
<script setup lang="ts">
type Color = 'info' | 'success' | 'warning' | 'error'

const props = withDefaults(defineProps<{
  color?: Color
  title?: string
  description?: string
  icon?: string
}>(), { color: 'info' })

const slots = defineSlots<{ description?: () => unknown, actions?: () => unknown }>()

const tones: Record<Color, string> = {
  info: 'bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200 dark:bg-indigo-400/10 dark:text-indigo-100 dark:ring-indigo-400/25',
  success: 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-100 dark:ring-emerald-400/25',
  warning: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-100 dark:ring-amber-400/25',
  error: 'bg-red-50 text-red-900 ring-1 ring-red-200 dark:bg-red-400/10 dark:text-red-100 dark:ring-red-400/25',
}

const icons: Record<Color, string> = {
  info: 'i-lucide-info',
  success: 'i-lucide-circle-check',
  warning: 'i-lucide-triangle-alert',
  error: 'i-lucide-circle-alert',
}

const role = computed(() => (props.color === 'error' || props.color === 'warning' ? 'alert' : 'status'))
const ui = computed(() => ({
  root: `rounded-md p-4 gap-3 ${tones[props.color]}`,
  title: 'text-sm font-semibold',
  description: 'mt-0.5 text-sm opacity-100',
  icon: 'size-5 shrink-0',
  actions: 'mt-3',
}))
</script>

<template>
  <UAlert color="neutral" variant="outline" :title="title" :description="description" :icon="icon ?? icons[color]" :role="role" :ui="ui">
    <template v-if="slots.description" #description>
      <slot name="description" />
    </template>
    <template v-if="slots.actions" #actions>
      <slot name="actions" />
    </template>
  </UAlert>
</template>
```

- [ ] **Step 5: Implement `app/components/z/Badge.vue`**

```vue
<script setup lang="ts">
type Status = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const props = withDefaults(defineProps<{
  status?: Status
  size?: 'sm' | 'md'
  icon?: string
}>(), { status: 'neutral', size: 'md' })

const tones: Record<Status, string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-400/15 dark:text-red-200',
  info: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-200',
  neutral: 'bg-(--zeno-surface-inset) text-(--zeno-text-muted)',
}

const classes = computed(() => [
  'rounded-full font-medium ring-0',
  props.size === 'sm' ? 'px-2 py-0.5 text-xs gap-1' : 'px-2.5 py-1 text-[13px] gap-1.5',
  tones[props.status],
])
</script>

<template>
  <UBadge color="neutral" variant="soft" :icon="icon" :class="classes">
    <slot />
  </UBadge>
</template>
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run --project nuxt tests/nuxt/z/surface.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Commit**

```bash
git add app/components/z tests/nuxt/z/surface.test.ts
git commit -m "feat(ui): add ZCard, ZAlert and ZBadge primitives" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: App components — `AppLogo`, `AppPageHeader`, `AppEmptyState`, `AppColorModeToggle`, `AppCopyField`

**Files:**
- Create: `app/components/app/Logo.vue`, `app/components/app/PageHeader.vue`, `app/components/app/EmptyState.vue`, `app/components/app/ColorModeToggle.vue`, `app/components/app/CopyField.vue`
- Test: `tests/nuxt/app/copy-field.test.ts`, `tests/nuxt/app/color-mode-toggle.test.ts`

**Interfaces:**
- Consumes: `ZButton`, `ZInput`, `ZFormField`, `ZSwitch`.
- Produces:
  - `AppLogo`
    - props: `size?: 'sm'|'md'|'lg'` (default `'md'`), `variant?: 'full'|'mark'` (default `'full'`), `to?: string`
    - when `to` is set, renders a link labelled `ZENO — Trang chủ`
  - `AppPageHeader`
    - props: `title: string`, `description?`
    - slot: `actions`
    - renders the `<h1>`
  - `AppEmptyState`
    - props: `icon: string`, `title: string`, `description?`, `headingLevel?: 'h1'|'h2'` (default `'h2'`)
    - slot: `actions`
  - `AppColorModeToggle`
    - props: `variant?: 'icon'|'row'` (default `'icon'`)
    - `icon` variant: a button labelled `Chuyển sang giao diện tối` / `Chuyển sang giao diện sáng`
    - `row` variant: a `ZSwitch` labelled `Giao diện tối`
    - sets `useColorMode().preference`
  - `AppCopyField`
    - props: `value: string`, `label: string`
    - buttons `Sao chép liên kết` and `Chia sẻ liên kết` (the latter only when `navigator.share` exists)
    - announces `Đã sao chép` via `aria-live`
    - when the Clipboard API is unavailable, selects the input text and shows `Nhấn giữ để sao chép`

- [ ] **Step 1: Write the failing tests**

`tests/nuxt/app/copy-field.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppCopyField from '~/components/app/CopyField.vue'

const URL_VALUE = 'https://zeno.vn/s/tra-sua-may'

function setNavigator(key: 'clipboard' | 'share', value: unknown) {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true })
}

afterEach(() => {
  setNavigator('clipboard', undefined)
  setNavigator('share', undefined)
})

describe('AppCopyField', () => {
  it('copies the value and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setNavigator('clipboard', { writeText })
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })

    expect((screen.getByLabelText('Link đặt món') as HTMLInputElement).value).toBe(URL_VALUE)
    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }))

    expect(writeText).toHaveBeenCalledWith(URL_VALUE)
    expect(await screen.findByText('Đã sao chép')).toBeTruthy()
  })

  it('falls back to selecting the text when the Clipboard API is unavailable', async () => {
    setNavigator('clipboard', undefined)
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })
    const input = screen.getByLabelText('Link đặt món') as HTMLInputElement
    const select = vi.spyOn(input, 'select')

    await fireEvent.click(screen.getByRole('button', { name: 'Sao chép liên kết' }))

    expect(select).toHaveBeenCalled()
    expect((await screen.findAllByText('Nhấn giữ để sao chép')).length).toBeGreaterThan(0)
  })

  it('shows a share button only when Web Share is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setNavigator('share', share)
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Chia sẻ liên kết' }))
    expect(share).toHaveBeenCalledWith({ url: URL_VALUE })
  })

  it('hides the share button without Web Share', async () => {
    await renderSuspended(AppCopyField, { props: { value: URL_VALUE, label: 'Link đặt món' } })
    expect(screen.queryByRole('button', { name: 'Chia sẻ liên kết' })).toBeNull()
  })
})
```

`tests/nuxt/app/color-mode-toggle.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import AppColorModeToggle from '~/components/app/ColorModeToggle.vue'

describe('AppColorModeToggle', () => {
  it('switches the preference between light and dark', async () => {
    const colorMode = useColorMode()
    colorMode.preference = 'light'
    await renderSuspended(AppColorModeToggle)

    await fireEvent.click(await screen.findByRole('button', { name: 'Chuyển sang giao diện tối' }))
    expect(colorMode.preference).toBe('dark')
  })

  it('row variant exposes a labelled switch', async () => {
    const colorMode = useColorMode()
    colorMode.preference = 'light'
    await renderSuspended(AppColorModeToggle, { props: { variant: 'row' } })

    await fireEvent.click(await screen.findByRole('switch', { name: 'Giao diện tối' }))
    expect(colorMode.preference).toBe('dark')
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run --project nuxt tests/nuxt/app`
Expected: FAIL with unresolved imports.

- [ ] **Step 3: Implement `app/components/app/Logo.vue`**

```vue
<script setup lang="ts">
const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  variant?: 'full' | 'mark'
  to?: string
}>(), { size: 'md', variant: 'full' })

const sizes = {
  sm: { mark: 'size-7', text: 'text-lg' },
  md: { mark: 'size-8', text: 'text-xl' },
  lg: { mark: 'size-10', text: 'text-2xl' },
}

const NuxtLink = resolveComponent('NuxtLink')
const tag = computed(() => (props.to ? NuxtLink : 'span'))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :aria-label="to ? 'ZENO — Trang chủ' : undefined"
    class="inline-flex min-h-11 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
  >
    <svg :class="sizes[size].mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" class="fill-primary" />
      <path d="M17 27h24v9a12 12 0 0 1-12 12h0a12 12 0 0 1-12-12z" class="fill-(--zeno-bg)" />
      <path d="M41 30h3a5.5 5.5 0 0 1 0 11h-3.5" fill="none" stroke-width="3.5" stroke-linecap="round" class="stroke-(--zeno-bg)" />
      <path d="M24 13c-2.5 2.8 2.5 5.2 0 8.5M32 13c-2.5 2.8 2.5 5.2 0 8.5" fill="none" stroke-width="3" stroke-linecap="round" class="stroke-coffee-200" />
    </svg>
    <span v-if="variant === 'full'" :class="sizes[size].text" class="font-display font-semibold tracking-tight text-default">zeno</span>
  </component>
</template>
```

- [ ] **Step 4: Implement `app/components/app/PageHeader.vue`**

```vue
<script setup lang="ts">
defineProps<{ title: string, description?: string }>()
const slots = defineSlots<{ actions?: () => unknown }>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-h2 text-default">
        {{ title }}
      </h1>
      <p v-if="description" class="mt-1 text-sm text-muted">
        {{ description }}
      </p>
    </div>
    <div v-if="slots.actions" class="flex flex-wrap gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
```

- [ ] **Step 5: Implement `app/components/app/EmptyState.vue`**

```vue
<script setup lang="ts">
withDefaults(defineProps<{
  icon: string
  title: string
  description?: string
  headingLevel?: 'h1' | 'h2'
}>(), { headingLevel: 'h2' })

const slots = defineSlots<{ actions?: () => unknown }>()
</script>

<template>
  <section class="flex flex-col items-center gap-4 px-2 py-8 text-center sm:py-12">
    <div class="flex size-20 items-center justify-center rounded-full bg-(--zeno-surface-inset) shadow-inset dark:shadow-none">
      <UIcon :name="icon" class="size-9 text-primary" />
    </div>
    <component :is="headingLevel" class="text-h3 text-default">
      {{ title }}
    </component>
    <p v-if="description" class="max-w-xs text-muted">
      {{ description }}
    </p>
    <div v-if="slots.actions" class="mt-2 flex w-full max-w-sm flex-col gap-3 text-start">
      <slot name="actions" />
    </div>
  </section>
</template>
```

- [ ] **Step 6: Implement `app/components/app/ColorModeToggle.vue`**

```vue
<script setup lang="ts">
withDefaults(defineProps<{ variant?: 'icon' | 'row' }>(), { variant: 'icon' })

const colorMode = useColorMode()
const isDark = computed({
  get: () => colorMode.value === 'dark',
  set: (dark: boolean) => { colorMode.preference = dark ? 'dark' : 'light' },
})
</script>

<template>
  <ClientOnly>
    <ZButton
      v-if="variant === 'icon'"
      variant="ghost"
      square
      :icon="isDark ? 'i-lucide-sun' : 'i-lucide-moon'"
      :aria-label="isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'"
      @click="isDark = !isDark"
    />
    <ZSwitch v-else v-model="isDark" label="Giao diện tối" />
    <template #fallback>
      <span :class="variant === 'icon' ? 'inline-block size-11' : 'block h-11'" aria-hidden="true" />
    </template>
  </ClientOnly>
</template>
```

- [ ] **Step 7: Implement `app/components/app/CopyField.vue`**

```vue
<script setup lang="ts">
const props = defineProps<{ value: string, label: string }>()

const wrapper = useTemplateRef<HTMLElement>('wrapper')
const copied = ref(false)
const fallback = ref(false)
const announcement = ref('')
const canShare = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  canShare.value = typeof navigator.share === 'function'
})
onBeforeUnmount(() => clearTimeout(resetTimer))

function selectText() {
  wrapper.value?.querySelector('input')?.select()
}

async function copy() {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
    await navigator.clipboard.writeText(props.value)
    fallback.value = false
    copied.value = true
    announcement.value = 'Đã sao chép'
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => {
      copied.value = false
      announcement.value = ''
    }, 2000)
  }
  catch {
    fallback.value = true
    selectText()
    announcement.value = 'Nhấn giữ để sao chép'
  }
}

async function share() {
  try {
    await navigator.share({ url: props.value })
  }
  catch {
    // The user dismissed the share sheet; nothing to recover.
  }
}
</script>

<template>
  <div ref="wrapper" class="flex flex-col gap-1.5">
    <ZFormField :label="label">
      <div class="flex gap-2">
        <ZInput :model-value="value" readonly class="min-w-0 flex-1 font-mono" @focus="selectText" />
        <ZButton
          variant="secondary"
          square
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          aria-label="Sao chép liên kết"
          @click="copy"
        />
        <ZButton
          v-if="canShare"
          variant="secondary"
          square
          icon="i-lucide-share-2"
          aria-label="Chia sẻ liên kết"
          @click="share"
        />
      </div>
    </ZFormField>
    <p v-if="fallback" class="text-[13px] text-muted">
      Nhấn giữ để sao chép
    </p>
    <p class="sr-only" aria-live="polite">
      {{ announcement }}
    </p>
  </div>
</template>
```

`ZInput` font: the `font-mono` class lands on `UInput`'s root. If the text does not render in mono, use a `:ui` override instead.

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run --project nuxt tests/nuxt/app`
Expected: PASS (6 tests).

- [ ] **Step 9: Commit**

```bash
git add app/components/app tests/nuxt/app
git commit -m "feat(ui): add logo, page header, empty state, color mode toggle and copy field" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: `AppAuthShell` and the auth screens (`/login`, `/signup`, `/onboarding`)

**Files:**
- Create: `app/components/app/AuthShell.vue`, `app/utils/password-strength.ts`
- Modify: `app/pages/login.vue`, `app/pages/signup.vue`, `app/pages/onboarding.vue`, `tests/e2e/onboarding.spec.ts`
- Test: `tests/unit/app/password-strength.test.ts`, `tests/nuxt/app/auth-shell.test.ts`

**Interfaces:**
- Consumes: `ZCard`, `ZAlert`, `ZFormField`, `ZInput`, `ZButton`, `AppLogo`.
- Produces:
  - `AppAuthShell`
    - props: `title: string`, `description?`, `step?: { current: number, total: number, label: string }`
    - slots: `default` (form), `footer`
    - renders the page `<main>` and `<h1>`
  - `passwordStrength(password: string): { level: 0 | 1 | 2 | 3 | 4, label: string }`

- [ ] **Step 1: Write the failing unit test** in `tests/unit/app/password-strength.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { passwordStrength } from '../../../app/utils/password-strength'

describe('passwordStrength', () => {
  it.each([
    ['', 0, ''],
    ['abc', 1, 'Yếu'],
    ['abcdefg', 1, 'Yếu'],
    ['abcdefgh', 2, 'Khá'],
    ['abcdefghijk', 2, 'Khá'],
    ['abcdefghijkl', 3, 'Tốt'],
    ['abcdefghijklmno', 3, 'Tốt'],
    ['abcdefghijklmnop', 4, 'Rất tốt'],
  ])('%j → level %i (%s)', (password, level, label) => {
    expect(passwordStrength(password)).toEqual({ level, label })
  })

  it('counts Vietnamese characters as single characters', () => {
    expect(passwordStrength('mậtkhẩuạ').level).toBe(2)
  })
})
```

- [ ] **Step 2: Write the failing component test** in `tests/nuxt/app/auth-shell.test.ts`:

```ts
import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import AppAuthShell from '~/components/app/AuthShell.vue'

describe('AppAuthShell', () => {
  it('renders one h1, the step indicator, form slot and footer', async () => {
    await renderSuspended(AppAuthShell, {
      props: { title: 'Tạo cửa hàng đầu tiên', step: { current: 2, total: 2, label: 'Tạo cửa hàng' } },
      slots: { default: () => h('form', { 'aria-label': 'Biểu mẫu' }), footer: () => h('p', 'Chân trang') },
    })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Tạo cửa hàng đầu tiên' })).toBeTruthy()
    expect(screen.getByText('Bước 2/2 · Tạo cửa hàng')).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Biểu mẫu' })).toBeTruthy()
    expect(screen.getByText('Chân trang')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `npx vitest run --project unit tests/unit/app/password-strength.test.ts; npx vitest run --project nuxt tests/nuxt/app/auth-shell.test.ts`
Expected: both FAIL with unresolved imports.

- [ ] **Step 4: Implement `app/utils/password-strength.ts`**

```ts
export interface PasswordStrength {
  level: 0 | 1 | 2 | 3 | 4
  label: string
}

/** Length-based strength for the sign-up meter; the server-side rule stays "at least 8 characters". */
export function passwordStrength(password: string): PasswordStrength {
  const length = [...password].length
  if (length === 0) return { level: 0, label: '' }
  if (length < 8) return { level: 1, label: 'Yếu' }
  if (length < 12) return { level: 2, label: 'Khá' }
  if (length < 16) return { level: 3, label: 'Tốt' }
  return { level: 4, label: 'Rất tốt' }
}
```

- [ ] **Step 5: Implement `app/components/app/AuthShell.vue`**

```vue
<script setup lang="ts">
defineProps<{
  title: string
  description?: string
  step?: { current: number, total: number, label: string }
}>()

const slots = defineSlots<{ default?: () => unknown, footer?: () => unknown }>()

const benefits = [
  'Khách quét QR, gọi món không cần app',
  'Thanh toán VietQR tự đối soát',
  'Nhận và xử lý đơn ngay trên điện thoại',
]
</script>

<template>
  <div class="relative min-h-dvh bg-default lg:grid lg:grid-cols-2">
    <aside class="relative hidden overflow-hidden bg-primary p-12 text-(--zeno-on-primary) lg:flex lg:flex-col lg:justify-between">
      <div aria-hidden="true" class="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
      <p class="relative font-display text-2xl font-semibold tracking-tight">
        zeno
      </p>
      <div class="relative flex flex-col gap-8">
        <p class="font-display text-4xl leading-tight font-semibold">
          Đặt món tại bàn,<br>không cần app.
        </p>
        <ul class="flex flex-col gap-3">
          <li v-for="benefit in benefits" :key="benefit" class="flex items-center gap-3">
            <UIcon name="i-lucide-circle-check" class="size-5 shrink-0" />
            <span>{{ benefit }}</span>
          </li>
        </ul>
      </div>
      <p class="relative text-sm opacity-90">
        © ZENO
      </p>
    </aside>

    <main class="relative flex min-h-dvh flex-col overflow-hidden px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
      <div aria-hidden="true" class="pointer-events-none absolute -right-28 -top-28 size-72 rounded-full bg-secondary/25 blur-3xl dark:bg-secondary/10 lg:hidden" />
      <div aria-hidden="true" class="pointer-events-none absolute -bottom-32 -left-24 size-72 rounded-full bg-primary/10 blur-3xl lg:hidden" />

      <header class="relative">
        <AppLogo to="/" />
      </header>

      <div class="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 py-8">
        <div>
          <p v-if="step" class="mb-2 text-[13px] font-semibold text-primary">
            Bước {{ step.current }}/{{ step.total }} · {{ step.label }}
          </p>
          <h1 class="text-h1 text-default">
            {{ title }}
          </h1>
          <p v-if="description" class="mt-2 text-muted">
            {{ description }}
          </p>
        </div>

        <ZCard variant="raised" padding="lg">
          <slot />
        </ZCard>

        <div v-if="slots.footer" class="text-center text-sm text-muted">
          <slot name="footer" />
        </div>
      </div>
    </main>
  </div>
</template>
```

- [ ] **Step 6: Run both tests and confirm they pass**

Run: `npx vitest run --project unit tests/unit/app/password-strength.test.ts && npx vitest run --project nuxt tests/nuxt/app/auth-shell.test.ts`
Expected: PASS.

- [ ] **Step 7: Rewrite the `<template>` of `app/pages/login.vue`**

The script is unchanged apart from the title from Task 1.

```vue
<template>
  <AppAuthShell title="Đăng nhập" description="Quản lý đơn và menu của quán bạn.">
    <UForm :schema="schema" :state="state" class="flex flex-col gap-5" @submit="onSubmit">
      <ZAlert v-if="errorMessage" color="error" :title="errorMessage" />
      <ZFormField label="Email" name="email">
        <ZInput v-model="state.email" type="email" autocomplete="email" inputmode="email" size="lg" />
      </ZFormField>
      <ZFormField label="Mật khẩu" name="password">
        <ZInput v-model="state.password" type="password" autocomplete="current-password" size="lg" />
      </ZFormField>
      <ZButton type="submit" size="lg" block :loading="loading">
        Đăng nhập
      </ZButton>
    </UForm>
    <template #footer>
      Chưa có tài khoản?
      <NuxtLink to="/signup" class="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline-offset-4 hover:underline">
        Đăng ký
      </NuxtLink>
    </template>
  </AppAuthShell>
</template>
```

- [ ] **Step 8: Rewrite `app/pages/signup.vue`**

Keep the script. Add `const strength = computed(() => passwordStrength(state.password ?? ''))` and the `strengthBar` map shown below.

```vue
<script setup lang="ts">
// …existing imports, schema, state, onSubmit unchanged…
const strength = computed(() => passwordStrength(state.password ?? ''))
const strengthBar: Record<number, string> = {
  1: 'bg-red-600',
  2: 'bg-amber-500',
  3: 'bg-emerald-500',
  4: 'bg-emerald-600',
}
</script>

<template>
  <AppAuthShell title="Tạo tài khoản chủ quán" description="Miễn phí khi bắt đầu, thiết lập trong vài phút.">
    <UForm :schema="schema" :state="state" class="flex flex-col gap-5" @submit="onSubmit">
      <ZAlert v-if="errorMessage" color="error" :title="errorMessage" />
      <ZFormField label="Tên của bạn" name="name">
        <ZInput v-model="state.name" autocomplete="name" size="lg" />
      </ZFormField>
      <ZFormField label="Email" name="email">
        <ZInput v-model="state.email" type="email" autocomplete="email" inputmode="email" size="lg" />
      </ZFormField>
      <div class="flex flex-col gap-2">
        <ZFormField label="Mật khẩu" name="password" hint="Ít nhất 8 ký tự">
          <ZInput v-model="state.password" type="password" autocomplete="new-password" size="lg" />
        </ZFormField>
        <div v-if="strength.level > 0" class="flex items-center gap-3">
          <div class="flex flex-1 gap-1" aria-hidden="true">
            <span
              v-for="i in 4"
              :key="i"
              class="h-1.5 flex-1 rounded-full transition-colors"
              :class="i <= strength.level ? strengthBar[strength.level] : 'bg-(--zeno-surface-inset)'"
            />
          </div>
          <span class="text-[13px] font-medium text-muted" aria-live="polite">Độ mạnh: {{ strength.label }}</span>
        </div>
      </div>
      <ZButton type="submit" size="lg" block :loading="loading">
        Tạo tài khoản
      </ZButton>
    </UForm>
    <template #footer>
      Đã có tài khoản?
      <NuxtLink to="/login" class="inline-flex min-h-11 items-center px-1 font-semibold text-primary underline-offset-4 hover:underline">
        Đăng nhập
      </NuxtLink>
    </template>
  </AppAuthShell>
</template>
```

- [ ] **Step 9: Rewrite the `<template>` of `app/pages/onboarding.vue`**

The script is unchanged.

```vue
<template>
  <AppAuthShell
    title="Tạo cửa hàng đầu tiên"
    description="Bạn có thể thêm món, bàn và thanh toán ở bước sau."
    :step="{ current: 2, total: 2, label: 'Tạo cửa hàng' }"
  >
    <UForm ref="form" :schema="onboardingInputSchema" :state="state" class="flex flex-col gap-6" @submit="onSubmit">
      <fieldset class="flex flex-col gap-4">
        <legend class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Doanh nghiệp
        </legend>
        <ZFormField label="Tên doanh nghiệp" name="orgName" help="Ví dụ: tên chủ quán hoặc tên chuỗi">
          <ZInput v-model="state.orgName" autocomplete="organization" size="lg" />
        </ZFormField>
      </fieldset>
      <fieldset class="flex flex-col gap-4">
        <legend class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Cửa hàng
        </legend>
        <ZFormField label="Tên cửa hàng" name="storeName">
          <ZInput v-model="state.storeName" size="lg" />
        </ZFormField>
        <ZFormField label="Đường dẫn cửa hàng" name="storeSlug">
          <ZInput
            v-model="state.storeSlug"
            size="lg"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            @input="slugTouched = true"
          >
            <template #leading>
              <span class="font-mono text-sm text-muted">/s/</span>
            </template>
          </ZInput>
          <template #help>
            <span class="break-all font-mono">{{ previewUrl }}</span>
          </template>
        </ZFormField>
      </fieldset>
      <ZButton type="submit" size="lg" block :loading="loading">
        Tạo cửa hàng
      </ZButton>
    </UForm>
  </AppAuthShell>
</template>
```

- [ ] **Step 10: Update E2E locators in `tests/e2e/onboarding.spec.ts`**

The password reveal button's label contains "mật khẩu", so every `getByLabel('Mật khẩu')` becomes `getByLabel('Mật khẩu', { exact: true })`. Leave other locators unchanged.

Run: `grep -n "getByLabel('Mật khẩu'" tests/e2e/*.ts`
Expected: every match includes `{ exact: true }`.

- [ ] **Step 11: Run the auth E2E tests**

Run: `npx playwright test tests/e2e/onboarding.spec.ts -g "login|visitor" --project=mobile-chrome`
Expected: PASS, covering the Vietnamese error message, the 44px controls, and the redirect.

- [ ] **Step 12: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck`
Expected: PASS. The Z* guard is still `warn`; login, signup and onboarding must no longer appear in its output.

```bash
git add app/components/app/AuthShell.vue app/utils/password-strength.ts app/pages/login.vue app/pages/signup.vue app/pages/onboarding.vue tests/unit/app/password-strength.test.ts tests/nuxt/app/auth-shell.test.ts tests/e2e/onboarding.spec.ts
git commit -m "feat(ui): restyle login, signup and onboarding with AppAuthShell" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Responsive owner shell and error page

**Files:**
- Create: `app/components/app/StoreSwitcher.vue`, `app/components/app/AccountMenu.vue`, `app/error.vue`
- Modify: `app/layouts/owner.vue`, `tests/e2e/onboarding.spec.ts`
- Test: `tests/nuxt/app/account-menu.test.ts`

**Interfaces:**
- Consumes:
  - `useActiveStore()` → `{ stores, activeStore, setActiveStore }`
  - `useMe()` → `{ me }` (`me.user.displayName`, `me.user.email`)
  - `useAuth()` → `{ signOut }`
  - `ZSelect`, `ZBadge`, `ZButton`, `AppColorModeToggle`, `AppLogo`, `AppEmptyState`
- Produces:
  - `AppStoreSwitcher`
    - keeps exactly one `data-testid="active-store-name"`
    - shows a badge `Đang nhận đơn` or `Tạm nghỉ`
  - `AppAccountMenu`
    - mobile (< md): a button labelled `Tài khoản` that opens a popover containing name, email, the `Giao diện tối` switch, and the `Đăng xuất` button
    - md+: the same content inline
  - Layout landmarks:
    - `<main id="main">`
    - `<nav data-testid="sidebar-nav" aria-label="Điều hướng chính">` (md+)
    - `<nav data-testid="bottom-nav" aria-label="Điều hướng chính">` (< md)
    - a skip link `Bỏ qua tới nội dung`

- [ ] **Step 1: Write the failing test** in `tests/nuxt/app/account-menu.test.ts`:

```ts
import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import AppAccountMenu from '~/components/app/AccountMenu.vue'

const { signOut, navigate } = vi.hoisted(() => ({
  signOut: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}))

mockNuxtImport('useAuth', () => () => ({ signOut }))
mockNuxtImport('navigateTo', () => navigate)

describe('AppAccountMenu', () => {
  it('shows the user and signs out to /login', async () => {
    useState('me', () => ({
      user: { id: 'u1', email: 'chu@quan.vn', displayName: 'Mây Trần' },
      organizations: [],
      stores: [],
    }))
    await renderSuspended(AppAccountMenu)

    expect(screen.getAllByText('Mây Trần').length).toBeGreaterThan(0)
    expect(screen.getAllByText('chu@quan.vn').length).toBeGreaterThan(0)
    const [signOutButton] = screen.getAllByRole('button', { name: 'Đăng xuất' })
    await fireEvent.click(signOutButton!)

    expect(signOut).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  it('still navigates to /login when signOut throws', async () => {
    signOut.mockRejectedValueOnce(new Error('network'))
    useState('me', () => ({ user: { id: 'u1', email: 'a@b.vn', displayName: null }, organizations: [], stores: [] }))
    await renderSuspended(AppAccountMenu)
    const [signOutButton] = screen.getAllByRole('button', { name: 'Đăng xuất' })
    await fireEvent.click(signOutButton!)
    expect(navigate).toHaveBeenLastCalledWith('/login')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project nuxt tests/nuxt/app/account-menu.test.ts`
Expected: FAIL with an unresolved import.

- [ ] **Step 3: Implement `app/components/app/StoreSwitcher.vue`**

```vue
<script setup lang="ts">
const { stores, activeStore, setActiveStore } = useActiveStore()

const storeItems = computed(() => stores.value.map(store => ({ label: store.name, value: store.id })))
const selectedStoreId = computed({
  get: () => activeStore.value?.id,
  set: (id) => {
    if (id) setActiveStore(id)
  },
})
</script>

<template>
  <div class="flex min-w-0 items-center gap-2 md:flex-col md:items-stretch md:gap-2">
    <template v-if="storeItems.length > 1">
      <ZSelect v-model="selectedStoreId" :items="storeItems" aria-label="Chọn cửa hàng" class="min-w-0 flex-1" />
      <span data-testid="active-store-name" class="sr-only">{{ activeStore?.name }}</span>
    </template>
    <p v-else data-testid="active-store-name" class="min-w-0 truncate font-semibold text-default md:text-lg">
      {{ activeStore?.name }}
    </p>
    <ZBadge
      v-if="activeStore"
      :status="activeStore.isAcceptingOrders ? 'success' : 'warning'"
      size="sm"
      :icon="activeStore.isAcceptingOrders ? 'i-lucide-circle-dot' : 'i-lucide-pause'"
      class="shrink-0 self-center md:self-start"
    >
      {{ activeStore.isAcceptingOrders ? 'Đang nhận đơn' : 'Tạm nghỉ' }}
    </ZBadge>
  </div>
</template>
```

- [ ] **Step 4: Implement `app/components/app/AccountMenu.vue`**

```vue
<script setup lang="ts">
const { me } = useMe()
const { signOut } = useAuth()
const route = useRoute()

const open = ref(false)
watch(() => route.fullPath, () => { open.value = false })

const name = computed(() => me.value?.user.displayName || me.value?.user.email || '')
const email = computed(() => me.value?.user.email ?? '')
const initial = computed(() => name.value.trim().charAt(0).toUpperCase() || '?')

async function onSignOut() {
  try {
    await signOut()
  }
  catch {
    // Local session state is already cleared by signOut(); nothing else to recover.
  }
  finally {
    await navigateTo('/login')
  }
}
</script>

<template>
  <div>
    <div class="md:hidden">
      <UPopover v-model:open="open" :content="{ align: 'end', sideOffset: 8 }" :ui="{ content: 'w-[min(18rem,calc(100vw-2rem))] bg-(--zeno-surface) ring-default' }">
        <button
          type="button"
          aria-label="Tài khoản"
          class="flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span class="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-(--zeno-on-primary)">{{ initial }}</span>
        </button>
        <template #content>
          <div class="flex flex-col gap-3 p-4">
            <div class="min-w-0">
              <p class="truncate font-semibold text-default">{{ name }}</p>
              <p class="truncate text-sm text-muted">{{ email }}</p>
            </div>
            <AppColorModeToggle variant="row" />
            <ZButton variant="secondary" block icon="i-lucide-log-out" @click="onSignOut">
              Đăng xuất
            </ZButton>
          </div>
        </template>
      </UPopover>
    </div>

    <div class="hidden md:flex md:flex-col md:gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-(--zeno-on-primary)">{{ initial }}</span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-default">{{ name }}</p>
          <p class="truncate text-[13px] text-muted">{{ email }}</p>
        </div>
      </div>
      <AppColorModeToggle variant="row" />
      <ZButton variant="ghost" block icon="i-lucide-log-out" class="justify-start" @click="onSignOut">
        Đăng xuất
      </ZButton>
    </div>
  </div>
</template>
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run --project nuxt tests/nuxt/app/account-menu.test.ts`
Expected: PASS. happy-dom ignores the `md:hidden` CSS, so the inline desktop button is present; this is why the test uses `getAllByRole(...)[0]`.

- [ ] **Step 6: Replace `app/layouts/owner.vue`**

```vue
<script setup lang="ts">
const navItems = [
  { label: 'Đơn hàng', to: '/app/orders', icon: 'i-lucide-receipt' },
  { label: 'Cài đặt', to: '/app/settings', icon: 'i-lucide-settings' },
]
</script>

<template>
  <div class="min-h-dvh bg-default md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
    <a
      href="#main"
      class="sr-only z-50 rounded-md bg-primary px-4 py-3 font-medium text-(--zeno-on-primary) focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >Bỏ qua tới nội dung</a>

    <aside
      class="sticky top-0 z-20 flex items-center gap-3 border-b border-default bg-default/95 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur md:h-dvh md:flex-col md:items-stretch md:gap-6 md:border-b-0 md:border-r md:bg-(--zeno-surface) md:px-4 md:py-6 md:backdrop-blur-none"
    >
      <AppLogo to="/app/orders" class="hidden md:inline-flex" />
      <AppStoreSwitcher class="min-w-0 flex-1 md:flex-none" />
      <nav data-testid="sidebar-nav" aria-label="Điều hướng chính" class="hidden md:block">
        <ul class="flex flex-col gap-1">
          <li v-for="item in navItems" :key="item.to">
            <NuxtLink
              :to="item.to"
              class="flex min-h-11 items-center gap-3 rounded-md border-l-3 border-transparent px-3 font-medium text-muted transition-colors hover:bg-(--zeno-surface-hover) hover:text-default aria-[current=page]:border-primary aria-[current=page]:bg-(--zeno-surface-inset) aria-[current=page]:text-primary"
            >
              <UIcon :name="item.icon" class="size-5" />
              {{ item.label }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
      <AppAccountMenu class="shrink-0 md:mt-auto" />
    </aside>

    <main id="main" tabindex="-1" class="mx-auto w-full max-w-5xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 outline-none md:px-8 md:pb-12 md:pt-8">
      <slot />
    </main>

    <nav
      data-testid="bottom-nav"
      aria-label="Điều hướng chính"
      class="fixed inset-x-0 bottom-0 z-20 border-t border-default bg-default/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul class="mx-auto flex max-w-lg">
        <li v-for="item in navItems" :key="item.to" class="flex-1">
          <NuxtLink
            :to="item.to"
            class="group flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted aria-[current=page]:font-semibold aria-[current=page]:text-primary"
          >
            <span class="flex h-8 w-14 items-center justify-center rounded-full transition-colors group-aria-[current=page]:bg-primary/12">
              <UIcon :name="item.icon" class="size-5" />
            </span>
            {{ item.label }}
          </NuxtLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
```

- [ ] **Step 7: Create `app/error.vue`**

```vue
<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)
const title = computed(() => (notFound.value ? 'Không tìm thấy trang' : 'Đã có lỗi xảy ra'))
const description = computed(() => (notFound.value
  ? 'Đường dẫn có thể đã thay đổi hoặc không còn tồn tại.'
  : 'Vui lòng thử lại sau ít phút.'))

useHead({ title })

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <UApp>
    <main class="flex min-h-dvh flex-col items-center justify-center bg-default px-4 py-10">
      <AppLogo class="mb-6" />
      <AppEmptyState
        heading-level="h1"
        :icon="notFound ? 'i-lucide-map-pin-off' : 'i-lucide-coffee'"
        :title="title"
        :description="description"
      >
        <template #actions>
          <ZButton size="lg" block @click="goHome">
            Về trang chủ
          </ZButton>
        </template>
      </AppEmptyState>
    </main>
  </UApp>
</template>
```

- [ ] **Step 8: Update the sign-out steps** in `tests/e2e/onboarding.spec.ts`. Replace:

```ts
  await expectTouchTarget(page.getByRole('button', { name: 'Đăng xuất' }))
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
```

with:

```ts
  await expectTouchTarget(page.getByRole('button', { name: 'Tài khoản' }))
  await page.getByRole('button', { name: 'Tài khoản' }).click()
  await expectTouchTarget(page.getByRole('button', { name: 'Đăng xuất' }))
  await page.getByRole('button', { name: 'Đăng xuất' }).click()
```

Also make every `getByRole('link', { name: 'Cài đặt' })` and `getByRole('link', { name: 'Đơn hàng' })` exact (`{ name: 'Cài đặt', exact: true }`). Task 8 adds a "Mở cài đặt" link, which would otherwise match.

- [ ] **Step 9: Run the owner E2E tests**

Run: `npx playwright test tests/e2e/onboarding.spec.ts --project=mobile-chrome`
Expected: PASS.

- [ ] **Step 10: Check the error page by hand**

With `npx nuxt dev`, open `/khong-ton-tai`. Expected: the "Không tìm thấy trang" heading and a "Về trang chủ" button that returns to `/`.

- [ ] **Step 11: Lint, typecheck, commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

```bash
git add app/components/app/StoreSwitcher.vue app/components/app/AccountMenu.vue app/error.vue app/layouts/owner.vue tests/nuxt/app/account-menu.test.ts tests/e2e/onboarding.spec.ts
git commit -m "feat(ui): responsive owner shell with sidebar, account menu and error page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Orders and settings screens, unsaved-changes guard

**Files:**
- Create: `app/composables/useUnsavedChangesGuard.ts`, `tests/e2e/support/layout.ts`
- Modify: `app/pages/app/orders.vue`, `app/pages/app/settings.vue`, `tests/e2e/onboarding.spec.ts`
- Test: `tests/nuxt/app/unsaved-changes-guard.test.ts`

**Interfaces:**
- Consumes: `AppPageHeader`, `AppEmptyState`, `AppCopyField`, `ZAlert`, `ZCard`, `ZButton`, `ZFormField`, `ZInput`, `ZSwitch`, `useActiveStore`, `useApi`, `useMe`.
- Produces:
  - `useUnsavedChangesGuard(isDirty: MaybeRefOrGetter<boolean>, message?: string): void`
    - registers `onBeforeRouteLeave`, which calls `window.confirm`
    - registers a `beforeunload` listener that calls `preventDefault()` only while dirty
  - `expectNoHorizontalOverflow(page: Page): Promise<void>` (E2E helper)

- [ ] **Step 1: Write the failing test** in `tests/nuxt/app/unsaved-changes-guard.test.ts`:

```ts
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

describe('useUnsavedChangesGuard', () => {
  it('blocks unload only while dirty and detaches on unmount', async () => {
    const dirty = ref(false)
    const Host = defineComponent({
      setup() {
        useUnsavedChangesGuard(dirty)
        return () => h('div')
      },
    })
    const wrapper = await mountSuspended(Host)

    expect(fireBeforeUnload().defaultPrevented).toBe(false)
    dirty.value = true
    expect(fireBeforeUnload().defaultPrevented).toBe(true)

    wrapper.unmount()
    expect(fireBeforeUnload().defaultPrevented).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run --project nuxt tests/nuxt/app/unsaved-changes-guard.test.ts`
Expected: FAIL with `useUnsavedChangesGuard is not defined`.

- [ ] **Step 3: Implement `app/composables/useUnsavedChangesGuard.ts`**

```ts
import type { MaybeRefOrGetter } from 'vue'

export function useUnsavedChangesGuard(
  isDirty: MaybeRefOrGetter<boolean>,
  message = 'Bạn có thay đổi chưa lưu. Rời trang?',
): void {
  onBeforeRouteLeave(() => (toValue(isDirty) ? window.confirm(message) : true))

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (!toValue(isDirty)) return
    event.preventDefault()
  }

  onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
}
```

`onBeforeRouteLeave` warns when the component is not rendered by a route; that is expected in the unit test. If the warning fails the test run, wrap it in `if (useRoute().matched.length)`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run --project nuxt tests/nuxt/app/unsaved-changes-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace `app/pages/app/orders.vue`**

```vue
<script setup lang="ts">
definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Đơn hàng' })

const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const publicUrl = computed(() => (activeStore.value ? `${config.public.appBaseUrl}/s/${activeStore.value.slug}` : ''))
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppPageHeader title="Đơn hàng" description="Theo dõi và xử lý đơn của quán." />

    <ZAlert
      v-if="activeStore && !activeStore.isAcceptingOrders"
      color="warning"
      title="Quán đang tạm nghỉ — khách không đặt được món"
    >
      <template #actions>
        <ZButton variant="secondary" size="sm" to="/app/settings">
          Bật nhận đơn
        </ZButton>
      </template>
    </ZAlert>

    <ZCard variant="raised" padding="lg">
      <AppEmptyState
        icon="i-lucide-receipt"
        title="Chưa có đơn hàng nào"
        description="Chia sẻ link đặt món để khách bắt đầu gọi món. Đơn mới sẽ hiện ở đây."
      >
        <template #actions>
          <AppCopyField v-if="publicUrl" :value="publicUrl" label="Link đặt món" />
          <ZButton variant="secondary" block icon="i-lucide-settings" to="/app/settings">
            Mở cài đặt
          </ZButton>
        </template>
      </AppEmptyState>
    </ZCard>
  </div>
</template>
```

- [ ] **Step 6: Replace `app/pages/app/settings.vue`**

```vue
<script setup lang="ts">
import type { StoreDetail } from '#shared/types/identity'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Cài đặt' })

const api = useApi()
const toast = useToast()
const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const { load } = useMe()

const { data: store, status, refresh } = await useAsyncData(
  'store-settings',
  async () => {
    const id = activeStore.value?.id
    return id ? await api<StoreDetail>(`/api/stores/${id}`) : null
  },
  { watch: [() => activeStore.value?.id] },
)

const draft = reactive({ name: '', isAcceptingOrders: false })
function resetDraft() {
  if (store.value) Object.assign(draft, { name: store.value.name, isAcceptingOrders: store.value.isAcceptingOrders })
}
watch(store, resetDraft, { immediate: true })

const isOwner = computed(() => store.value?.role === 'OWNER')
const isDirty = computed(() => !!store.value && isOwner.value
  && (draft.name !== store.value.name || draft.isAcceptingOrders !== store.value.isAcceptingOrders))
const saving = ref(false)
const publicUrl = computed(() => (store.value ? `${config.public.appBaseUrl}/s/${store.value.slug}` : ''))

useUnsavedChangesGuard(isDirty)

async function save() {
  if (!store.value || !isDirty.value) return
  saving.value = true
  try {
    await api(`/api/stores/${store.value.id}`, { method: 'PATCH', body: { ...draft } })
    await Promise.all([refresh(), load(true)])
    toast.add({ color: 'success', title: 'Đã lưu cài đặt' })
  }
  catch (err) {
    toast.add({ color: 'error', title: extractApiError(err).message })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-6" :class="{ 'pb-20 md:pb-0': isDirty }">
    <AppPageHeader title="Cài đặt cửa hàng" description="Thông tin hiển thị cho khách và trạng thái nhận đơn." />

    <div v-if="status === 'pending' && !store" class="flex flex-col gap-4" aria-busy="true" aria-label="Đang tải cài đặt">
      <USkeleton v-for="i in 3" :key="i" class="h-32 w-full rounded-md" />
    </div>

    <ZAlert v-else-if="status === 'error'" color="error" title="Không tải được cài đặt">
      <template #actions>
        <ZButton variant="secondary" size="sm" icon="i-lucide-refresh-cw" @click="refresh()">
          Thử lại
        </ZButton>
      </template>
    </ZAlert>

    <template v-else-if="store">
      <ZAlert v-if="!isOwner" color="info" title="Chỉ chủ cửa hàng mới thay đổi được cài đặt." />

      <form id="store-settings" class="flex flex-col gap-6" @submit.prevent="save">
        <ZCard title="Thông tin cửa hàng" padding="lg">
          <ZFormField label="Tên cửa hàng" name="name">
            <ZInput v-model="draft.name" :disabled="!isOwner" size="lg" autocomplete="organization" />
          </ZFormField>
        </ZCard>

        <ZCard title="Nhận đơn" padding="lg">
          <ZSwitch
            v-model="draft.isAcceptingOrders"
            :disabled="!isOwner"
            label="Đang nhận đơn"
            description="Tắt khi quán tạm nghỉ; khách vẫn xem được menu."
          />
        </ZCard>

        <ZCard title="Link đặt món" description="Gửi cho khách hoặc in lên QR tại bàn." padding="lg">
          <div class="flex flex-col gap-3">
            <AppCopyField :value="publicUrl" label="Link đặt món" />
            <ZButton variant="ghost" icon="i-lucide-external-link" :to="publicUrl" target="_blank" class="self-start">
              Mở trang khách
            </ZButton>
          </div>
        </ZCard>

        <div v-if="isOwner" class="hidden md:flex md:justify-end md:gap-3">
          <ZButton variant="ghost" :disabled="!isDirty || saving" @click="resetDraft">
            Hủy
          </ZButton>
          <ZButton type="submit" :disabled="!isDirty" :loading="saving">
            Lưu thay đổi
          </ZButton>
        </div>
      </form>

      <div
        v-if="isOwner"
        v-show="isDirty"
        class="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-default bg-default/95 px-4 py-3 backdrop-blur md:hidden"
      >
        <div class="mx-auto flex max-w-lg gap-3">
          <ZButton variant="ghost" :disabled="saving" @click="resetDraft">
            Hủy
          </ZButton>
          <ZButton type="submit" form="store-settings" class="flex-1" :loading="saving">
            Lưu thay đổi
          </ZButton>
        </div>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 7: Create `tests/e2e/support/layout.ts`**

```ts
import { expect, type Page } from '@playwright/test'

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0)
}
```

- [ ] **Step 8: Extend the owner flow** in `tests/e2e/onboarding.spec.ts`

Import the helper: `import { expectNoHorizontalOverflow } from './support/layout'`.

As the first line of the `owner signs up, onboards, edits settings…` test, add:

```ts
  await page.setViewportSize({ width: 360, height: 740 })
```

Directly after the existing assertion `await expect(page.getByRole('switch', { name: 'Đang nhận đơn' })).toBeChecked()` that follows the reload, and before the sign-out steps, insert:

```ts
  await expectNoHorizontalOverflow(page)

  // A dismissed unsaved-changes prompt keeps the owner on the page.
  const longName = 'Trà Sữa Mây Ngàn Chi Nhánh Nguyễn Thị Minh Khai Quận Một'
  await page.getByLabel('Tên cửa hàng').fill(longName)
  page.once('dialog', dialog => void dialog.dismiss())
  await page.getByRole('link', { name: 'Đơn hàng', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)

  // Saving clears the dirty state, so leaving afterwards must not prompt.
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByRole('button', { name: 'Lưu thay đổi' })).toBeHidden()
  await expect(page.getByTestId('active-store-name')).toHaveText(longName)
  await expectNoHorizontalOverflow(page)
  let prompted = false
  const onDialog = (dialog: { dismiss: () => Promise<void> }) => {
    prompted = true
    void dialog.dismiss()
  }
  page.on('dialog', onDialog)
  await page.getByRole('link', { name: 'Đơn hàng', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  page.off('dialog', onDialog)
  expect(prompted).toBe(false)
  await expectNoHorizontalOverflow(page)

  // Tablet/desktop switches to the sidebar.
  await page.setViewportSize({ width: 1024, height: 768 })
  await expect(page.getByTestId('sidebar-nav')).toBeVisible()
  await expect(page.getByTestId('bottom-nav')).toBeHidden()
  await page.setViewportSize({ width: 360, height: 740 })
```

The existing sign-out steps (updated in Task 7) follow unchanged.

- [ ] **Step 9: Run the E2E tests on both engines**

Run: `npx playwright test tests/e2e/onboarding.spec.ts`
Expected: PASS on both `mobile-chrome` and `mobile-safari`.

- [ ] **Step 10: Lint, typecheck, unit tests, commit**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

```bash
git add app/composables/useUnsavedChangesGuard.ts app/pages/app tests/nuxt/app/unsaved-changes-guard.test.ts tests/e2e
git commit -m "feat(ui): redesign orders and settings with save bar and unsaved-changes guard" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Marketing landing page

**Files:**
- Create: `app/components/landing/PhoneMockup.vue`
- Modify: `app/pages/index.vue`, `tests/e2e/smoke.spec.ts`, `eslint.config.mjs`

**Interfaces:**
- Consumes: `AppLogo`, `AppColorModeToggle`, `ZButton`, `ZBadge`, `ZCard`.
- Produces: an SSR landing page with a single `<h1>` "Đặt món tại bàn, không cần app", links "Đăng nhập chủ quán" (to `/login`) and "Tạo quán miễn phí" (to `/signup`), and SEO meta.

- [ ] **Step 1: Update the smoke test first** in `tests/e2e/smoke.spec.ts`:

```ts
test('landing page renders on mobile', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt món tại bàn, không cần app' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Đăng nhập chủ quán' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tạo quán miễn phí' }).first()).toHaveAttribute('href', '/signup')
  await expect(page).toHaveTitle(/ZENO Order/)
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx playwright test tests/e2e/smoke.spec.ts --project=mobile-chrome`
Expected: FAIL, because the heading is not found.

- [ ] **Step 3: Create `app/components/landing/PhoneMockup.vue`**

```vue
<script setup lang="ts">
const items = [
  { name: 'Trà sữa trân châu', price: '35.000đ' },
  { name: 'Cà phê muối', price: '29.000đ' },
  { name: 'Trà đào cam sả', price: '32.000đ' },
]
</script>

<template>
  <div aria-hidden="true" class="relative mx-auto w-full max-w-[17.5rem] select-none lg:max-w-xs">
    <div class="absolute -inset-8 rounded-[3rem] bg-secondary/30 blur-3xl dark:bg-secondary/10" />
    <div class="relative rounded-[2.5rem] bg-coffee-900 p-2.5 shadow-lg dark:bg-black dark:ring-1 dark:ring-default">
      <div class="overflow-hidden rounded-[2rem] bg-default">
        <div class="flex items-center justify-between px-5 pb-3 pt-6">
          <div>
            <p class="text-[11px] text-muted">Bàn 05</p>
            <p class="font-display text-lg font-semibold text-default">Trà Sữa Mây</p>
          </div>
          <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200">Đang mở</span>
        </div>
        <div class="flex gap-2 px-5 pb-3 text-[11px] font-medium">
          <span class="rounded-full bg-primary px-3 py-1 text-(--zeno-on-primary)">Trà sữa</span>
          <span class="rounded-full bg-(--zeno-surface-hover) px-3 py-1 text-primary">Cà phê</span>
          <span class="rounded-full bg-(--zeno-surface-hover) px-3 py-1 text-primary">Trái cây</span>
        </div>
        <ul class="flex flex-col gap-2.5 px-4 pb-4">
          <li v-for="item in items" :key="item.name" class="flex items-center gap-3 rounded-2xl bg-(--zeno-surface) p-2.5 shadow-sm">
            <div class="size-12 shrink-0 rounded-xl bg-linear-to-br from-secondary/70 to-primary/70" />
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] font-medium text-default">{{ item.name }}</p>
              <p class="font-mono text-xs text-primary">{{ item.price }}</p>
            </div>
            <span class="flex size-7 items-center justify-center rounded-full bg-primary text-(--zeno-on-primary)">
              <UIcon name="i-lucide-plus" class="size-4" />
            </span>
          </li>
        </ul>
        <div class="mx-4 mb-5 flex items-center justify-between rounded-2xl bg-primary px-4 py-3 text-(--zeno-on-primary)">
          <span class="text-[13px] font-medium">2 món · Xem giỏ</span>
          <span class="font-mono text-[13px] font-semibold">64.000đ</span>
        </div>
      </div>
    </div>
    <div class="absolute -right-4 top-1/3 hidden rounded-2xl bg-(--zeno-surface) p-3 text-center shadow-md sm:block dark:ring-1 dark:ring-default">
      <UIcon name="i-lucide-qr-code" class="size-10 text-default" />
      <p class="mt-1 text-[11px] font-medium text-muted">Quét để gọi món</p>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Replace `app/pages/index.vue`**

```vue
<script setup lang="ts">
useHead({ titleTemplate: '%s' })
useSeoMeta({
  title: 'ZENO Order — Đặt món tại bàn cho quán cafe & trà sữa',
  description: 'Khách quét QR, chọn món và thanh toán VietQR. Chủ quán nhận và xử lý đơn ngay trên điện thoại.',
  ogTitle: 'ZENO Order — Đặt món tại bàn, không cần app',
  ogDescription: 'Khách quét QR, chọn món và thanh toán VietQR. Chủ quán nhận và xử lý đơn ngay trên điện thoại.',
  ogType: 'website',
  ogLocale: 'vi_VN',
})

const benefits = [
  { icon: 'i-lucide-qr-code', title: 'QR tại bàn', description: 'Khách quét mã, xem menu và gọi món ngay trên điện thoại — không cần cài app.' },
  { icon: 'i-lucide-badge-check', title: 'VietQR tự đối soát', description: 'Tiền vào tài khoản là đơn tự chuyển “Đã thanh toán”, không phải dò sao kê.' },
  { icon: 'i-lucide-smartphone', title: 'Quản lý trên điện thoại', description: 'Nhận đơn, đổi trạng thái và bật/tắt nhận đơn ở bất kỳ đâu.' },
]

const steps = [
  { title: 'Tạo quán', description: 'Đăng ký và đặt tên cửa hàng trong một phút.' },
  { title: 'In mã QR', description: 'Dán QR lên bàn hoặc quầy thu ngân.' },
  { title: 'Nhận đơn', description: 'Đơn mới hiện ngay trên điện thoại của bạn.' },
]

const year = new Date().getFullYear()
</script>

<template>
  <div class="min-h-dvh bg-default">
    <a
      href="#main"
      class="sr-only z-50 rounded-md bg-primary px-4 py-3 font-medium text-(--zeno-on-primary) focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >Bỏ qua tới nội dung</a>

    <header class="sticky top-0 z-20 border-b border-default/60 bg-default/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <AppLogo to="/" />
        <div class="flex items-center gap-1 sm:gap-2">
          <AppColorModeToggle />
          <ZButton variant="ghost" to="/login" class="hidden sm:inline-flex">
            Đăng nhập
          </ZButton>
          <ZButton to="/signup">
            Dùng thử miễn phí
          </ZButton>
        </div>
      </div>
    </header>

    <main id="main">
      <section class="relative overflow-hidden">
        <div aria-hidden="true" class="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-secondary/20 blur-3xl dark:bg-secondary/10" />
        <div class="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
          <div class="relative flex flex-col gap-6">
            <ZBadge icon="i-lucide-coffee" class="self-start">
              Dành cho quán cafe & trà sữa
            </ZBadge>
            <h1 class="font-display text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-default sm:text-5xl lg:text-6xl">
              Đặt món tại bàn, <span class="text-primary">không cần app</span>
            </h1>
            <p class="max-w-prose text-lg text-muted">
              Khách quét QR, chọn món và thanh toán VietQR. Bạn nhận và xử lý đơn ngay trên điện thoại.
            </p>
            <div class="flex flex-col gap-3 sm:flex-row">
              <ZButton to="/signup" size="lg" trailing-icon="i-lucide-arrow-right">
                Tạo quán miễn phí
              </ZButton>
              <ZButton to="/login" size="lg" variant="secondary">
                Đăng nhập chủ quán
              </ZButton>
            </div>
            <ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              <li class="flex items-center gap-1.5">
                <UIcon name="i-lucide-check" class="size-4 text-primary" /> Thiết lập trong 5 phút
              </li>
              <li class="flex items-center gap-1.5">
                <UIcon name="i-lucide-check" class="size-4 text-primary" /> Khách không cần cài app
              </li>
            </ul>
          </div>
          <LandingPhoneMockup />
        </div>
      </section>

      <section class="py-16 lg:py-24" aria-labelledby="benefits-title">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 id="benefits-title" class="max-w-xl text-h2 text-default">
            Mọi thứ quán nhỏ cần để nhận đơn online
          </h2>
          <ul class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="benefit in benefits" :key="benefit.title">
              <ZCard class="h-full">
                <div class="flex size-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <UIcon :name="benefit.icon" class="size-6" />
                </div>
                <h3 class="mt-5 text-h3 text-default">
                  {{ benefit.title }}
                </h3>
                <p class="mt-2 text-muted">
                  {{ benefit.description }}
                </p>
              </ZCard>
            </li>
          </ul>
        </div>
      </section>

      <section class="pb-16 lg:pb-24" aria-labelledby="steps-title">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 id="steps-title" class="text-h2 text-default">
            Bắt đầu trong 3 bước
          </h2>
          <ol class="mt-10 grid gap-8 sm:grid-cols-3">
            <li v-for="(step, index) in steps" :key="step.title" class="flex gap-4 sm:flex-col">
              <span class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xl font-semibold text-(--zeno-on-primary) shadow-raised-sm dark:shadow-none">
                {{ index + 1 }}
              </span>
              <div>
                <h3 class="text-h3 text-default">
                  {{ step.title }}
                </h3>
                <p class="mt-1 text-muted">
                  {{ step.description }}
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section class="px-4 pb-16 sm:px-6 lg:pb-24" aria-labelledby="cta-title">
        <div class="relative mx-auto max-w-6xl overflow-hidden rounded-lg bg-primary px-6 py-12 text-center text-(--zeno-on-primary) sm:px-12">
          <div aria-hidden="true" class="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-white/10 blur-3xl" />
          <h2 id="cta-title" class="relative text-h2">
            Sẵn sàng nhận đơn đầu tiên?
          </h2>
          <p class="relative mx-auto mt-3 max-w-md opacity-95">
            Tạo quán miễn phí, in QR và bắt đầu bán ngay hôm nay.
          </p>
          <ZButton to="/signup" size="lg" variant="secondary" trailing-icon="i-lucide-arrow-right" class="relative mt-8">
            Tạo quán miễn phí
          </ZButton>
        </div>
      </section>
    </main>

    <footer class="border-t border-default pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6">
      <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted sm:flex-row sm:px-6">
        <AppLogo size="sm" />
        <p>© {{ year }} ZENO · Đặt món nhanh cho quán cafe & trà sữa</p>
        <nav aria-label="Tài khoản" class="flex gap-4">
          <NuxtLink to="/login" class="inline-flex min-h-11 items-center hover:text-default">
            Đăng nhập
          </NuxtLink>
          <NuxtLink to="/signup" class="inline-flex min-h-11 items-center hover:text-default">
            Đăng ký
          </NuxtLink>
        </nav>
      </div>
    </footer>
  </div>
</template>
```

- [ ] **Step 5: Run the smoke test and confirm it passes**

Run: `npx playwright test tests/e2e/smoke.spec.ts`
Expected: PASS on both projects.

- [ ] **Step 6: Make the Z* guard an error**

In `eslint.config.mjs`, change the `vue/no-restricted-syntax` severity from `'warn'` to `'error'`.

Run: `npm run lint`
Expected: PASS with no warnings from the guard. No `U(Button|Input|Select|Switch|Card|Alert|Badge|FormField)` remains in `app/pages` or `app/layouts`.

- [ ] **Step 7: Commit**

```bash
git add app/components/landing app/pages/index.vue tests/e2e/smoke.spec.ts eslint.config.mjs
git commit -m "feat(ui): add marketing landing page and enforce Z* primitives in pages" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Cross-cutting E2E, Lighthouse, and the final gate

**Files:**
- Create: `tests/e2e/ui-foundation.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-31-ui-foundation-design.md` (record the focus-ring decision)

- [ ] **Step 1: Write `tests/e2e/ui-foundation.spec.ts`**

```ts
import { expect, test } from '@playwright/test'
import { expectNoHorizontalOverflow } from './support/layout'

test.use({ viewport: { width: 360, height: 740 } })

for (const path of ['/', '/login', '/signup']) {
  test(`${path} has no horizontal scroll at 360px`, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
}

test('dark mode toggle applies and survives a reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Chuyển sang giao diện tối' }).click()
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  await expect(page.getByRole('button', { name: 'Chuyển sang giao diện sáng' })).toBeVisible()
  await page.getByRole('button', { name: 'Chuyển sang giao diện sáng' }).click()
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/)
})

test('headings render Vietnamese diacritics with Fraunces', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeVisible()
  const ok = await page.evaluate(async () => {
    await document.fonts.ready
    await document.fonts.load('600 30px "Fraunces"', 'Đặt món tại bàn ạếởữ')
    return document.fonts.check('600 30px "Fraunces"', 'Đặt món tại bàn ạếởữ')
  })
  expect(ok).toBe(true)
})

test('password field can be revealed without breaking its label', async ({ page }) => {
  await page.goto('/login')
  const password = page.getByLabel('Mật khẩu', { exact: true })
  await password.fill('Bi-mat-123')
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Hiện mật khẩu' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await expect(password).toHaveValue('Bi-mat-123')
})
```

- [ ] **Step 2: Run the full E2E suite**

Run: `npm run test:e2e`
Expected: PASS on `mobile-chrome` and `mobile-safari`.

- [ ] **Step 3: Run the full gate**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all PASS.

- [ ] **Step 4: Run Lighthouse on the production build**

Start `node .output/server/index.mjs` with `PORT=3300` and the `.env` values. Using Chrome DevTools MCP `lighthouse_audit` (mobile), audit `http://localhost:3300/` and `http://localhost:3300/login`.

Expected: Performance ≥ 90 and Accessibility ≥ 95 on both. Fix any reported failures that fall within this plan's scope, for example contrast problems, missing labels, or oversized font preloads. Then re-audit.

- [ ] **Step 5: Do a visual check at 360px, 768px and 1280px, in light and dark mode**

Take screenshots of `/`, `/login`, `/signup`, `/onboarding`, `/app/orders` and `/app/settings`. Look for:
- clipped text;
- muddy neumorphic shadows on white surfaces;
- Vietnamese diacritics colliding with line height.

Fix anything you find.

- [ ] **Step 6: Record the focus-ring decision in the spec**

In §3.3 of the spec, replace the focus ring row with the following, because a 25% tint fails the WCAG 2.2 3:1 non-text contrast rule:

`| focus | Button/link: outline 2px primary, offset 2px · Input: ring 2px primary (WCAG 2.2 non-text 3:1; ring 25% của CafeBlend không đạt) | như light |`

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/ui-foundation.spec.ts docs/superpowers/specs/2026-10-31-ui-foundation-design.md
git commit -m "test(ui): cover overflow, dark mode, fonts and password reveal end to end" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
