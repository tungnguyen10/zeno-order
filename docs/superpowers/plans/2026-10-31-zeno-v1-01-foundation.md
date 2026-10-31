# ZENO Mini Order V1 — PR0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng nền móng kỹ thuật (Nuxt UI, Drizzle + Neon Pool, error model, logger, storage, test harness 3 tầng, CI) để mọi PR sau chỉ việc thêm nghiệp vụ.

**Architecture:** Nuxt 4 full-stack. Server code dùng import tường minh (không dựa vào auto-import) để chạy được cả trong Nitro lẫn Vitest. Handler bọc bằng `defineApiHandler` → lỗi luôn ra dạng `{code, message, details?}`. DB qua `getDb()` (Pool WebSocket, có transaction thật). Test: `unit` (thuần), `integration` (Neon branch `test`), `api` (server Nuxt build thật + HTTP).

**Tech Stack:** Nuxt 4.5.2, @nuxt/ui 4.12.0, drizzle-orm 0.45.4, drizzle-kit 0.31.11, @neondatabase/serverless 1.2.0, @aws-sdk/client-s3, zod 4.6.5, vitest 5, @nuxt/test-utils 4.3.2, Playwright 1.63.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md)

## Global Constraints

Áp dụng toàn bộ mục "Global Constraints" trong roadmap. Nhắc lại các điểm chạm PR này:
- npm, commit `package-lock.json`; **pin version chính xác** (không `^`), giữ convention hiện có của `package.json`.
- Node `>=24 <25`.
- Server code import tường minh từ `h3`, `zod`, `drizzle-orm`; `shared/` import qua alias `#shared`; trong `server/` dùng đường dẫn tương đối (không dùng `~/server/...` — trong Nuxt 4 `~` trỏ vào `app/`).
- Không đưa secret vào `runtimeConfig.public`. Không log PII/secret.
- Error body API: `{ code, message, details? }`.
- S3 client cho Neon Object Storage: `forcePathStyle: true`, **không** tắt kiểm tra TLS.

## Review Focus

PR này sở hữu các mục Review Focus #5 và #6 của roadmap:
- **#5** DB không kết nối được / thiếu env → `/api/health` trả 503 `SERVICE_UNAVAILABLE`, body không chứa connection string. → Task 4, Step 1 (`tests/api/health.test.ts` case "returns 503…") và Task 2 (`toApiError` ẩn message lỗi lạ).
- **#6** Log chứa SĐT/địa chỉ/token/chuỗi kết nối → bị che. → Task 3 tests.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `package.json` (modify) | deps pin, scripts test/db |
| `nuxt.config.ts` (modify) | modules (`@nuxt/ui`), css, runtimeConfig, routeRules |
| `app/app.vue`, `app/assets/css/main.css`, `app/app.config.ts`, `app/pages/index.vue` | khung UI tối thiểu với Nuxt UI |
| `shared/money.ts` | định dạng/kiểm tra tiền VND (hàm thuần) |
| `shared/errors.ts` | danh sách `ErrorCode` + status + kiểu `ApiErrorBody` (dùng chung client/server) |
| `server/utils/errors.ts` | `AppError`, `toApiError` |
| `server/utils/validation.ts` | `parseWith`, `parseBody`, `parseQuery` |
| `server/utils/api-handler.ts` | `defineApiHandler` |
| `server/utils/logger.ts` | `redact`, `logger` JSON |
| `server/utils/env.ts` | `requireEnv` |
| `server/middleware/request-id.ts` | gán `event.context.requestId`, header `x-request-id` |
| `server/types/h3.d.ts` | mở rộng `H3EventContext` |
| `server/db/client.ts` | `getDb`, `closeDb`, kiểu `Db`, `Tx`, `DbOrTx` |
| `server/db/schema/index.ts` | barrel schema (trống ở PR0) |
| `drizzle.config.ts` | drizzle-kit, chỉ schema `public` |
| `server/api/health.get.ts` (rewrite) | `SELECT 1` → `{status:'ok'}` / 503 |
| `server/services/storage/index.ts` | `putObject`, `deleteObject`, `publicObjectUrl`, hằng bucket |
| `neon.ts` (modify) | `auth: true`, bucket `product-images` public_read |
| `vitest.config.ts` | 3 projects: unit / integration / api |
| `tests/setup/integration.ts` | nạp `.env.test`, chặn chạy nhầm DB production |
| `tests/support/db.ts` | `resetDb()` |
| `playwright.config.ts`, `tests/e2e/smoke.spec.ts` | E2E mobile Chrome + Safari |
| `.github/workflows/ci.yml` | lint, typecheck, unit, build, integration+api trên Neon branch tạm |
| Xoá: `server/utils/db.ts`, `server/utils/storage.ts`, `server/api/storage.get.ts` | code thử nghiệm lúc setup Neon (có `rejectUnauthorized:false` — phải gỡ) |

---

### Task 1: Tooling baseline — Nuxt UI, deps pin, Vitest projects

**Files:**
- Modify: `package.json`, `nuxt.config.ts`
- Create: `app/app.vue`, `app/app.config.ts`, `app/assets/css/main.css`, `app/pages/index.vue`, `vitest.config.ts`, `shared/money.ts`
- Delete: `server/utils/db.ts`, `server/utils/storage.ts`, `server/api/storage.get.ts`, `server/api/health.get.ts` (viết lại ở Task 4)
- Test: `tests/unit/shared/money.test.ts`

**Interfaces:**
- Produces: `formatVnd(amount: number): string`, `assertVnd(amount: number): number` (`#shared/money`); alias `#shared` hoạt động trong Vitest; scripts `test:unit`, `test:integration`, `test:api`, `test:e2e`, `db:generate`, `db:migrate`, `db:check`.

- [ ] **Step 1: Gỡ code thử nghiệm và cập nhật dependencies**

Các file dưới `server/` sinh ra lúc setup Neon **chưa được git track**, nên dùng `rm` (không dùng `git rm`):

```bash
rm server/utils/db.ts server/utils/storage.ts server/api/storage.get.ts server/api/health.get.ts
npm uninstall @tailwindcss/vite @aws-sdk/s3-request-presigner
npm install --save-exact @nuxt/ui@4.12.0 drizzle-orm@0.45.4 jose@6.2.14 \
  @neondatabase/serverless@1.2.0 @neon/config@1.10.0 @neon/env@1.6.8 \
  "@aws-sdk/client-s3@$(node -p "require('@aws-sdk/client-s3/package.json').version")"
npm install --save-exact -D drizzle-kit@0.31.11
```

Kiểm tra: `grep -n '"\^' package.json` → không có dòng nào (mọi version đều pin).

- [ ] **Step 2: Thêm scripts vào `package.json`**

Trong khối `"scripts"` (giữ nguyên các script cũ), thêm:

```json
    "test": "vitest run --project unit",
    "test:unit": "vitest run --project unit",
    "test:integration": "ENV_FILE=.env.test drizzle-kit migrate && vitest run --project integration",
    "test:api": "ENV_FILE=.env.test drizzle-kit migrate && vitest run --project api",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:check": "drizzle-kit check"
```

- [ ] **Step 3: Cấu hình Nuxt UI**

`nuxt.config.ts` (thay toàn bộ):

```ts
export default defineNuxtConfig({
  compatibilityDate: '2026-09-14',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui', '@pinia/nuxt'],
  css: ['~/assets/css/main.css'],
  typescript: {
    strict: true,
    typeCheck: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: 'vi' },
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }],
    },
  },
  runtimeConfig: {
    public: {
      neonAuthUrl: process.env.NEON_AUTH_BASE_URL ?? '',
      appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    },
  },
  routeRules: {
    '/app/**': { ssr: false },
    '/login': { ssr: false },
    '/signup': { ssr: false },
    '/onboarding': { ssr: false },
    '/invite/**': { ssr: false },
  },
})
```

`app/assets/css/main.css`:

```css
@import "tailwindcss";
@import "@nuxt/ui";
```

`app/app.config.ts`:

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'stone',
    },
  },
})
```

`app/app.vue`:

```vue
<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
```

`app/pages/index.vue`:

```vue
<script setup lang="ts">
useHead({ title: 'ZENO Order' })
</script>

<template>
  <main class="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-2xl font-semibold">ZENO Order</h1>
    <p class="text-muted">Đặt món nhanh cho quán trà sữa & cafe.</p>
    <UButton to="/login" size="lg">Đăng nhập chủ quán</UButton>
  </main>
</template>
```

- [ ] **Step 4: Viết test thất bại cho `shared/money.ts`**

`tests/unit/shared/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertVnd, formatVnd } from '#shared/money'

describe('formatVnd', () => {
  it('formats with dot thousands separator and đ suffix', () => {
    expect(formatVnd(25000)).toBe('25.000đ')
    expect(formatVnd(1250000)).toBe('1.250.000đ')
    expect(formatVnd(0)).toBe('0đ')
  })
})

describe('assertVnd', () => {
  it('accepts non-negative safe integers', () => {
    expect(assertVnd(35000)).toBe(35000)
  })
  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (value) => {
    expect(() => assertVnd(value)).toThrow(RangeError)
  })
})
```

`vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': r('./shared'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/setup/integration.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'api',
          environment: 'node',
          include: ['tests/api/**/*.test.ts'],
          setupFiles: ['tests/setup/integration.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
```

- [ ] **Step 5: Chạy test, xác nhận FAIL**

Run: `npm run test:unit`
Expected: FAIL — `Failed to resolve import "#shared/money"` (file chưa tồn tại).

- [ ] **Step 6: Implement `shared/money.ts`**

```ts
const VND_FORMAT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

export function assertVnd(amount: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Invalid VND amount: ${amount}`)
  }
  return amount
}

export function formatVnd(amount: number): string {
  return `${VND_FORMAT.format(assertVnd(amount))}đ`
}
```

- [ ] **Step 7: Chạy unit test + build**

Run: `npm run test:unit` → Expected: PASS (5 tests).
Run: `npm run build` → Expected: `✨ Build complete!`, không có lỗi TS.
Run: `npm run dev` rồi mở `http://localhost:3000` → thấy trang "ZENO Order" có nút xanh emerald. Dừng dev server.

- [ ] **Step 8: Commit**

```bash
git add .gitignore package.json package-lock.json nuxt.config.ts vitest.config.ts app shared tests/unit
git commit -m "chore(foundation): add Nuxt UI, pinned deps and vitest projects

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Error model, validation helpers, `defineApiHandler`

**Files:**
- Create: `shared/errors.ts`, `server/utils/errors.ts`, `server/utils/validation.ts`, `server/utils/api-handler.ts`
- Test: `tests/unit/server/errors.test.ts`, `tests/unit/server/validation.test.ts`

**Interfaces:**
- Consumes: không.
- Produces:
  - `#shared/errors`: `ERROR_STATUS` (record code→status), `type ErrorCode`, `interface ApiErrorBody { code: ErrorCode; message: string; details?: unknown }`.
  - `server/utils/errors.ts`: `class AppError extends Error { code: ErrorCode; details?: unknown; get status(): number }`, `toApiError(err: unknown): { status: number; body: ApiErrorBody }`, `zodIssues(error: ZodError): { path: string; message: string }[]`.
  - `server/utils/validation.ts`: `parseWith<S extends ZodType>(schema: S, raw: unknown): z.output<S>`, `parseBody(event, schema)`, `parseQuery(event, schema)`.
  - `server/utils/api-handler.ts`: `defineApiHandler<T>(handler: (event: H3Event) => T | Promise<T>)`.

- [ ] **Step 1: Viết test thất bại**

`tests/unit/server/errors.test.ts`:

```ts
import { createError } from 'h3'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError, toApiError } from '../../../server/utils/errors'

describe('toApiError', () => {
  it('maps AppError to its status and body', () => {
    const result = toApiError(new AppError('SLUG_TAKEN', 'Slug đã được dùng', { field: 'storeSlug' }))
    expect(result).toEqual({
      status: 409,
      body: { code: 'SLUG_TAKEN', message: 'Slug đã được dùng', details: { field: 'storeSlug' } },
    })
  })

  it('omits details when not provided', () => {
    const result = toApiError(new AppError('NOT_FOUND', 'Không tìm thấy'))
    expect(result.status).toBe(404)
    expect(result.body).not.toHaveProperty('details')
  })

  it('maps ZodError to 400 VALIDATION_FAILED with flattened issues', () => {
    const parsed = z.object({ name: z.string() }).safeParse({})
    if (parsed.success) throw new Error('expected failure')
    const result = toApiError(parsed.error)
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('VALIDATION_FAILED')
    expect(result.body.details).toEqual([{ path: 'name', message: expect.any(String) }])
  })

  it('maps h3 400-class errors (malformed JSON) to VALIDATION_FAILED', () => {
    const result = toApiError(createError({ statusCode: 400, statusMessage: 'Bad Request' }))
    expect(result).toEqual({ status: 400, body: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' } })
  })

  it('hides unknown errors behind INTERNAL without leaking the message', () => {
    const result = toApiError(new Error('connect ECONNREFUSED postgres://user:pw@host/db'))
    expect(result).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Đã có lỗi xảy ra, vui lòng thử lại' },
    })
  })
})
```

`tests/unit/server/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../../../server/utils/errors'
import { parseWith } from '../../../server/utils/validation'

const schema = z.object({ qty: z.number().int().min(1) })

describe('parseWith', () => {
  it('returns parsed data on success', () => {
    expect(parseWith(schema, { qty: 2 })).toEqual({ qty: 2 })
  })

  it('throws AppError VALIDATION_FAILED with issues on failure', () => {
    try {
      parseWith(schema, { qty: 0 })
      throw new Error('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(AppError)
      const appError = err as AppError
      expect(appError.code).toBe('VALIDATION_FAILED')
      expect(appError.details).toEqual([{ path: 'qty', message: expect.any(String) }])
    }
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npm run test:unit`
Expected: FAIL — không resolve được `server/utils/errors`.

- [ ] **Step 3: Implement**

`shared/errors.ts`:

```ts
export const ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STATUS_CONFLICT: 409,
  CART_STALE: 409,
  SLUG_TAKEN: 409,
  ORG_EXISTS: 409,
  STORE_CLOSED: 422,
  MODE_DISABLED: 422,
  INVALID_TABLE: 422,
  INVALID_ZONE: 422,
  PAYMENT_METHOD_UNAVAILABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
} as const

export type ErrorCode = keyof typeof ERROR_STATUS

export interface ApiErrorBody {
  code: ErrorCode
  message: string
  details?: unknown
}
```

`server/utils/errors.ts`:

```ts
import { isError as isH3Error } from 'h3'
import { ZodError } from 'zod'
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '#shared/errors'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }

  get status(): number {
    return ERROR_STATUS[this.code]
  }
}

export function zodIssues(error: ZodError): { path: string, message: string }[] {
  return error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
}

const INTERNAL_BODY: ApiErrorBody = { code: 'INTERNAL', message: 'Đã có lỗi xảy ra, vui lòng thử lại' }

export function toApiError(err: unknown): { status: number, body: ApiErrorBody } {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { code: err.code, message: err.message }
    if (err.details !== undefined) body.details = err.details
    return { status: err.status, body }
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ', details: zodIssues(err) },
    }
  }
  if (isH3Error(err) && [400, 413, 415].includes(err.statusCode)) {
    return { status: 400, body: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' } }
  }
  return { status: 500, body: { ...INTERNAL_BODY } }
}
```

`server/utils/validation.ts`:

```ts
import { getQuery, readBody, type H3Event } from 'h3'
import type { z } from 'zod'
import { AppError, zodIssues } from './errors'

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', zodIssues(result.error))
  }
  return result.data
}

export async function parseBody<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await readBody(event)
  }
  catch {
    throw new AppError('VALIDATION_FAILED', 'Body JSON không hợp lệ')
  }
  return parseWith(schema, raw)
}

export function parseQuery<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  return parseWith(schema, getQuery(event))
}
```

`server/utils/api-handler.ts` (logger được tạo ở Task 3 — tạm thời dùng `console.error`, Task 3 Step 4 sẽ thay):

```ts
import { defineEventHandler, setResponseStatus, type H3Event } from 'h3'
import { toApiError } from './errors'

export function defineApiHandler<T>(handler: (event: H3Event) => T | Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    }
    catch (err) {
      const { status, body } = toApiError(err)
      if (status >= 500) {
        console.error('api.unhandled', event.path)
      }
      setResponseStatus(event, status)
      return body
    }
  })
}
```

- [ ] **Step 4: Chạy test**

Run: `npm run test:unit` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/errors.ts server/utils tests/unit/server
git commit -m "feat(foundation): add API error model and validation helpers

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Logger có redaction + request ID

**Files:**
- Create: `server/utils/logger.ts`, `server/middleware/request-id.ts`, `server/types/h3.d.ts`
- Modify: `server/utils/api-handler.ts`
- Test: `tests/unit/server/logger.test.ts`

**Interfaces:**
- Produces: `redact(value: unknown): unknown`; `logger.info|warn|error(msg: string, ctx?: Record<string, unknown>): void`; `event.context.requestId: string` trên mọi request.

- [ ] **Step 1: Viết test thất bại**

`tests/unit/server/logger.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { logger, redact } from '../../../server/utils/logger'

describe('redact', () => {
  it('masks sensitive keys at any depth, keeps the rest', () => {
    expect(redact({
      customerPhone: '0901234567',
      nested: { address: '1 Lê Lợi', ok: 1 },
      token: 'abc',
      list: [{ hmacSecret: 's' }, { name: 'Lan' }],
    })).toEqual({
      customerPhone: '[REDACTED]',
      nested: { address: '[REDACTED]', ok: 1 },
      token: '[REDACTED]',
      list: [{ hmacSecret: '[REDACTED]' }, { name: 'Lan' }],
    })
  })

  it('masks postgres connection strings inside strings', () => {
    expect(redact('failed: postgresql://u:p@h/db?sslmode=require')).toBe('failed: postgresql://[REDACTED]')
  })

  it('serializes errors to name + redacted message', () => {
    expect(redact(new Error('boom postgres://a:b@c/d'))).toEqual({ name: 'Error', message: 'boom postgres://[REDACTED]' })
  })

  it('truncates very deep structures', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]')
  })
})

describe('logger', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes one JSON line with level, msg and redacted context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logger.info('order.created', { orderId: 'o1', customerPhone: '0901234567' })
    const line = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(line).toMatchObject({ level: 'info', msg: 'order.created', orderId: 'o1', customerPhone: '[REDACTED]' })
    expect(typeof line.time).toBe('string')
  })

  it('writes errors to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logger.error('x', { err: new Error('bad') })
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toMatchObject({ level: 'error', err: { message: 'bad' } })
  })
})
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → Expected: FAIL (module chưa tồn tại).

- [ ] **Step 3: Implement**

`server/utils/logger.ts`:

```ts
const SENSITIVE_KEY = /phone|address|secret|token|password|authorization|signature|cookie|api[_-]?key|hmac/i
const CONNECTION_STRING = /\b(postgres(?:ql)?):\/\/\S+/gi
const MAX_DEPTH = 6

function redactString(value: string): string {
  return value.replace(CONNECTION_STRING, '$1://[REDACTED]')
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[Truncated]'
  if (typeof value === 'string') return redactString(value)
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) }
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(inner, depth + 1)
    }
    return out
  }
  return value
}

type Level = 'info' | 'warn' | 'error'

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...(ctx ? (redact(ctx) as Record<string, unknown>) : {}),
  })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write('error', msg, ctx),
}
```

`server/types/h3.d.ts`:

```ts
export {}

declare module 'h3' {
  interface H3EventContext {
    requestId: string
  }
}
```

`server/middleware/request-id.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { defineEventHandler, getHeader, setResponseHeader } from 'h3'

const VALID_ID = /^[\w-]{8,64}$/

export default defineEventHandler((event) => {
  const incoming = getHeader(event, 'x-request-id')
  const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, 'x-request-id', requestId)
})
```

- [ ] **Step 4: Dùng logger trong `defineApiHandler`**

Thay khối `if (status >= 500) { ... }` trong `server/utils/api-handler.ts`:

```ts
      if (status >= 500) {
        logger.error('api.unhandled', { requestId: event.context.requestId, path: event.path, err })
      }
```

và thêm import ở đầu file: `import { logger } from './logger'`.

- [ ] **Step 5: Chạy test + typecheck**

Run: `npm run test:unit` → PASS.
Run: `npm run typecheck` → không lỗi.

- [ ] **Step 6: Commit**

```bash
git add server tests/unit/server/logger.test.ts
git commit -m "feat(foundation): add redacting JSON logger and request ids

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: DB client, Drizzle config, Neon test branch, `/api/health`

**Files:**
- Create: `server/utils/env.ts`, `server/db/client.ts`, `server/db/schema/index.ts`, `drizzle.config.ts`, `server/api/health.get.ts`, `tests/setup/integration.ts`, `tests/support/db.ts`
- Create (local, gitignored): `.env.test`
- Test: `tests/integration/db-client.test.ts`, `tests/api/health.test.ts`

**Interfaces:**
- Produces:
  - `requireEnv(name: string): string` (throw `Error('Missing env NAME')`).
  - `getDb(): Db`, `closeDb(): Promise<void>`, `type Db`, `type Tx` (tham số của callback `db.transaction`), `type DbOrTx = Db | Tx`.
  - `resetDb(): Promise<void>` (TRUNCATE mọi bảng schema `public`, giữ migrations).
  - `GET /api/health` → `200 {status:'ok'}` | `503 {code:'SERVICE_UNAVAILABLE', ...}`.
  - Quy ước test: `.env.test` chứa `ZENO_TEST_DB=1`; mọi file trong `tests/integration` và `tests/api` tự nạp nó.

- [ ] **Step 1: Tạo Neon branch `test` và `.env.test`**

```bash
neon branch create --help | head -30          # xác nhận flag --name / --parent
neon branch create --name test --parent production
neon env pull --branch test --file .env.test
printf '\nZENO_TEST_DB=1\nAPP_BASE_URL=http://localhost:3100\n' >> .env.test
grep -c NEON_BRANCH=test .env.test            # Expected: 1
git check-ignore .env.test                    # Expected: .env.test (đã bị ignore)
```

- [ ] **Step 2: Viết test thất bại**

`tests/setup/integration.ts`:

```ts
import { existsSync } from 'node:fs'

if (existsSync('.env.test')) process.loadEnvFile('.env.test')

if (process.env.ZENO_TEST_DB !== '1' || process.env.NEON_BRANCH === 'production') {
  throw new Error('Integration/API tests need .env.test (ZENO_TEST_DB=1) pointing at a non-production Neon branch')
}
```

`tests/integration/db-client.test.ts`:

```ts
import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'

afterAll(async () => {
  await closeDb()
})

describe('getDb', () => {
  it('runs a query against the test branch', async () => {
    const result = await getDb().execute<{ ok: number }>(sql`select 1 as ok`)
    expect(result.rows[0]?.ok).toBe(1)
  })

  it('supports interactive transactions with rollback', async () => {
    const db = getDb()
    await db.execute(sql`create temporary table if not exists tx_probe (v int)`)
    await expect(db.transaction(async (tx) => {
      await tx.execute(sql`insert into tx_probe values (1)`)
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    const result = await db.execute<{ n: number }>(sql`select count(*)::int as n from tx_probe`)
    expect(result.rows[0]?.n).toBe(0)
  })
})
```

> Ghi chú: bảng `temporary` gắn với một connection; Pool có thể trả connection khác cho câu lệnh sau. Nếu case 2 flake vì lý do đó, đổi sang bảng thường `zeno_tx_probe` và `drop table` trong `afterAll`.

`tests/api/health.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

describe('GET /api/health', () => {
  it('returns ok when the database answers', async () => {
    expect(await $fetch('/api/health')).toEqual({ status: 'ok' })
  })

  it('sets an x-request-id header', async () => {
    const res = await fetch('/api/health')
    expect(res.headers.get('x-request-id')).toMatch(/^[\w-]{8,64}$/)
  })

  it('echoes a well-formed incoming x-request-id', async () => {
    const res = await fetch('/api/health', { headers: { 'x-request-id': 'req-12345678' } })
    expect(res.headers.get('x-request-id')).toBe('req-12345678')
  })
})
```

Case 503 (Review Focus #5) được kiểm ở mức unit để không phải dựng server với DB hỏng — thêm vào `tests/unit/server/health.test.ts`:

```ts
import { createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/db/client', () => ({
  getDb: () => ({ execute: () => Promise.reject(new Error('connect failed postgres://u:p@h/db')) }),
}))

describe('health handler', () => {
  it('returns 503 SERVICE_UNAVAILABLE without leaking connection details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { default: handler } = await import('../../../server/api/health.get')
    const req = new IncomingMessage(new Socket())
    req.method = 'GET'
    req.url = '/api/health'
    const res = new ServerResponse(req)
    const event = createEvent(req, res)
    event.context.requestId = 'test-request'
    const body = await handler(event)
    expect(res.statusCode).toBe(503)
    expect(body).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Cơ sở dữ liệu không khả dụng' })
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })
})
```

- [ ] **Step 3: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → FAIL (`server/api/health.get` không tồn tại).
Run: `npx vitest run --project integration` → FAIL (`server/db/client` không tồn tại).

- [ ] **Step 4: Implement**

`server/utils/env.ts`:

```ts
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}
```

`server/db/schema/index.ts`:

```ts
export {}
```

`server/db/client.ts`:

```ts
import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { requireEnv } from '../utils/env'
import * as schema from './schema'

function createDb(pool: Pool) {
  return drizzle({ client: pool, schema })
}

export type Db = ReturnType<typeof createDb>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type DbOrTx = Db | Tx

let pool: Pool | undefined
let db: Db | undefined

export function getDb(): Db {
  if (!db) {
    pool = new Pool({ connectionString: requireEnv('DATABASE_URL') })
    db = createDb(pool)
  }
  return db
}

export async function closeDb(): Promise<void> {
  const current = pool
  pool = undefined
  db = undefined
  await current?.end()
}
```

`drizzle.config.ts`:

```ts
import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

const envFile = process.env.ENV_FILE ?? '.env'
if (existsSync(envFile)) process.loadEnvFile(envFile)

const url = process.env.DATABASE_URL_UNPOOLED
if (!url) throw new Error(`DATABASE_URL_UNPOOLED missing (env file: ${envFile})`)

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url },
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
})
```

`server/api/health.get.ts`:

```ts
import { sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { defineApiHandler } from '../utils/api-handler'
import { AppError } from '../utils/errors'
import { logger } from '../utils/logger'

export default defineApiHandler(async (event) => {
  try {
    await getDb().execute(sql`select 1`)
  }
  catch (err) {
    logger.error('health.db_failed', { requestId: event.context.requestId, err })
    throw new AppError('SERVICE_UNAVAILABLE', 'Cơ sở dữ liệu không khả dụng')
  }
  return { status: 'ok' as const }
})
```

`tests/support/db.ts`:

```ts
import { sql } from 'drizzle-orm'
import { getDb } from '../../server/db/client'

export async function resetDb(): Promise<void> {
  const db = getDb()
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  )
  if (rows.length === 0) return
  const list = rows.map(row => `"public"."${row.tablename}"`).join(', ')
  await db.execute(sql.raw(`truncate table ${list} restart identity cascade`))
}
```

- [ ] **Step 5: Chạy toàn bộ test**

Run: `npm run test:unit` → PASS (gồm `health.test.ts`).
Run: `npm run test:integration` → `drizzle-kit migrate` báo "No migrations" hoặc thành công; 2 tests PASS.
Run: `npm run test:api` → build Nuxt (~1 phút) rồi 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add drizzle.config.ts server tests/setup tests/support tests/integration tests/api tests/unit/server/health.test.ts
git commit -m "feat(foundation): add Neon pool drizzle client and health check

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Neon config (`auth: true`, bucket ảnh public) + storage service

**Files:**
- Modify: `neon.ts`
- Create: `server/services/storage/index.ts`
- Test: `tests/unit/server/storage.test.ts`, `tests/integration/storage.test.ts`

**Interfaces:**
- Produces (`server/services/storage/index.ts`):
  - `PRODUCT_IMAGES_BUCKET = 'product-images'`, `PRIVATE_ASSETS_BUCKET = 'assets'`
  - `publicObjectUrl(bucket: string, key: string): string`
  - `putObject(input: { bucket: string; key: string; body: Uint8Array; contentType: string; cacheControl?: string }): Promise<void>`
  - `deleteObject(bucket: string, key: string): Promise<void>`
- Env mới sau deploy: `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` (trong `.env` và `.env.test`).

- [ ] **Step 1: Cập nhật `neon.ts` và deploy**

Thay khối `defineConfig({...})` phần services (giữ nguyên hàm `branch`):

```ts
export default defineConfig({
  auth: true,
  buckets: {
    assets: { access: "private" },
    "product-images": { access: "public_read" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    // ... giữ nguyên nội dung hiện tại
  },
});
```

```bash
neon config plan                              # Expected: + auth, + bucket product-images
neon deploy                                   # production branch
neon deploy --branch test 2>/dev/null || (neon checkout test && neon deploy && neon checkout production)
neon env pull --branch test --file .env.test  # thêm NEON_AUTH_* cho test
grep -E '^NEON_AUTH_(BASE|JWKS)_URL=' .env .env.test | wc -l   # Expected: 4
neon neon-auth status --branch test           # Expected: enabled
```

> Nếu `neon deploy` không nhận `--branch`, dùng nhánh lệnh trong ngoặc như trên: checkout `test`, deploy, checkout lại `production`. Kiểm tra `.neon` cuối cùng vẫn trỏ `production`.

- [ ] **Step 2: Viết test thất bại**

`tests/unit/server/storage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicObjectUrl } from '../../../server/services/storage'

afterEach(() => vi.unstubAllEnvs())

describe('publicObjectUrl', () => {
  it('builds a path-style URL and encodes each key segment', () => {
    vi.stubEnv('AWS_ENDPOINT_URL_S3', 'https://br-x.storage.example.neon.tech/')
    expect(publicObjectUrl('product-images', 'stores/s1/trà sữa.webp'))
      .toBe('https://br-x.storage.example.neon.tech/product-images/stores/s1/tr%C3%A0%20s%E1%BB%AFa.webp')
  })

  it('throws when the endpoint env is missing', () => {
    vi.stubEnv('AWS_ENDPOINT_URL_S3', '')
    expect(() => publicObjectUrl('product-images', 'a.webp')).toThrow('Missing env AWS_ENDPOINT_URL_S3')
  })
})
```

`tests/integration/storage.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { deleteObject, PRODUCT_IMAGES_BUCKET, publicObjectUrl, putObject } from '../../server/services/storage'

describe('storage service (Neon Object Storage)', () => {
  it('uploads to the public bucket and serves it anonymously', async () => {
    const key = `tests/${randomUUID()}.txt`
    const body = new TextEncoder().encode('xin chào')
    await putObject({ bucket: PRODUCT_IMAGES_BUCKET, key, body, contentType: 'text/plain; charset=utf-8' })
    try {
      const res = await fetch(publicObjectUrl(PRODUCT_IMAGES_BUCKET, key))
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('xin chào')
    }
    finally {
      await deleteObject(PRODUCT_IMAGES_BUCKET, key)
    }
  })
})
```

- [ ] **Step 3: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → FAIL (module storage chưa có).

- [ ] **Step 4: Implement `server/services/storage/index.ts`**

```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { requireEnv } from '../../utils/env'

export const PRODUCT_IMAGES_BUCKET = 'product-images'
export const PRIVATE_ASSETS_BUCKET = 'assets'

let client: S3Client | undefined

function getClient(): S3Client {
  client ??= new S3Client({
    region: requireEnv('AWS_REGION'),
    endpoint: requireEnv('AWS_ENDPOINT_URL_S3'),
    // Neon Object Storage only supports path-style addressing.
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    },
  })
  return client
}

export function publicObjectUrl(bucket: string, key: string): string {
  const base = requireEnv('AWS_ENDPOINT_URL_S3').replace(/\/+$/, '')
  const path = key.split('/').map(encodeURIComponent).join('/')
  return `${base}/${encodeURIComponent(bucket)}/${path}`
}

export async function putObject(input: {
  bucket: string
  key: string
  body: Uint8Array
  contentType: string
  cacheControl?: string
}): Promise<void> {
  await getClient().send(new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    CacheControl: input.cacheControl,
  }))
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
```

- [ ] **Step 5: Chạy test**

Run: `npm run test:unit` → PASS.
Run: `npm run test:integration` → PASS (gồm upload/đọc public). Nếu GET public trả 403: chạy `neon config plan --branch test` / kiểm tra bucket `product-images` trên branch `test` có `public_read`.

- [ ] **Step 6: Commit**

```bash
git add neon.ts server/services/storage tests/unit/server/storage.test.ts tests/integration/storage.test.ts
git commit -m "feat(foundation): enable Neon Auth, add public product-images bucket and storage service

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Playwright E2E smoke + GitHub Actions CI

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `npm run test:e2e` chạy dev server cổng 3100 với `.env.test`, 2 project `mobile-chrome` (Pixel 7) và `mobile-safari` (iPhone 14). CI chạy mọi tầng test trên Neon branch tạm.

- [ ] **Step 1: Viết E2E smoke (test thất bại vì chưa có config)**

`tests/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('landing page renders on mobile', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ZENO Order' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Đăng nhập chủ quán' })).toBeVisible()
})

test('health endpoint is reachable', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
```

Run: `npx playwright test` → Expected: FAIL (không có baseURL/webServer).

- [ ] **Step 2: `playwright.config.ts`**

```ts
import { existsSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

if (existsSync('.env.test')) process.loadEnvFile('.env.test')

const PORT = 3100

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: `npx nuxt dev --port ${PORT} --dotenv .env.test`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
```

> `--dotenv .env.test` để dev server **không** đọc `.env` (production). Trong CI không có file này; biến môi trường được set trực tiếp nên vẫn chạy được.

- [ ] **Step 3: Chạy E2E**

```bash
npx playwright install chromium webkit
npm run test:e2e
```

Expected: 4 passed (2 tests × 2 projects).

- [ ] **Step 4: CI workflow `.github/workflows/ci.yml`**

Trước khi viết, mở README của `neondatabase/create-branch-action` và `neondatabase/delete-branch-action` để xác nhận major version hiện hành và tên output (`db_url`, `db_url_pooled` hoặc `db_url_with_pooler`); sửa tên output trong YAML dưới đây cho khớp.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run build

  integration:
    runs-on: ubuntu-latest
    needs: checks
    env:
      ZENO_TEST_DB: '1'
      NEON_BRANCH: ci-${{ github.run_id }}
      APP_BASE_URL: http://localhost:3100
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - id: branch
        uses: neondatabase/create-branch-action@v6
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          parent_branch: production
          branch_name: ci-${{ github.run_id }}
          api_key: ${{ secrets.NEON_API_KEY }}
      - name: Export branch env
        run: |
          echo "DATABASE_URL=${{ steps.branch.outputs.db_url_pooled }}" >> "$GITHUB_ENV"
          echo "DATABASE_URL_UNPOOLED=${{ steps.branch.outputs.db_url }}" >> "$GITHUB_ENV"
      - run: npx drizzle-kit migrate
      - run: npx vitest run --project integration
      - run: npx vitest run --project api
      - if: always()
        uses: neondatabase/delete-branch-action@v3
        with:
          project_id: ${{ vars.NEON_PROJECT_ID }}
          branch: ci-${{ github.run_id }}
          api_key: ${{ secrets.NEON_API_KEY }}
```

> Storage integration test cần `AWS_*` của branch CI. Nếu action không xuất các biến này, thêm bước `npx neon env pull --branch ci-${{ github.run_id }} --file .env.ci` với `NEON_API_KEY`, rồi `cat .env.ci >> "$GITHUB_ENV"`. Ghi lại cách đã chọn trong PR description.

Cấu hình repo: `Settings → Secrets and variables → Actions`: secret `NEON_API_KEY`, variable `NEON_PROJECT_ID=empty-cake-13522273`.

- [ ] **Step 5: Kiểm tra lint + chạy lại toàn bộ**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:api && npm run test:e2e && npm run build`
Expected: tất cả PASS.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e .github/workflows/ci.yml
git commit -m "chore(foundation): add Playwright mobile E2E and CI with Neon branches

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PR0 Exit Checklist

- [ ] `grep -rn "rejectUnauthorized" server` → không có kết quả.
- [ ] `npm run lint`, `typecheck`, `test:unit`, `test:integration`, `test:api`, `test:e2e`, `build` đều xanh.
- [ ] `neon status` cho branch `production`: auth enabled, buckets `assets` (private), `product-images` (public_read).
- [ ] CI xanh trên PR `chore(foundation)`.
