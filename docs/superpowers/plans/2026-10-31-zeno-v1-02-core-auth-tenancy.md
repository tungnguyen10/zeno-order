# ZENO Mini Order V1 — PR1 Core: Auth, Tenancy & Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner đăng ký/đăng nhập bằng Neon Auth, tạo organization + store đầu tiên; mọi API nội bộ xác thực JWT và giới hạn đúng phạm vi org/store; có ma trận test chứng minh Owner/Staff tenant A không chạm được tenant B.

**Architecture:** Browser dùng `@neon/auth` (vanilla client) → lấy JWT qua `authClient.token()` → gửi `Authorization: Bearer`. Nitro verify JWT bằng `jose` (JWKS của Neon Auth, issuer = origin của `NEON_AUTH_BASE_URL`), rồi đọc membership trong bảng của app. Tenant isolation được DB cưỡng chế bằng composite FK `(org_id, store_id) → stores(org_id, id)`. Owner app (`/app/**`) chạy SPA (`ssr:false`).

**Tech Stack:** @neon/auth 0.8.2, jose 6.2.14, drizzle-orm 0.45.4, zod 4, Nuxt UI 4, @nuxt/test-utils (API tests), Playwright.

**Spec:** [2026-10-31-zeno-mini-order-v1-design.md](../specs/2026-10-31-zeno-mini-order-v1-design.md) (§2, §3.1, §4.1–4.4, §7, §9) · Roadmap: [2026-10-31-zeno-v1-00-roadmap.md](./2026-10-31-zeno-v1-00-roadmap.md) · Phụ thuộc: PR0 đã merge.

## Global Constraints

Áp dụng "Global Constraints" trong roadmap. Điểm chạm PR này:
- Không có quyền với store/org tồn tại → **404 `NOT_FOUND`**; có membership nhưng thiếu role → **403 `FORBIDDEN`**; thiếu/sai token → **401 `UNAUTHENTICATED`**.
- `user_id` là `text` (id của Neon Auth, claim `sub`); **không** FK vào schema `neon_auth`.
- Mọi bảng thuộc store có `(org_id, store_id)` + composite FK `→ stores(org_id, id)`.
- Slug store unique toàn hệ thống, regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 3–40 ký tự, không thuộc `RESERVED_SLUGS`.
- UI tiếng Việt, mobile-first 360px, Nuxt UI v4.

## Review Focus

PR này sở hữu Review Focus #1–#4 của roadmap:
1. **Staff/Owner tenant A gọi resource store B bằng UUID thật** → 404, giống hệt UUID không tồn tại. → Task 5 (`tenant-isolation.test.ts`).
2. **JWT hết hạn / sai issuer / ký bằng key khác / `alg` khác / thiếu `sub`** → 401. → Task 2.
3. **Slug có dấu, chữ hoa, khoảng trắng, trùng slug đã có, slug dành riêng (`app`, `api`, `s`, `o`…)** → client gợi ý slug đã chuẩn hoá; server trả 409 `SLUG_TAKEN` khi trùng, 400 khi dành riêng/sai định dạng. → Task 3 (unit) + Task 4 (integration).
4. **Double-submit onboarding (bấm 2 lần / 2 tab)** → đúng 1 organization; request thứ hai nhận 409 `ORG_EXISTS`. → Task 4.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `server/db/schema/identity.ts` | enums + bảng `user_profiles`, `organizations`, `organization_members`, `stores`, `store_members`, `store_invitations` |
| `server/db/schema/index.ts` (modify) | re-export identity |
| `server/db/errors.ts` | `getPgError`, `isUniqueViolation` (bóc lỗi Postgres qua lớp bọc của Drizzle) |
| `drizzle/0000_identity.sql` (generated) | migration |
| `shared/schemas/identity.ts` | `RESERVED_SLUGS`, `slugify`, `slugSchema`, `onboardingInputSchema`, `updateStoreInputSchema` |
| `shared/types/identity.ts` | `StoreRole`, `MeResponse`, `StoreSummary`, `StoreDetail` |
| `server/auth/jwt.ts` | `createJwtVerifier`, `getJwtVerifier`, `VerifiedUser` |
| `server/auth/require-user.ts` | `requireUser(event)` |
| `server/auth/guards.ts` | `requireStoreStaff`, `requireStoreOwner`, `requireOrgOwner` |
| `server/repositories/membership.ts` | `findStoreAccess`, `findOrgAccess`, `listAccessibleStores`, `listOwnedOrganizations` |
| `server/services/identity/profile.ts` | `ensureProfile` |
| `server/services/identity/onboarding.ts` | `createOrganizationWithStore` |
| `server/services/identity/me.ts` | `getMe` |
| `server/services/store/settings.ts` | `getStoreDetail`, `updateStore` |
| `server/api/me.get.ts`, `server/api/organizations/index.post.ts`, `server/api/stores/index.get.ts`, `server/api/stores/[storeId]/index.get.ts`, `server/api/stores/[storeId]/index.patch.ts` | route handlers mỏng |
| `tests/support/auth.ts` | khoá test EdDSA, `signTestToken` |
| `tests/support/fixtures.ts` | `createUser`, `createTenant` |
| `app/plugins/neon-auth.client.ts` | khởi tạo `authClient` |
| `app/utils/auth-token.ts` | cache JWT theo `exp` |
| `app/utils/api-error.ts` | `extractApiError` |
| `app/composables/useAuth.ts`, `useApi.ts`, `useMe.ts`, `useActiveStore.ts` | trạng thái client |
| `app/middleware/auth.ts`, `app/middleware/has-store.ts` | gate UX |
| `app/layouts/owner.vue` | khung owner app (header, store switcher, bottom nav) |
| `app/pages/login.vue`, `signup.vue`, `onboarding.vue`, `app/index.vue`, `app/orders.vue`, `app/settings.vue` | màn hình |
| `tests/e2e/onboarding.spec.ts` | luồng đăng ký → onboarding → settings → đăng xuất |

---

### Task 1: Identity schema + migration + composite FK

**Files:**
- Create: `server/db/schema/identity.ts`, `server/db/errors.ts`, `drizzle/0000_identity.sql` (generated)
- Modify: `server/db/schema/index.ts`
- Test: `tests/integration/identity-schema.test.ts`, `tests/unit/server/db-errors.test.ts`

**Interfaces:**
- Consumes: `getDb`, `closeDb`, `resetDb` (PR0).
- Produces:
  - Tables (Drizzle objects): `userProfiles`, `organizations`, `organizationMembers`, `stores`, `storeMembers`, `storeInvitations`.
  - Enums: `orgRole` (`'OWNER'`), `storeRole` (`'OWNER' | 'STAFF'`), `memberStatus` (`'ACTIVE' | 'DISABLED'`), `entityStatus` (`'ACTIVE' | 'SUSPENDED'`).
  - Constraint names (dùng để map lỗi): `stores_slug_unique`, `organizations_slug_unique`, `store_members_store_user_uq`, `store_members_store_fk`.
  - `getPgError(err: unknown): { code?: string; constraint?: string }`, `isUniqueViolation(err: unknown, constraint?: string): boolean`.
  - Helper `timestamps` (cột `created_at`, `updated_at`) export từ `identity.ts` cho các schema sau dùng lại.

- [ ] **Step 1: Viết unit test thất bại cho `server/db/errors.ts`**

`tests/unit/server/db-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getPgError, isUniqueViolation } from '../../../server/db/errors'

const pg = (code: string, constraint?: string) => Object.assign(new Error('pg'), { code, constraint })

describe('getPgError', () => {
  it('reads code/constraint from the error itself', () => {
    expect(getPgError(pg('23505', 'stores_slug_unique'))).toEqual({ code: '23505', constraint: 'stores_slug_unique' })
  })

  it('reads code/constraint from a wrapped cause (DrizzleQueryError)', () => {
    const wrapped = Object.assign(new Error('Failed query'), { cause: pg('23503', 'store_members_store_fk') })
    expect(getPgError(wrapped)).toEqual({ code: '23503', constraint: 'store_members_store_fk' })
  })

  it('returns empty object for non-pg errors', () => {
    expect(getPgError(new Error('x'))).toEqual({})
    expect(getPgError('x')).toEqual({})
  })
})

describe('isUniqueViolation', () => {
  it('matches 23505 and optional constraint', () => {
    expect(isUniqueViolation(pg('23505', 'stores_slug_unique'))).toBe(true)
    expect(isUniqueViolation(pg('23505', 'stores_slug_unique'), 'stores_slug_unique')).toBe(true)
    expect(isUniqueViolation(pg('23505', 'other'), 'stores_slug_unique')).toBe(false)
    expect(isUniqueViolation(pg('23503'))).toBe(false)
  })
})
```

- [ ] **Step 2: Viết integration test thất bại cho schema**

`tests/integration/identity-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { organizationMembers, organizations, storeMembers, stores, userProfiles } from '../../server/db/schema'
import { resetDb } from '../support/db'

const db = () => getDb()

async function seedOrgWithStore(slug: string) {
  const [org] = await db().insert(organizations).values({ name: `Org ${slug}`, slug: `org-${slug}` }).returning()
  const [store] = await db().insert(stores).values({ orgId: org!.id, name: `Store ${slug}`, slug }).returning()
  return { org: org!, store: store! }
}

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('identity schema', () => {
  it('applies defaults for a new store', async () => {
    const { store } = await seedOrgWithStore('tra-sua-a')
    expect(store).toMatchObject({
      status: 'ACTIVE',
      isAcceptingOrders: false,
      dineInEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      paymentTtlMinutes: 15,
    })
    expect(store.createdAt).toBeInstanceOf(Date)
  })

  it('rejects a store_member whose org_id does not own the store (composite FK)', async () => {
    const a = await seedOrgWithStore('store-a')
    const b = await seedOrgWithStore('store-b')
    const userId = `user_${randomUUID()}`
    await db().insert(userProfiles).values({ userId, email: 'staff@example.com' })

    let caught: unknown
    try {
      await db().insert(storeMembers).values({ orgId: b.org.id, storeId: a.store.id, userId, role: 'STAFF' })
    }
    catch (err) {
      caught = err
    }
    expect(getPgError(caught)).toMatchObject({ code: '23503', constraint: 'store_members_store_fk' })
  })

  it('enforces globally unique store slugs', async () => {
    await seedOrgWithStore('trung-slug')
    let caught: unknown
    try {
      await seedOrgWithStore('trung-slug')
    }
    catch (err) {
      caught = err
    }
    // organizations slug "org-trung-slug" collides first; both are unique violations
    expect(getPgError(caught).code).toBe('23505')
  })

  it('prevents duplicate membership of the same user in an org', async () => {
    const { org } = await seedOrgWithStore('dup-member')
    const userId = `user_${randomUUID()}`
    await db().insert(userProfiles).values({ userId, email: 'o@example.com' })
    await db().insert(organizationMembers).values({ orgId: org.id, userId, role: 'OWNER' })
    let caught: unknown
    try {
      await db().insert(organizationMembers).values({ orgId: org.id, userId, role: 'OWNER' })
    }
    catch (err) {
      caught = err
    }
    expect(getPgError(caught)).toMatchObject({ code: '23505', constraint: 'organization_members_org_user_uq' })
  })
})
```

- [ ] **Step 3: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → FAIL (`server/db/errors` chưa có).
Run: `npx vitest run --project integration tests/integration/identity-schema.test.ts` → FAIL (schema exports chưa có).

- [ ] **Step 4: Implement `server/db/errors.ts`**

```ts
interface PgLikeError {
  code?: unknown
  constraint?: unknown
  cause?: unknown
}

export function getPgError(err: unknown): { code?: string, constraint?: string } {
  let current: unknown = err
  for (let i = 0; i < 3 && current && typeof current === 'object'; i++) {
    const candidate = current as PgLikeError
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      }
    }
    current = candidate.cause
  }
  return {}
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = getPgError(err)
  return pg.code === '23505' && (constraint === undefined || pg.constraint === constraint)
}
```

> Test `getPgError(new Error('x'))` mong đợi `{}`: hàm trả `{}` vì `Error` không có `code`. Test case 1 mong đợi `{ code, constraint }` đầy đủ — với lỗi không có constraint, kết quả là `{ code, constraint: undefined }`; `toEqual` coi `undefined` property là bằng nhau nên vẫn pass.

- [ ] **Step 5: Implement schema `server/db/schema/identity.ts`**

```ts
import { boolean, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

export const orgRole = pgEnum('org_role', ['OWNER'])
export const storeRole = pgEnum('store_role', ['OWNER', 'STAFF'])
export const memberStatus = pgEnum('member_status', ['ACTIVE', 'DISABLED'])
export const entityStatus = pgEnum('entity_status', ['ACTIVE', 'SUSPENDED'])

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}

export const userProfiles = pgTable('user_profiles', {
  userId: text('user_id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  ...timestamps,
})

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: entityStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
})

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => userProfiles.userId),
  role: orgRole('role').notNull(),
  status: memberStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
}, t => [
  unique('organization_members_org_user_uq').on(t.orgId, t.userId),
  index('organization_members_user_idx').on(t.userId),
])

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: entityStatus('status').notNull().default('ACTIVE'),
  isAcceptingOrders: boolean('is_accepting_orders').notNull().default(false),
  dineInEnabled: boolean('dine_in_enabled').notNull().default(true),
  pickupEnabled: boolean('pickup_enabled').notNull().default(true),
  deliveryEnabled: boolean('delivery_enabled').notNull().default(false),
  logoKey: text('logo_key'),
  paymentTtlMinutes: integer('payment_ttl_minutes').notNull().default(15),
  ...timestamps,
}, t => [
  unique('stores_org_id_id_uq').on(t.orgId, t.id),
  index('stores_org_idx').on(t.orgId),
])

export const storeMembers = pgTable('store_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  userId: text('user_id').notNull().references(() => userProfiles.userId),
  role: storeRole('role').notNull(),
  status: memberStatus('status').notNull().default('ACTIVE'),
  ...timestamps,
}, t => [
  unique('store_members_store_user_uq').on(t.storeId, t.userId),
  foreignKey({ name: 'store_members_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('store_members_user_idx').on(t.userId),
])

export const storeInvitations = pgTable('store_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  storeId: uuid('store_id').notNull(),
  email: text('email').notNull(),
  role: storeRole('role').notNull().default('STAFF'),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedBy: text('accepted_by').references(() => userProfiles.userId),
  createdBy: text('created_by').notNull().references(() => userProfiles.userId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  foreignKey({ name: 'store_invitations_store_fk', columns: [t.orgId, t.storeId], foreignColumns: [stores.orgId, stores.id] }).onDelete('cascade'),
  index('store_invitations_store_idx').on(t.storeId),
])
```

`server/db/schema/index.ts` (thay toàn bộ):

```ts
export * from './identity'
```

- [ ] **Step 6: Sinh migration và áp dụng lên branch test**

```bash
npx drizzle-kit generate --name identity
ls drizzle                                    # Expected: 0000_identity.sql + meta/
grep -c "store_members_store_fk" drizzle/0000_identity.sql   # Expected: 1
grep -n "neon_auth" drizzle/0000_identity.sql                # Expected: không có dòng nào
ENV_FILE=.env.test npx drizzle-kit migrate
```

- [ ] **Step 7: Chạy test**

Run: `npm run test:unit` → PASS.
Run: `npm run test:integration` → PASS (4 tests schema + tests PR0).

- [ ] **Step 8: Commit**

```bash
git add server/db drizzle tests/unit/server/db-errors.test.ts tests/integration/identity-schema.test.ts
git commit -m "feat(core): add identity and tenancy schema with composite store FKs

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: JWT verification + `requireUser` + test signing keys

**Files:**
- Create: `server/auth/jwt.ts`, `server/auth/require-user.ts`, `tests/support/auth.ts`
- Modify: `server/types/h3.d.ts`
- Test: `tests/unit/server/auth/jwt.test.ts`, `tests/unit/server/auth/require-user.test.ts`

**Interfaces:**
- Consumes: `AppError` (PR0), `requireEnv` (PR0).
- Produces:
  - `interface VerifiedUser { userId: string; email: string | null; name: string | null }`
  - `createJwtVerifier(config: { jwks: JWTVerifyGetKey; issuer: string }): (token: string) => Promise<VerifiedUser>` — mọi lỗi → `AppError('UNAUTHENTICATED')`.
  - `getJwtVerifier(): (token: string) => Promise<VerifiedUser>` — production: remote JWKS `NEON_AUTH_JWKS_URL`, issuer `new URL(NEON_AUTH_BASE_URL).origin`; nếu có env `AUTH_TEST_JWKS` (JSON JWKS) → local JWKS, issuer `zeno-test`; **throw khi `VERCEL_ENV === 'production'` mà có `AUTH_TEST_JWKS`**.
  - `resetJwtVerifierForTests(): void`.
  - `requireUser(event: H3Event): Promise<VerifiedUser>` — cache vào `event.context.user`.
  - `tests/support/auth.ts`: `createTestAuth(): Promise<{ jwksJson: string; sign(claims: { sub: string; email?: string; name?: string; expiresIn?: string; issuer?: string }): Promise<string> }>`.

- [ ] **Step 1: Test helper ký JWT `tests/support/auth.ts`**

```ts
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { TEST_JWT_ISSUER } from '../../server/auth/jwt'

export const TEST_ISSUER = TEST_JWT_ISSUER

export async function createTestAuth() {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'EdDSA', use: 'sig' }
  const jwksJson = JSON.stringify({ keys: [jwk] })

  async function sign(claims: { sub: string, email?: string, name?: string, expiresIn?: string, issuer?: string }) {
    const builder = new SignJWT({ email: claims.email, name: claims.name })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'test-key' })
      .setIssuer(claims.issuer ?? TEST_ISSUER)
      .setIssuedAt()
      .setExpirationTime(claims.expiresIn ?? '10m')
    if (claims.sub) builder.setSubject(claims.sub)
    return builder.sign(privateKey)
  }

  return { jwksJson, sign }
}
```

- [ ] **Step 2: Viết test thất bại**

`tests/unit/server/auth/jwt.test.ts`:

```ts
import { createLocalJWKSet, SignJWT } from 'jose'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createJwtVerifier, getJwtVerifier, resetJwtVerifierForTests } from '../../../../server/auth/jwt'
import { AppError } from '../../../../server/utils/errors'
import { createTestAuth, TEST_ISSUER } from '../../../support/auth'

let auth: Awaited<ReturnType<typeof createTestAuth>>
let verify: ReturnType<typeof createJwtVerifier>

beforeAll(async () => {
  auth = await createTestAuth()
  verify = createJwtVerifier({ jwks: createLocalJWKSet(JSON.parse(auth.jwksJson)), issuer: TEST_ISSUER })
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetJwtVerifierForTests()
})

async function expectUnauthenticated(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(AppError)
  await expect(promise).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
}

describe('createJwtVerifier', () => {
  it('returns the user for a valid token', async () => {
    const token = await auth.sign({ sub: 'user-1', email: 'a@example.com', name: 'An' })
    await expect(verify(token)).resolves.toEqual({ userId: 'user-1', email: 'a@example.com', name: 'An' })
  })

  it('returns null email/name when claims are absent', async () => {
    const token = await auth.sign({ sub: 'user-2' })
    await expect(verify(token)).resolves.toEqual({ userId: 'user-2', email: null, name: null })
  })

  it('rejects an expired token', async () => {
    const token = await auth.sign({ sub: 'u', expiresIn: '-1m' })
    await expectUnauthenticated(verify(token))
  })

  it('rejects a token from another issuer', async () => {
    const token = await auth.sign({ sub: 'u', issuer: 'https://evil.example.com' })
    await expectUnauthenticated(verify(token))
  })

  it('rejects a token signed by an unknown key', async () => {
    const other = await createTestAuth()
    await expectUnauthenticated(verify(await other.sign({ sub: 'u' })))
  })

  it('rejects a token without sub', async () => {
    await expectUnauthenticated(verify(await auth.sign({ sub: '' })))
  })

  it('rejects HS256 tokens even with a matching kid', async () => {
    const secret = new TextEncoder().encode('x'.repeat(32))
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setSubject('u').setIssuer(TEST_ISSUER).setExpirationTime('5m').sign(secret)
    await expectUnauthenticated(verify(token))
  })

  it('rejects garbage', async () => {
    await expectUnauthenticated(verify('not-a-jwt'))
  })
})

describe('getJwtVerifier', () => {
  it('uses AUTH_TEST_JWKS when provided outside production', async () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    vi.stubEnv('VERCEL_ENV', 'preview')
    const token = await auth.sign({ sub: 'user-3' })
    await expect(getJwtVerifier()(token)).resolves.toMatchObject({ userId: 'user-3' })
  })

  it('refuses AUTH_TEST_JWKS in Vercel production', () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(() => getJwtVerifier()).toThrow('AUTH_TEST_JWKS must not be set in production')
  })

  it('requires Neon Auth env when no test JWKS', () => {
    vi.stubEnv('AUTH_TEST_JWKS', '')
    vi.stubEnv('NEON_AUTH_JWKS_URL', '')
    expect(() => getJwtVerifier()).toThrow('Missing env NEON_AUTH_JWKS_URL')
  })

  it('builds a remote verifier when Neon Auth env is present', () => {
    vi.stubEnv('AUTH_TEST_JWKS', '')
    vi.stubEnv('NEON_AUTH_JWKS_URL', 'https://auth.example.neon.tech/neondb/auth/.well-known/jwks.json')
    vi.stubEnv('NEON_AUTH_BASE_URL', 'https://auth.example.neon.tech/neondb/auth')
    expect(typeof getJwtVerifier()).toBe('function')
  })

  it('caches the verifier instance', () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    expect(getJwtVerifier()).toBe(getJwtVerifier())
  })
})
```

`tests/unit/server/auth/require-user.test.ts`:

```ts
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetJwtVerifierForTests } from '../../../../server/auth/jwt'
import { requireUser } from '../../../../server/auth/require-user'
import { createTestAuth } from '../../../support/auth'

let auth: Awaited<ReturnType<typeof createTestAuth>>

beforeAll(async () => {
  auth = await createTestAuth()
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetJwtVerifierForTests()
})

function eventWith(headers: Record<string, string>) {
  const req = new IncomingMessage(new Socket())
  req.method = 'GET'
  req.url = '/api/me'
  req.headers = headers
  return createEvent(req, new ServerResponse(req))
}

describe('requireUser', () => {
  it('rejects a request without Authorization', async () => {
    await expect(requireUser(eventWith({}))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('rejects a non-Bearer scheme', async () => {
    await expect(requireUser(eventWith({ authorization: 'Basic abc' }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('verifies the bearer token and caches the user on the event', async () => {
    vi.stubEnv('AUTH_TEST_JWKS', auth.jwksJson)
    const event = eventWith({ authorization: `Bearer ${await auth.sign({ sub: 'user-9', email: 'n@example.com' })}` })
    const user = await requireUser(event)
    expect(user).toEqual({ userId: 'user-9', email: 'n@example.com', name: null })
    expect(event.context.user).toBe(user)
    await expect(requireUser(event)).resolves.toBe(user)
  })
})
```

- [ ] **Step 3: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → FAIL (`server/auth/jwt` chưa có).

- [ ] **Step 4: Implement**

`server/auth/jwt.ts`:

```ts
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from 'jose'
import { AppError } from '../utils/errors'
import { requireEnv } from '../utils/env'

export interface VerifiedUser {
  userId: string
  email: string | null
  name: string | null
}

export type JwtVerifier = (token: string) => Promise<VerifiedUser>

export const TEST_JWT_ISSUER = 'zeno-test'

export function createJwtVerifier(config: { jwks: JWTVerifyGetKey, issuer: string }): JwtVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, config.jwks, {
        issuer: config.issuer,
        algorithms: ['EdDSA', 'Ed25519'],
      })
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) throw new Error('missing sub')
      return {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
        name: typeof payload.name === 'string' ? payload.name : null,
      }
    }
    catch {
      throw new AppError('UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn')
    }
  }
}

let cached: JwtVerifier | undefined

export function getJwtVerifier(): JwtVerifier {
  if (cached) return cached
  const testJwks = process.env.AUTH_TEST_JWKS
  if (testJwks) {
    if (process.env.VERCEL_ENV === 'production') {
      throw new Error('AUTH_TEST_JWKS must not be set in production')
    }
    cached = createJwtVerifier({
      jwks: createLocalJWKSet(JSON.parse(testJwks) as JSONWebKeySet),
      issuer: TEST_JWT_ISSUER,
    })
    return cached
  }
  const jwksUrl = requireEnv('NEON_AUTH_JWKS_URL')
  const issuer = new URL(requireEnv('NEON_AUTH_BASE_URL')).origin
  cached = createJwtVerifier({ jwks: createRemoteJWKSet(new URL(jwksUrl)), issuer })
  return cached
}

export function resetJwtVerifierForTests(): void {
  cached = undefined
}
```

`server/types/h3.d.ts` (thay toàn bộ):

```ts
import type { VerifiedUser } from '../auth/jwt'

declare module 'h3' {
  interface H3EventContext {
    requestId: string
    user?: VerifiedUser
  }
}
```

`server/auth/require-user.ts`:

```ts
import { getHeader, type H3Event } from 'h3'
import { AppError } from '../utils/errors'
import { getJwtVerifier, type VerifiedUser } from './jwt'

const BEARER = /^Bearer\s+(\S+)$/i

export async function requireUser(event: H3Event): Promise<VerifiedUser> {
  if (event.context.user) return event.context.user
  const match = getHeader(event, 'authorization')?.match(BEARER)
  if (!match?.[1]) throw new AppError('UNAUTHENTICATED', 'Bạn cần đăng nhập')
  const user = await getJwtVerifier()(match[1])
  event.context.user = user
  return user
}
```

- [ ] **Step 5: Chạy test**

Run: `npm run test:unit` → PASS (12 tests mới).
Run: `npm run typecheck` → không lỗi.

- [ ] **Step 6: Xác minh claim JWT thật của Neon Auth (thủ công, 1 lần)**

Mục đích: chắc chắn token thật có `sub`, `email`, issuer = origin. Sau Task 6 có UI đăng nhập; tạm thời dùng API của Better Auth:

```bash
set -a; . ./.env.test; set +a
EMAIL="probe+$(date +%s)@example.com"
curl -s -c /tmp/na.jar -H 'content-type: application/json' -H "origin: http://localhost:3100" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Probe-Password-123\",\"name\":\"Probe\"}" \
  "$NEON_AUTH_BASE_URL/sign-up/email" | head -c 300; echo
curl -s -b /tmp/na.jar -H "origin: http://localhost:3100" "$NEON_AUTH_BASE_URL/token" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s).token;const p=JSON.parse(Buffer.from(t.split('.')[1],'base64url'));console.log({iss:p.iss,sub:p.sub,email:p.email,name:p.name,exp:p.exp})})"
```

Expected: `iss` = origin của `NEON_AUTH_BASE_URL`, `sub` khác rỗng, `email` = `$EMAIL`.
- Nếu `iss` khác origin (ví dụ là full URL có path) → đổi `issuer` trong `getJwtVerifier` cho khớp **và** ghi lại trong PR description.
- Nếu sign-up báo yêu cầu xác minh email → chạy `neon neon-auth config --help`, tắt "require email verification" **chỉ cho branch `test`**, ghi lại lệnh đã dùng.
- Nếu `email` vắng → `ensureProfile` (Task 4) sẽ throw; khi đó thêm fallback đọc `select email, name from neon_auth."user" where id = $1` và ghi lại.

Dọn user thăm dò: `neon neon-auth user --help` → xoá user `$EMAIL` trên branch `test`.

- [ ] **Step 7: Commit**

```bash
git add server/auth server/types tests/support/auth.ts tests/unit/server/auth
git commit -m "feat(core): verify Neon Auth JWTs and add requireUser

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Shared identity schemas, membership repository, guards

**Files:**
- Create: `shared/schemas/identity.ts`, `shared/types/identity.ts`, `server/repositories/membership.ts`, `server/auth/guards.ts`, `tests/support/fixtures.ts`
- Test: `tests/unit/shared/identity-schemas.test.ts`, `tests/integration/membership.test.ts`

**Interfaces:**
- Consumes: bảng từ Task 1; `requireUser`, `VerifiedUser` (Task 2); `getDb`, `DbOrTx` (PR0).
- Produces:
  - `#shared/schemas/identity`: `RESERVED_SLUGS: readonly string[]`, `slugify(input: string): string`, `slugSchema`, `onboardingInputSchema` (`{ orgName, storeName, storeSlug }`), `type OnboardingInput`, `updateStoreInputSchema` (`{ name?, isAcceptingOrders? }`, ít nhất 1 field), `type UpdateStoreInput`.
  - `#shared/types/identity`: `type StoreRole = 'OWNER' | 'STAFF'`; `interface StoreSummary { id; orgId; name; slug; role: StoreRole; isAcceptingOrders: boolean }`; `interface OrganizationSummary { id; name; slug; role: 'OWNER' }`; `interface MeResponse { user: { id; email; displayName: string | null }; organizations: OrganizationSummary[]; stores: StoreSummary[] }`; `interface StoreDetail extends StoreSummary { dineInEnabled; pickupEnabled; deliveryEnabled: boolean }`.
  - `server/repositories/membership.ts`: `interface StoreAccess { orgId: string; storeId: string; role: StoreRole }`; `findStoreAccess(db, userId, storeId): Promise<StoreAccess | null>`; `findOrgAccess(db, userId, orgId): Promise<{ orgId: string; role: 'OWNER' } | null>`; `listAccessibleStores(db, userId): Promise<StoreSummary[]>`; `listOwnedOrganizations(db, userId): Promise<OrganizationSummary[]>`.
  - `server/auth/guards.ts`: `interface StoreContext extends StoreAccess { userId: string }`; `requireStoreStaff(event, storeId: string | undefined): Promise<StoreContext>`; `requireStoreOwner(event, storeId): Promise<StoreContext>`; `requireOrgOwner(event, orgId: string | undefined): Promise<{ orgId: string; userId: string }>`.
  - `tests/support/fixtures.ts`: `createUser(opts?: { email?: string })`, `createStore(orgId, label)`, `createTenant(label)` → `{ owner, org, store }`, `addStaff(store, opts?: { status?: 'ACTIVE' | 'DISABLED' })` → `{ userId, email }`.

Quy tắc quyền (membership):
- User là `OWNER` (ACTIVE) của org sở hữu store → role `OWNER` trên mọi store của org đó.
- Ngược lại, có `store_members` ACTIVE → role ghi trong đó (`STAFF`).
- Store `SUSPENDED`, membership `DISABLED`, hoặc khác org → không có quyền (null → 404).

- [ ] **Step 1: Viết unit test thất bại cho schema dùng chung**

`tests/unit/shared/identity-schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { onboardingInputSchema, slugify, slugSchema, updateStoreInputSchema } from '#shared/schemas/identity'

describe('slugify', () => {
  it.each([
    ['Trà Sữa Đậu Đỏ', 'tra-sua-dau-do'],
    ['  Hello   World!! ', 'hello-world'],
    ['Cà phê Muối 24/7', 'ca-phe-muoi-24-7'],
    ['---', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps length at 40 without a trailing dash', () => {
    const slug = slugify('a'.repeat(39) + ' bcd')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('slugSchema', () => {
  it('normalizes case and whitespace', () => {
    expect(slugSchema.parse('  Tra-Sua-A1 ')).toBe('tra-sua-a1')
  })

  it.each(['ab', 'app', 'api', 's', 'o', 'login', 'bad slug', 'a--b', '-ab', 'ab-', 'trà-sữa', 'x'.repeat(41)])(
    'rejects %s',
    (value) => {
      expect(slugSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('onboardingInputSchema', () => {
  it('trims names and validates slug', () => {
    expect(onboardingInputSchema.parse({ orgName: '  Zeno  ', storeName: ' Quán A ', storeSlug: 'quan-a' }))
      .toEqual({ orgName: 'Zeno', storeName: 'Quán A', storeSlug: 'quan-a' })
  })

  it('rejects too-short names', () => {
    expect(onboardingInputSchema.safeParse({ orgName: 'Z', storeName: 'Quán A', storeSlug: 'quan-a' }).success).toBe(false)
  })
})

describe('updateStoreInputSchema', () => {
  it('requires at least one field', () => {
    expect(updateStoreInputSchema.safeParse({}).success).toBe(false)
    expect(updateStoreInputSchema.parse({ isAcceptingOrders: true })).toEqual({ isAcceptingOrders: true })
  })

  it('strips unknown fields such as slug or orgId', () => {
    expect(updateStoreInputSchema.parse({ name: 'Quán B', orgId: 'x', slug: 'y' })).toEqual({ name: 'Quán B' })
  })
})
```

- [ ] **Step 2: Viết integration test thất bại cho repository**

`tests/support/fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { getDb } from '../../server/db/client'
import { organizationMembers, organizations, storeMembers, stores, userProfiles } from '../../server/db/schema'

const shortId = () => randomUUID().slice(0, 8)

export async function createUser(opts: { email?: string } = {}) {
  const userId = `user_${randomUUID()}`
  const email = opts.email ?? `${userId}@example.com`
  await getDb().insert(userProfiles).values({ userId, email })
  return { userId, email }
}

export async function createStore(orgId: string, label: string) {
  const [store] = await getDb().insert(stores)
    .values({ orgId, name: `Store ${label}`, slug: `${label}-${shortId()}` })
    .returning()
  return store!
}

export async function createTenant(label: string) {
  const owner = await createUser()
  const [org] = await getDb().insert(organizations)
    .values({ name: `Org ${label}`, slug: `org-${label}-${shortId()}` })
    .returning()
  await getDb().insert(organizationMembers).values({ orgId: org!.id, userId: owner.userId, role: 'OWNER' })
  const store = await createStore(org!.id, label)
  return { owner, org: org!, store }
}

export async function addStaff(
  store: { id: string, orgId: string },
  opts: { status?: 'ACTIVE' | 'DISABLED' } = {},
) {
  const staff = await createUser()
  await getDb().insert(storeMembers).values({
    orgId: store.orgId,
    storeId: store.id,
    userId: staff.userId,
    role: 'STAFF',
    status: opts.status ?? 'ACTIVE',
  })
  return staff
}
```

`tests/integration/membership.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { findOrgAccess, findStoreAccess, listAccessibleStores, listOwnedOrganizations } from '../../server/repositories/membership'
import { resetDb } from '../support/db'
import { addStaff, createStore, createTenant } from '../support/fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('membership repository', () => {
  it('grants OWNER on every store of the owned org', async () => {
    const a = await createTenant('a')
    const a2 = await createStore(a.org.id, 'a2')
    const db = getDb()
    expect(await findStoreAccess(db, a.owner.userId, a.store.id)).toEqual({ orgId: a.org.id, storeId: a.store.id, role: 'OWNER' })
    expect(await findStoreAccess(db, a.owner.userId, a2.id)).toMatchObject({ role: 'OWNER' })
    expect(await findOrgAccess(db, a.owner.userId, a.org.id)).toEqual({ orgId: a.org.id, role: 'OWNER' })
  })

  it('grants STAFF only on the assigned store', async () => {
    const a = await createTenant('a')
    const a2 = await createStore(a.org.id, 'a2')
    const staff = await addStaff(a.store)
    const db = getDb()
    expect(await findStoreAccess(db, staff.userId, a.store.id)).toMatchObject({ role: 'STAFF' })
    expect(await findStoreAccess(db, staff.userId, a2.id)).toBeNull()
    expect(await findOrgAccess(db, staff.userId, a.org.id)).toBeNull()
  })

  it('denies other tenants, disabled staff and suspended stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const disabled = await addStaff(a.store, { status: 'DISABLED' })
    const db = getDb()
    expect(await findStoreAccess(db, b.owner.userId, a.store.id)).toBeNull()
    expect(await findOrgAccess(db, b.owner.userId, a.org.id)).toBeNull()
    expect(await findStoreAccess(db, disabled.userId, a.store.id)).toBeNull()
    await db.update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, a.store.id))
    expect(await findStoreAccess(db, a.owner.userId, a.store.id)).toBeNull()
  })

  it('lists only accessible stores and owned organizations', async () => {
    const a = await createTenant('a')
    const a2 = await createStore(a.org.id, 'a2')
    const b = await createTenant('b')
    const staff = await addStaff(a.store)
    const db = getDb()

    const ownerStores = await listAccessibleStores(db, a.owner.userId)
    expect(ownerStores.map(s => s.id).sort()).toEqual([a.store.id, a2.id].sort())
    expect(ownerStores.every(s => s.role === 'OWNER')).toBe(true)

    const staffStores = await listAccessibleStores(db, staff.userId)
    expect(staffStores).toEqual([expect.objectContaining({ id: a.store.id, role: 'STAFF', orgId: a.org.id })])

    expect((await listAccessibleStores(db, b.owner.userId)).map(s => s.id)).toEqual([b.store.id])
    expect(await listOwnedOrganizations(db, a.owner.userId)).toEqual([
      { id: a.org.id, name: a.org.name, slug: a.org.slug, role: 'OWNER' },
    ])
    expect(await listOwnedOrganizations(db, staff.userId)).toEqual([])
  })
})
```

- [ ] **Step 3: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → FAIL (`#shared/schemas/identity` chưa có).
Run: `npx vitest run --project integration tests/integration/membership.test.ts` → FAIL (repository chưa có).

- [ ] **Step 4: Implement shared schemas & types**

`shared/schemas/identity.ts`:

```ts
import { z } from 'zod'

export const RESERVED_SLUGS = [
  'admin', 'api', 'app', 'assets', 'auth', 'help', 'invite', 'login', 'logout', 'o', 'onboarding',
  's', 'settings', 'signup', 'static', 'support', 'www', 'zeno', '_nuxt',
] as const

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG = 40

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '')
}

export const slugSchema = z.string()
  .trim()
  .toLowerCase()
  .min(3, 'Đường dẫn cần ít nhất 3 ký tự')
  .max(MAX_SLUG, `Đường dẫn tối đa ${MAX_SLUG} ký tự`)
  .regex(SLUG_PATTERN, 'Chỉ dùng chữ thường không dấu, số và dấu gạch ngang')
  .refine(value => !(RESERVED_SLUGS as readonly string[]).includes(value), 'Đường dẫn này đã được hệ thống dùng')

const nameSchema = z.string().trim().min(2, 'Cần ít nhất 2 ký tự').max(80, 'Tối đa 80 ký tự')

export const onboardingInputSchema = z.object({
  orgName: nameSchema,
  storeName: nameSchema,
  storeSlug: slugSchema,
})
export type OnboardingInput = z.output<typeof onboardingInputSchema>

export const updateStoreInputSchema = z.object({
  name: nameSchema.optional(),
  isAcceptingOrders: z.boolean().optional(),
}).refine(value => Object.values(value).some(v => v !== undefined), 'Không có thay đổi nào')
export type UpdateStoreInput = z.output<typeof updateStoreInputSchema>
```

> Slug `'s'`, `'o'` đã bị chặn bởi `min(3)`; vẫn để trong `RESERVED_SLUGS` để tài liệu hoá route công khai.

`shared/types/identity.ts`:

```ts
export type StoreRole = 'OWNER' | 'STAFF'

export interface StoreSummary {
  id: string
  orgId: string
  name: string
  slug: string
  role: StoreRole
  isAcceptingOrders: boolean
}

export interface StoreDetail extends StoreSummary {
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  role: 'OWNER'
}

export interface MeResponse {
  user: { id: string, email: string, displayName: string | null }
  organizations: OrganizationSummary[]
  stores: StoreSummary[]
}
```

- [ ] **Step 5: Implement repository `server/repositories/membership.ts`**

```ts
import { and, asc, eq, isNotNull, or } from 'drizzle-orm'
import type { OrganizationSummary, StoreRole, StoreSummary } from '#shared/types/identity'
import type { DbOrTx } from '../db/client'
import { organizationMembers, organizations, storeMembers, stores } from '../db/schema'

export interface StoreAccess {
  orgId: string
  storeId: string
  role: StoreRole
}

function storeJoins(userId: string) {
  return {
    org: and(
      eq(organizationMembers.orgId, stores.orgId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'ACTIVE'),
    ),
    store: and(
      eq(storeMembers.storeId, stores.id),
      eq(storeMembers.userId, userId),
      eq(storeMembers.status, 'ACTIVE'),
    ),
  }
}

function effectiveRole(orgRole: string | null, storeRole: StoreRole | null): StoreRole | null {
  return orgRole === 'OWNER' ? 'OWNER' : storeRole
}

export async function findStoreAccess(db: DbOrTx, userId: string, storeId: string): Promise<StoreAccess | null> {
  const joins = storeJoins(userId)
  const [row] = await db
    .select({ storeId: stores.id, orgId: stores.orgId, orgRole: organizationMembers.role, storeRole: storeMembers.role })
    .from(stores)
    .leftJoin(organizationMembers, joins.org)
    .leftJoin(storeMembers, joins.store)
    .where(and(eq(stores.id, storeId), eq(stores.status, 'ACTIVE')))
    .limit(1)
  if (!row) return null
  const role = effectiveRole(row.orgRole, row.storeRole)
  return role ? { orgId: row.orgId, storeId: row.storeId, role } : null
}

export async function findOrgAccess(db: DbOrTx, userId: string, orgId: string): Promise<{ orgId: string, role: 'OWNER' } | null> {
  const [row] = await db
    .select({ orgId: organizationMembers.orgId })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'ACTIVE'),
      eq(organizationMembers.role, 'OWNER'),
      eq(organizations.status, 'ACTIVE'),
    ))
    .limit(1)
  return row ? { orgId: row.orgId, role: 'OWNER' } : null
}

export async function listAccessibleStores(db: DbOrTx, userId: string): Promise<StoreSummary[]> {
  const joins = storeJoins(userId)
  const rows = await db
    .select({
      id: stores.id,
      orgId: stores.orgId,
      name: stores.name,
      slug: stores.slug,
      isAcceptingOrders: stores.isAcceptingOrders,
      orgRole: organizationMembers.role,
      storeRole: storeMembers.role,
    })
    .from(stores)
    .leftJoin(organizationMembers, joins.org)
    .leftJoin(storeMembers, joins.store)
    .where(and(
      eq(stores.status, 'ACTIVE'),
      or(isNotNull(organizationMembers.id), isNotNull(storeMembers.id)),
    ))
    .orderBy(asc(stores.createdAt), asc(stores.name))

  return rows.flatMap((row) => {
    const role = effectiveRole(row.orgRole, row.storeRole)
    if (!role) return []
    return [{ id: row.id, orgId: row.orgId, name: row.name, slug: row.slug, isAcceptingOrders: row.isAcceptingOrders, role }]
  })
}

export async function listOwnedOrganizations(db: DbOrTx, userId: string): Promise<OrganizationSummary[]> {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'ACTIVE'),
      eq(organizationMembers.role, 'OWNER'),
      eq(organizations.status, 'ACTIVE'),
    ))
    .orderBy(asc(organizations.createdAt))
  return rows.map(row => ({ ...row, role: 'OWNER' as const }))
}
```

- [ ] **Step 6: Implement guards `server/auth/guards.ts`**

```ts
import type { H3Event } from 'h3'
import { z } from 'zod'
import { getDb } from '../db/client'
import { findOrgAccess, findStoreAccess, type StoreAccess } from '../repositories/membership'
import { AppError } from '../utils/errors'
import { requireUser } from './require-user'

export interface StoreContext extends StoreAccess {
  userId: string
}

const uuid = z.uuid()

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Không tìm thấy')
}

export async function requireStoreStaff(event: H3Event, storeId: string | undefined): Promise<StoreContext> {
  const user = await requireUser(event)
  if (!storeId || !uuid.safeParse(storeId).success) throw notFound()
  const access = await findStoreAccess(getDb(), user.userId, storeId)
  if (!access) throw notFound()
  return { ...access, userId: user.userId }
}

export async function requireStoreOwner(event: H3Event, storeId: string | undefined): Promise<StoreContext> {
  const context = await requireStoreStaff(event, storeId)
  if (context.role !== 'OWNER') {
    throw new AppError('FORBIDDEN', 'Chỉ chủ cửa hàng được thực hiện thao tác này')
  }
  return context
}

export async function requireOrgOwner(event: H3Event, orgId: string | undefined): Promise<{ orgId: string, userId: string }> {
  const user = await requireUser(event)
  if (!orgId || !uuid.safeParse(orgId).success) throw notFound()
  const access = await findOrgAccess(getDb(), user.userId, orgId)
  if (!access) throw notFound()
  return { orgId: access.orgId, userId: user.userId }
}
```

> Guard được kiểm thử end-to-end qua HTTP ở Task 5 (ma trận cross-tenant) — đó là nơi hành vi 401/403/404 quan trọng.

- [ ] **Step 7: Chạy test**

Run: `npm run test:unit` → PASS.
Run: `npm run test:integration` → PASS.
Run: `npm run typecheck` → không lỗi.

- [ ] **Step 8: Commit**

```bash
git add shared server/repositories server/auth/guards.ts tests/support/fixtures.ts tests/unit/shared tests/integration/membership.test.ts
git commit -m "feat(core): add membership repository and store/org guards

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Identity services + API routes (`/api/me`, onboarding, stores)

**Files:**
- Create: `server/services/identity/profile.ts`, `server/services/identity/onboarding.ts`, `server/services/identity/me.ts`, `server/services/store/settings.ts`
- Create: `server/api/me.get.ts`, `server/api/organizations/index.post.ts`, `server/api/stores/index.get.ts`, `server/api/stores/[storeId]/index.get.ts`, `server/api/stores/[storeId]/index.patch.ts`
- Test: `tests/integration/identity-service.test.ts`

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `ensureProfile(db: DbOrTx, user: VerifiedUser): Promise<{ userId: string; email: string; displayName: string | null }>` — thiếu email → `AppError('UNAUTHENTICATED')`.
  - `createOrganizationWithStore(db: Db, user: VerifiedUser, input: OnboardingInput): Promise<{ organization: OrganizationSummary; store: StoreSummary }>` — `ORG_EXISTS` nếu user đã thuộc org bất kỳ; `SLUG_TAKEN` (`details: { field: 'storeSlug' }`) nếu slug trùng.
  - `getMe(db: Db, user: VerifiedUser): Promise<MeResponse>`.
  - `getStoreDetail(db: DbOrTx, ctx: StoreContext): Promise<StoreDetail>`; `updateStore(db: DbOrTx, ctx: StoreContext, patch: UpdateStoreInput): Promise<StoreDetail>` — luôn lọc theo **cả** `id` và `org_id`; không có dòng → `NOT_FOUND`.
  - HTTP:
    - `GET /api/me` → `MeResponse`
    - `POST /api/organizations` body `OnboardingInput` → `201 { organization, store }`
    - `GET /api/stores` → `{ stores: StoreSummary[] }`
    - `GET /api/stores/:storeId` (staff) → `StoreDetail`
    - `PATCH /api/stores/:storeId` (owner) body `UpdateStoreInput` → `StoreDetail`

- [ ] **Step 1: Viết integration test thất bại**

`tests/integration/identity-service.test.ts`:

```ts
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { organizationMembers, userProfiles } from '../../server/db/schema'
import { getMe } from '../../server/services/identity/me'
import { createOrganizationWithStore } from '../../server/services/identity/onboarding'
import { ensureProfile } from '../../server/services/identity/profile'
import { getStoreDetail, updateStore } from '../../server/services/store/settings'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'

const newUser = (suffix: string) => ({ userId: `user_${suffix}_${Date.now()}`, email: `${suffix}@Example.com`, name: 'Chủ quán' })
const input = (slug: string) => ({ orgName: 'Zeno Group', storeName: 'Quán Một', storeSlug: slug })

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('ensureProfile', () => {
  it('upserts, lowercases email, keeps displayName when the token has no name', async () => {
    const user = newUser('p1')
    await ensureProfile(getDb(), user)
    const updated = await ensureProfile(getDb(), { ...user, email: 'New@Example.com', name: null })
    expect(updated).toMatchObject({ userId: user.userId, email: 'new@example.com', displayName: 'Chủ quán' })
  })

  it('rejects users without an email claim', async () => {
    await expect(ensureProfile(getDb(), { userId: 'u-no-email', email: null, name: null }))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('createOrganizationWithStore', () => {
  it('creates org, owner membership and store; getMe reflects it', async () => {
    const user = newUser('o1')
    const result = await createOrganizationWithStore(getDb(), user, input('quan-mot'))
    expect(result.store).toMatchObject({ slug: 'quan-mot', name: 'Quán Một', role: 'OWNER', isAcceptingOrders: false })
    expect(result.organization).toMatchObject({ name: 'Zeno Group', role: 'OWNER' })

    const me = await getMe(getDb(), user)
    expect(me.user).toEqual({ id: user.userId, email: 'o1@example.com', displayName: 'Chủ quán' })
    expect(me.organizations.map(o => o.id)).toEqual([result.organization.id])
    expect(me.stores.map(s => s.id)).toEqual([result.store.id])
  })

  it('returns SLUG_TAKEN when another org already uses the slug', async () => {
    await createOrganizationWithStore(getDb(), newUser('o2'), input('trung'))
    await expect(createOrganizationWithStore(getDb(), newUser('o3'), input('trung')))
      .rejects.toMatchObject({ code: 'SLUG_TAKEN', details: { field: 'storeSlug' } })
  })

  it('creates exactly one org on concurrent double submit', async () => {
    const user = newUser('dbl')
    const results = await Promise.allSettled([
      createOrganizationWithStore(getDb(), user, input('double-a')),
      createOrganizationWithStore(getDb(), user, input('double-b')),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'ORG_EXISTS' })
    const memberships = await getDb().select().from(organizationMembers).where(eq(organizationMembers.userId, user.userId))
    expect(memberships).toHaveLength(1)
  })

  it('rejects a second onboarding for a user who already belongs to an org', async () => {
    const tenant = await createTenant('exist')
    const [profile] = await getDb().select().from(userProfiles).where(eq(userProfiles.userId, tenant.owner.userId))
    await expect(createOrganizationWithStore(getDb(), { userId: profile!.userId, email: profile!.email, name: null }, input('khac')))
      .rejects.toMatchObject({ code: 'ORG_EXISTS' })
  })
})

describe('store settings', () => {
  it('reads and updates only within the caller context', async () => {
    const a = await createTenant('a')
    const ctx = { orgId: a.org.id, storeId: a.store.id, role: 'OWNER' as const, userId: a.owner.userId }
    expect(await getStoreDetail(getDb(), ctx)).toMatchObject({ id: a.store.id, deliveryEnabled: false })

    const updated = await updateStore(getDb(), ctx, { name: 'Quán Mới', isAcceptingOrders: true })
    expect(updated).toMatchObject({ name: 'Quán Mới', isAcceptingOrders: true, role: 'OWNER' })
  })

  it('throws NOT_FOUND when org/store pair does not match', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const forged = { orgId: b.org.id, storeId: a.store.id, role: 'OWNER' as const, userId: b.owner.userId }
    await expect(getStoreDetail(getDb(), forged)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(updateStore(getDb(), forged, { name: 'Hack' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('getMe for staff lists only the assigned store and no organizations', async () => {
    const a = await createTenant('a')
    const staff = await addStaff(a.store)
    const me = await getMe(getDb(), { userId: staff.userId, email: staff.email, name: null })
    expect(me.organizations).toEqual([])
    expect(me.stores).toEqual([expect.objectContaining({ id: a.store.id, role: 'STAFF' })])
  })
})
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npx vitest run --project integration tests/integration/identity-service.test.ts`
Expected: FAIL (modules services chưa có).

- [ ] **Step 3: Implement services**

`server/services/identity/profile.ts`:

```ts
import { sql } from 'drizzle-orm'
import type { VerifiedUser } from '../../auth/jwt'
import type { DbOrTx } from '../../db/client'
import { userProfiles } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { logger } from '../../utils/logger'

export async function ensureProfile(db: DbOrTx, user: VerifiedUser) {
  if (!user.email) {
    logger.warn('auth.missing_email_claim', { userId: user.userId })
    throw new AppError('UNAUTHENTICATED', 'Tài khoản chưa có email')
  }
  const email = user.email.trim().toLowerCase()
  const [row] = await db
    .insert(userProfiles)
    .values({ userId: user.userId, email, displayName: user.name })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: {
        email,
        displayName: sql`coalesce(excluded.display_name, ${userProfiles.displayName})`,
        updatedAt: new Date(),
      },
    })
    .returning({ userId: userProfiles.userId, email: userProfiles.email, displayName: userProfiles.displayName })
  return row!
}
```

`server/services/identity/onboarding.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { OnboardingInput } from '#shared/schemas/identity'
import type { OrganizationSummary, StoreSummary } from '#shared/types/identity'
import type { VerifiedUser } from '../../auth/jwt'
import type { Db } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { organizationMembers, organizations, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { ensureProfile } from './profile'

export async function createOrganizationWithStore(
  db: Db,
  user: VerifiedUser,
  input: OnboardingInput,
): Promise<{ organization: OrganizationSummary, store: StoreSummary }> {
  try {
    return await db.transaction(async (tx) => {
      await ensureProfile(tx, user)
      // Serialize onboarding per user so a double submit cannot create two orgs.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`onboarding:${user.userId}`}))`)

      const existing = await tx
        .select({ id: organizationMembers.id })
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, user.userId))
        .limit(1)
      if (existing.length > 0) throw new AppError('ORG_EXISTS', 'Bạn đã có tổ chức')

      const [org] = await tx
        .insert(organizations)
        .values({ name: input.orgName, slug: `${input.storeSlug}-${randomBytes(3).toString('hex')}` })
        .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug })
      await tx.insert(organizationMembers).values({ orgId: org!.id, userId: user.userId, role: 'OWNER' })
      const [store] = await tx
        .insert(stores)
        .values({ orgId: org!.id, name: input.storeName, slug: input.storeSlug })
        .returning()

      return {
        organization: { ...org!, role: 'OWNER' as const },
        store: {
          id: store!.id,
          orgId: store!.orgId,
          name: store!.name,
          slug: store!.slug,
          isAcceptingOrders: store!.isAcceptingOrders,
          role: 'OWNER' as const,
        },
      }
    })
  }
  catch (err) {
    if (isUniqueViolation(err, 'stores_slug_unique')) {
      throw new AppError('SLUG_TAKEN', 'Đường dẫn cửa hàng đã được dùng', { field: 'storeSlug' })
    }
    throw err
  }
}
```

`server/services/identity/me.ts`:

```ts
import type { MeResponse } from '#shared/types/identity'
import type { VerifiedUser } from '../../auth/jwt'
import type { Db } from '../../db/client'
import { listAccessibleStores, listOwnedOrganizations } from '../../repositories/membership'
import { ensureProfile } from './profile'

export async function getMe(db: Db, user: VerifiedUser): Promise<MeResponse> {
  const profile = await ensureProfile(db, user)
  const [organizations, stores] = await Promise.all([
    listOwnedOrganizations(db, user.userId),
    listAccessibleStores(db, user.userId),
  ])
  return {
    user: { id: profile.userId, email: profile.email, displayName: profile.displayName },
    organizations,
    stores,
  }
}
```

`server/services/store/settings.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { UpdateStoreInput } from '#shared/schemas/identity'
import type { StoreDetail } from '#shared/types/identity'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { stores } from '../../db/schema'
import { AppError } from '../../utils/errors'

type StoreRow = typeof stores.$inferSelect

function toDetail(row: StoreRow, ctx: StoreContext): StoreDetail {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    role: ctx.role,
    isAcceptingOrders: row.isAcceptingOrders,
    dineInEnabled: row.dineInEnabled,
    pickupEnabled: row.pickupEnabled,
    deliveryEnabled: row.deliveryEnabled,
  }
}

const scope = (ctx: StoreContext) => and(eq(stores.id, ctx.storeId), eq(stores.orgId, ctx.orgId))

export async function getStoreDetail(db: DbOrTx, ctx: StoreContext): Promise<StoreDetail> {
  const [row] = await db.select().from(stores).where(scope(ctx)).limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDetail(row, ctx)
}

export async function updateStore(db: DbOrTx, ctx: StoreContext, patch: UpdateStoreInput): Promise<StoreDetail> {
  const [row] = await db
    .update(stores)
    .set({ ...patch, updatedAt: new Date() })
    .where(scope(ctx))
    .returning()
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDetail(row, ctx)
}
```

- [ ] **Step 4: Implement route handlers**

`server/api/me.get.ts`:

```ts
import { requireUser } from '../auth/require-user'
import { getDb } from '../db/client'
import { getMe } from '../services/identity/me'
import { defineApiHandler } from '../utils/api-handler'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  return getMe(getDb(), user)
})
```

`server/api/organizations/index.post.ts`:

```ts
import { setResponseStatus } from 'h3'
import { onboardingInputSchema } from '#shared/schemas/identity'
import { requireUser } from '../../auth/require-user'
import { getDb } from '../../db/client'
import { createOrganizationWithStore } from '../../services/identity/onboarding'
import { defineApiHandler } from '../../utils/api-handler'
import { parseBody } from '../../utils/validation'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  const input = await parseBody(event, onboardingInputSchema)
  const result = await createOrganizationWithStore(getDb(), user, input)
  setResponseStatus(event, 201)
  return result
})
```

`server/api/stores/index.get.ts`:

```ts
import { requireUser } from '../../auth/require-user'
import { getDb } from '../../db/client'
import { listAccessibleStores } from '../../repositories/membership'
import { defineApiHandler } from '../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const user = await requireUser(event)
  return { stores: await listAccessibleStores(getDb(), user.userId) }
})
```

`server/api/stores/[storeId]/index.get.ts`:

```ts
import { getRouterParam } from 'h3'
import { requireStoreStaff } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { getStoreDetail } from '../../../services/store/settings'
import { defineApiHandler } from '../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  return getStoreDetail(getDb(), ctx)
})
```

`server/api/stores/[storeId]/index.patch.ts`:

```ts
import { getRouterParam } from 'h3'
import { updateStoreInputSchema } from '#shared/schemas/identity'
import { requireStoreOwner } from '../../../auth/guards'
import { getDb } from '../../../db/client'
import { updateStore } from '../../../services/store/settings'
import { defineApiHandler } from '../../../utils/api-handler'
import { parseBody } from '../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  const patch = await parseBody(event, updateStoreInputSchema)
  return updateStore(getDb(), ctx, patch)
})
```

- [ ] **Step 5: Chạy test**

Run: `npm run test:integration` → PASS.
Run: `npm run typecheck && npm run lint` → không lỗi.

- [ ] **Step 6: Commit**

```bash
git add server/services server/api tests/integration/identity-service.test.ts
git commit -m "feat(core): add onboarding, me and store settings APIs

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Ma trận cross-tenant qua HTTP (server Nuxt build thật)

**Files:**
- Test: `tests/api/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: mọi route của Task 4; `createTestAuth` (Task 2); fixtures (Task 3); `AUTH_TEST_JWKS` seam.
- Produces: bộ test hồi quy dùng lại ở mọi PR sau — PR sau thêm route mới **phải** thêm hàng vào ma trận này (quy ước ghi trong roadmap).

Task này không thêm code sản phẩm; nếu có test fail, sửa ở guard/service tương ứng của Task 3–4 (không nới test).

- [ ] **Step 1: Viết test**

`tests/api/tenant-isolation.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createTestAuth } from '../support/auth'
import { resetDb } from '../support/db'
import { addStaff, createStore, createTenant, createUser } from '../support/fixtures'

const auth = await createTestAuth()
process.env.AUTH_TEST_JWKS = auth.jwksJson

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

type Actor = 'ownerA' | 'staffA1' | 'staffA2' | 'disabledA1' | 'ownerB'
const tokens = {} as Record<Actor, string>
const ids = {} as { orgA: string, storeA1: string, storeA2: string, storeB: string, storeA1Slug: string }

async function call(method: string, path: string, token?: string | null, body?: unknown) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload: string | undefined
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = typeof body === 'string' ? body : JSON.stringify(body)
  }
  const res = await fetch(path, { method, headers, body: payload })
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

beforeAll(async () => {
  await resetDb()
  const a = await createTenant('a1')
  const storeA2 = await createStore(a.org.id, 'a2')
  const b = await createTenant('b1')
  const staffA1 = await addStaff(a.store)
  const staffA2 = await addStaff(storeA2)
  const disabledA1 = await addStaff(a.store, { status: 'DISABLED' })

  Object.assign(ids, { orgA: a.org.id, storeA1: a.store.id, storeA2: storeA2.id, storeB: b.store.id, storeA1Slug: a.store.slug })
  const sign = (user: { userId: string, email: string }) => auth.sign({ sub: user.userId, email: user.email })
  tokens.ownerA = await sign(a.owner)
  tokens.staffA1 = await sign(staffA1)
  tokens.staffA2 = await sign(staffA2)
  tokens.disabledA1 = await sign(disabledA1)
  tokens.ownerB = await sign(b.owner)
})

afterAll(async () => {
  await closeDb()
})

describe('authentication', () => {
  it.each([
    ['GET', '/api/me'],
    ['GET', '/api/stores'],
    ['POST', '/api/organizations'],
  ])('%s %s without token → 401', async (method, path) => {
    const res = await call(method, path, null, method === 'POST' ? {} : undefined)
    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('rejects a garbage bearer token', async () => {
    expect((await call('GET', '/api/me', 'not-a-jwt')).status).toBe(401)
  })

  it('rejects a token signed by another key', async () => {
    const other = await createTestAuth()
    const token = await other.sign({ sub: 'intruder', email: 'i@example.com' })
    expect((await call('GET', '/api/me', token)).status).toBe(401)
  })
})

describe('GET /api/stores/:storeId', () => {
  it.each<[Actor, number]>([
    ['ownerA', 200],
    ['staffA1', 200],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
  ])('%s → %i', async (actor, status) => {
    const res = await call('GET', `/api/stores/${ids.storeA1}`, tokens[actor])
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body).toMatchObject({ id: ids.storeA1, orgId: ids.orgA })
  })

  it('treats another tenant\'s real store exactly like a random id', async () => {
    const real = await call('GET', `/api/stores/${ids.storeA1}`, tokens.ownerB)
    const random = await call('GET', `/api/stores/${randomUUID()}`, tokens.ownerB)
    expect(real).toEqual(random)
  })

  it('returns 404 (not 400/500) for a non-uuid id', async () => {
    const res = await call('GET', '/api/stores/not-a-uuid', tokens.ownerA)
    expect(res.status).toBe(404)
  })

  it('reports the caller role', async () => {
    expect((await call('GET', `/api/stores/${ids.storeA1}`, tokens.ownerA)).body).toMatchObject({ role: 'OWNER' })
    expect((await call('GET', `/api/stores/${ids.storeA1}`, tokens.staffA1)).body).toMatchObject({ role: 'STAFF' })
  })
})

describe('PATCH /api/stores/:storeId', () => {
  it.each<[Actor, number]>([
    ['staffA1', 403],
    ['staffA2', 404],
    ['disabledA1', 404],
    ['ownerB', 404],
    ['ownerA', 200],
  ])('%s → %i', async (actor, status) => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}`, tokens[actor], { name: `Đổi bởi ${actor}` })
    expect(res.status).toBe(status)
  })

  it('only the owner change was persisted', async () => {
    const [row] = await getDb().select().from(stores).where(eq(stores.id, ids.storeA1))
    expect(row!.name).toBe('Đổi bởi ownerA')
  })

  it('ignores attempts to move the store to another org or change slug', async () => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}`, tokens.ownerA, {
      isAcceptingOrders: true,
      orgId: randomUUID(),
      slug: 'hijack',
    })
    expect(res.status).toBe(200)
    const [row] = await getDb().select().from(stores).where(eq(stores.id, ids.storeA1))
    expect(row).toMatchObject({ orgId: ids.orgA, slug: ids.storeA1Slug, isAcceptingOrders: true })
  })

  it('rejects an empty patch with 400', async () => {
    const res = await call('PATCH', `/api/stores/${ids.storeA1}`, tokens.ownerA, {})
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})

describe('listing endpoints', () => {
  it('GET /api/stores is scoped per caller', async () => {
    const list = async (actor: Actor) => ((await call('GET', '/api/stores', tokens[actor])).body.stores as { id: string }[]).map(s => s.id).sort()
    expect(await list('ownerA')).toEqual([ids.storeA1, ids.storeA2].sort())
    expect(await list('staffA1')).toEqual([ids.storeA1])
    expect(await list('staffA2')).toEqual([ids.storeA2])
    expect(await list('disabledA1')).toEqual([])
    expect(await list('ownerB')).toEqual([ids.storeB])
  })

  it('GET /api/me for staff has no organizations', async () => {
    const res = await call('GET', '/api/me', tokens.staffA1)
    expect(res.status).toBe(200)
    expect(res.body.organizations).toEqual([])
    expect(res.body.stores).toEqual([expect.objectContaining({ id: ids.storeA1, role: 'STAFF' })])
  })
})

describe('POST /api/organizations', () => {
  it('creates once, then ORG_EXISTS', async () => {
    const user = { userId: `user_${randomUUID()}`, email: `new-${Date.now()}@example.com` }
    const token = await auth.sign({ sub: user.userId, email: user.email, name: 'Mới' })
    const body = { orgName: 'Nhóm Mới', storeName: 'Quán Mới', storeSlug: `quan-moi-${Date.now().toString(36)}` }
    const first = await call('POST', '/api/organizations', token, body)
    expect(first.status).toBe(201)
    expect(first.body.store).toMatchObject({ slug: body.storeSlug, role: 'OWNER' })
    const second = await call('POST', '/api/organizations', token, { ...body, storeSlug: `${body.storeSlug}-2` })
    expect(second).toMatchObject({ status: 409, body: { code: 'ORG_EXISTS' } })
  })

  it('returns SLUG_TAKEN for an existing slug', async () => {
    const user = await createUser()
    const token = await auth.sign({ sub: user.userId, email: user.email })
    const res = await call('POST', '/api/organizations', token, { orgName: 'X Group', storeName: 'X Store', storeSlug: ids.storeA1Slug })
    expect(res).toMatchObject({ status: 409, body: { code: 'SLUG_TAKEN', details: { field: 'storeSlug' } } })
  })

  it.each(['app', 'Bad Slug', 'ab'])('rejects slug %s with 400', async (storeSlug) => {
    const user = await createUser()
    const token = await auth.sign({ sub: user.userId, email: user.email })
    const res = await call('POST', '/api/organizations', token, { orgName: 'Y Group', storeName: 'Y Store', storeSlug })
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })

  it('rejects malformed JSON with 400', async () => {
    const user = await createUser()
    const token = await auth.sign({ sub: user.userId, email: user.email })
    const res = await call('POST', '/api/organizations', token, '{"orgName":')
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
  })
})
```

- [ ] **Step 2: Chạy test**

Run: `npm run test:api`
Expected: PASS toàn bộ (gồm `health.test.ts` của PR0). Nếu case nào fail, sửa code sản phẩm ở Task 3/4 rồi chạy lại; **không** sửa expectation của ma trận.

- [ ] **Step 3: Commit**

```bash
git add tests/api/tenant-isolation.test.ts
git commit -m "test(core): add cross-tenant authorization matrix over HTTP

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Client auth plumbing — token cache, API client, composables, middleware

**Files:**
- Create: `app/utils/auth-token.ts`, `app/utils/api-error.ts`, `app/utils/auth-errors.ts`, `app/utils/safe-redirect.ts`, `app/plugins/neon-auth.client.ts`, `app/composables/useAuth.ts`, `app/composables/useApi.ts`, `app/composables/useMe.ts`, `app/composables/useActiveStore.ts`, `app/middleware/auth.ts`, `app/middleware/has-store.ts`
- Test: `tests/unit/app/auth-token.test.ts`, `tests/unit/app/client-utils.test.ts`

**Interfaces:**
- Consumes: `ApiErrorBody` (`#shared/errors`), `MeResponse`, `StoreSummary` (`#shared/types/identity`), `runtimeConfig.public.neonAuthUrl` (PR0).
- Produces:
  - `decodeJwtExp(token: string): number | null`, `isTokenFresh(token: string, nowSec: number, skewSec?: number): boolean`, `createTokenCache(source: { token: () => Promise<{ data?: { token?: string } | null }> }, now?: () => number): { get(): Promise<string | null>; clear(): void }`.
  - `extractApiError(err: unknown): ApiErrorBody`.
  - `translateAuthError(error: { code?: string; message?: string } | null | undefined): string`.
  - `safeRedirect(value: unknown, fallback?: string): string`.
  - Nuxt provide: `$authClient` (client `@neon/auth`), `$tokenCache`.
  - `useAuth(): { user: Ref<SessionUser | null>; ready: Ref<boolean>; refresh(); signIn(email, password); signUp(name, email, password); signOut() }` — lỗi ném `AuthFailure` (message tiếng Việt).
  - `useApi(): $Fetch` — tự gắn `Authorization: Bearer`.
  - `useMe(): { me: Ref<MeResponse | null>; load(force?: boolean): Promise<MeResponse> }`.
  - `useActiveStore(): { stores: ComputedRef<StoreSummary[]>; activeStore: ComputedRef<StoreSummary | null>; setActiveStore(id: string): void }` — cookie `zeno_active_store`.
  - Route middleware `auth` (chưa đăng nhập → `/login?redirect=`), `has-store` (chưa có store → `/onboarding`).

- [ ] **Step 1: Viết unit test thất bại**

`tests/unit/app/auth-token.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createTokenCache, decodeJwtExp, isTokenFresh } from '../../../app/utils/auth-token'

function fakeJwt(exp: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA' })}.${encode({ sub: 'u', exp })}.sig`
}

describe('decodeJwtExp / isTokenFresh', () => {
  it('reads exp from a base64url payload', () => {
    expect(decodeJwtExp(fakeJwt(1_900_000_000))).toBe(1_900_000_000)
  })

  it('returns null for malformed tokens', () => {
    expect(decodeJwtExp('abc')).toBeNull()
    expect(decodeJwtExp('a.!!!.c')).toBeNull()
  })

  it('treats tokens expiring within the skew as stale', () => {
    expect(isTokenFresh(fakeJwt(1000), 900)).toBe(true)
    expect(isTokenFresh(fakeJwt(1000), 950)).toBe(false)
    expect(isTokenFresh('abc', 0)).toBe(false)
  })
})

describe('createTokenCache', () => {
  it('reuses a fresh token and refetches when stale', async () => {
    let now = 1000
    const token = vi.fn()
      .mockResolvedValueOnce({ data: { token: fakeJwt(2000) } })
      .mockResolvedValueOnce({ data: { token: fakeJwt(3000) } })
    const cache = createTokenCache({ token }, () => now)
    const first = await cache.get()
    expect(await cache.get()).toBe(first)
    expect(token).toHaveBeenCalledTimes(1)
    now = 1990
    expect(await cache.get()).not.toBe(first)
    expect(token).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const token = vi.fn().mockResolvedValue({ data: { token: fakeJwt(5000) } })
    const cache = createTokenCache({ token }, () => 1000)
    const [a, b] = await Promise.all([cache.get(), cache.get()])
    expect(a).toBe(b)
    expect(token).toHaveBeenCalledTimes(1)
  })

  it('returns null when signed out and refetches after clear()', async () => {
    const token = vi.fn()
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { token: fakeJwt(5000) } })
    const cache = createTokenCache({ token }, () => 1000)
    expect(await cache.get()).toBeNull()
    cache.clear()
    expect(await cache.get()).not.toBeNull()
  })
})
```

`tests/unit/app/client-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extractApiError } from '../../../app/utils/api-error'
import { translateAuthError } from '../../../app/utils/auth-errors'
import { safeRedirect } from '../../../app/utils/safe-redirect'

describe('extractApiError', () => {
  it('returns the API body from a FetchError-like object', () => {
    expect(extractApiError({ data: { code: 'SLUG_TAKEN', message: 'Đã dùng', details: { field: 'storeSlug' } } }))
      .toEqual({ code: 'SLUG_TAKEN', message: 'Đã dùng', details: { field: 'storeSlug' } })
  })

  it('falls back to a network message', () => {
    expect(extractApiError(new TypeError('Failed to fetch'))).toEqual({
      code: 'INTERNAL',
      message: 'Không kết nối được máy chủ, vui lòng thử lại',
    })
  })
})

describe('translateAuthError', () => {
  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', 'Email hoặc mật khẩu không đúng'],
    ['USER_ALREADY_EXISTS', 'Email này đã được đăng ký'],
    ['USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', 'Email này đã được đăng ký'],
    ['PASSWORD_TOO_SHORT', 'Mật khẩu cần ít nhất 8 ký tự'],
    ['EMAIL_NOT_VERIFIED', 'Bạn cần xác minh email trước khi đăng nhập'],
  ])('%s', (code, message) => {
    expect(translateAuthError({ code })).toBe(message)
  })

  it('falls back to a generic message', () => {
    expect(translateAuthError({ code: 'WHATEVER' })).toBe('Có lỗi xảy ra, vui lòng thử lại')
    expect(translateAuthError(null)).toBe('Có lỗi xảy ra, vui lòng thử lại')
  })
})

describe('safeRedirect', () => {
  it.each([
    ['/app/settings', '/app/settings'],
    ['//evil.com', '/app'],
    ['/\\evil.com', '/app'],
    ['https://evil.com', '/app'],
    [undefined, '/app'],
    [['/a', '/b'], '/app'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected)
  })
})
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npm run test:unit` → FAIL (module `app/utils/*` chưa có).

- [ ] **Step 3: Implement utils**

`app/utils/auth-token.ts`:

```ts
export function decodeJwtExp(token: string): number | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as { exp?: unknown }
    return typeof payload.exp === 'number' ? payload.exp : null
  }
  catch {
    return null
  }
}

export function isTokenFresh(token: string, nowSec: number, skewSec = 60): boolean {
  const exp = decodeJwtExp(token)
  return exp !== null && exp - skewSec > nowSec
}

interface TokenSource {
  token: () => Promise<{ data?: { token?: string } | null }>
}

export function createTokenCache(source: TokenSource, now: () => number = () => Math.floor(Date.now() / 1000)) {
  let current: string | null = null
  let inflight: Promise<string | null> | null = null

  async function get(): Promise<string | null> {
    if (current && isTokenFresh(current, now())) return current
    inflight ??= source.token()
      .then((result) => {
        current = result.data?.token ?? null
        return current
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  function clear(): void {
    current = null
  }

  return { get, clear }
}
```

`app/utils/api-error.ts`:

```ts
import type { ApiErrorBody } from '#shared/errors'

export function extractApiError(err: unknown): ApiErrorBody {
  const data = (err as { data?: unknown } | null)?.data
  if (data && typeof data === 'object' && 'code' in data && 'message' in data) {
    return data as ApiErrorBody
  }
  return { code: 'INTERNAL', message: 'Không kết nối được máy chủ, vui lòng thử lại' }
}
```

`app/utils/auth-errors.ts`:

```ts
export function translateAuthError(error: { code?: string, message?: string } | null | undefined): string {
  const code = error?.code ?? ''
  if (code === 'INVALID_EMAIL_OR_PASSWORD') return 'Email hoặc mật khẩu không đúng'
  if (code.startsWith('USER_ALREADY_EXISTS')) return 'Email này đã được đăng ký'
  if (code === 'PASSWORD_TOO_SHORT') return 'Mật khẩu cần ít nhất 8 ký tự'
  if (code === 'EMAIL_NOT_VERIFIED') return 'Bạn cần xác minh email trước khi đăng nhập'
  return 'Có lỗi xảy ra, vui lòng thử lại'
}
```

`app/utils/safe-redirect.ts`:

```ts
export function safeRedirect(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback
  return value
}
```

- [ ] **Step 4: Chạy unit test**

Run: `npm run test:unit` → PASS.

- [ ] **Step 5: Implement plugin, composables, middleware**

```bash
npm install --save-exact @neon/auth@0.8.2
```

`app/plugins/neon-auth.client.ts`:

```ts
import { createAuthClient } from '@neon/auth'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  if (!config.public.neonAuthUrl) {
    throw new Error('runtimeConfig.public.neonAuthUrl is empty — set NEON_AUTH_BASE_URL at build time')
  }
  const authClient = createAuthClient(config.public.neonAuthUrl)
  const tokenCache = createTokenCache({ token: () => authClient.token() })
  return { provide: { authClient, tokenCache } }
})
```

> Nếu TypeScript báo kiểu trả về của `authClient.token()` không khớp `TokenSource`, bọc lại: `token: async () => { const r = await authClient.token(); return { data: r.data ? { token: r.data.token } : null } }`.

`app/composables/useAuth.ts`:

```ts
export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export class AuthFailure extends Error {}

export function useAuth() {
  const { $authClient, $tokenCache } = useNuxtApp()
  const user = useState<SessionUser | null>('auth:user', () => null)
  const ready = useState<boolean>('auth:ready', () => false)

  async function refresh(): Promise<SessionUser | null> {
    const { data } = await $authClient.getSession()
    user.value = data?.user
      ? { id: data.user.id, email: data.user.email, name: data.user.name ?? null }
      : null
    ready.value = true
    return user.value
  }

  async function signIn(email: string, password: string): Promise<void> {
    const { error } = await $authClient.signIn.email({ email, password })
    if (error) throw new AuthFailure(translateAuthError(error))
    $tokenCache.clear()
    await refresh()
  }

  async function signUp(name: string, email: string, password: string): Promise<void> {
    const { error } = await $authClient.signUp.email({ name, email, password })
    if (error) throw new AuthFailure(translateAuthError(error))
    $tokenCache.clear()
    await refresh()
  }

  async function signOut(): Promise<void> {
    await $authClient.signOut()
    $tokenCache.clear()
    user.value = null
    clearNuxtState(['me'])
  }

  return { user, ready, refresh, signIn, signUp, signOut }
}
```

`app/composables/useApi.ts`:

```ts
export function useApi() {
  const { $tokenCache } = useNuxtApp()
  return $fetch.create({
    async onRequest({ options }) {
      const token = await $tokenCache.get()
      if (!token) return
      const headers = new Headers(options.headers as HeadersInit | undefined)
      headers.set('authorization', `Bearer ${token}`)
      options.headers = headers
    },
  })
}
```

`app/composables/useMe.ts`:

```ts
import type { MeResponse } from '#shared/types/identity'

export function useMe() {
  const me = useState<MeResponse | null>('me', () => null)
  const api = useApi()

  async function load(force = false): Promise<MeResponse> {
    if (me.value && !force) return me.value
    me.value = await api<MeResponse>('/api/me')
    return me.value
  }

  return { me, load }
}
```

`app/composables/useActiveStore.ts`:

```ts
export function useActiveStore() {
  const { me } = useMe()
  const cookie = useCookie<string | null>('zeno_active_store', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const stores = computed(() => me.value?.stores ?? [])
  const activeStore = computed(() => stores.value.find(store => store.id === cookie.value) ?? stores.value[0] ?? null)

  function setActiveStore(id: string): void {
    if (stores.value.some(store => store.id === id)) cookie.value = id
  }

  return { stores, activeStore, setActiveStore }
}
```

`app/middleware/auth.ts`:

```ts
export default defineNuxtRouteMiddleware(async (to) => {
  const { user, ready, refresh } = useAuth()
  if (!ready.value) await refresh()
  if (!user.value) return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
})
```

`app/middleware/has-store.ts`:

```ts
export default defineNuxtRouteMiddleware(async () => {
  const { load } = useMe()
  const me = await load()
  if (me.stores.length === 0) return navigateTo('/onboarding')
})
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint` → không lỗi.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app/utils app/plugins app/composables app/middleware tests/unit/app
git commit -m "feat(core): add Neon Auth client, token cache and owner composables

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Màn hình đăng ký/đăng nhập/onboarding/owner shell + E2E

**Files:**
- Create: `app/layouts/owner.vue`, `app/pages/login.vue`, `app/pages/signup.vue`, `app/pages/onboarding.vue`, `app/pages/app/index.vue`, `app/pages/app/orders.vue`, `app/pages/app/settings.vue`
- Modify: `docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` (§9 bổ sung `ORG_EXISTS`, `SERVICE_UNAVAILABLE`)
- Test: `tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: Task 6 composables/middleware; API Task 4.
- Produces: các route UI; `data-testid="active-store-name"` trong layout owner (E2E và PR sau dùng). Nav owner có mục "Đơn hàng" (`/app/orders`) và "Cài đặt" (`/app/settings`); PR2/PR4 thêm "Thực đơn", "Báo cáo".

- [ ] **Step 1: Viết E2E thất bại**

`tests/e2e/onboarding.spec.ts`:

```ts
import { expect, test } from '@playwright/test'

test('visitor is redirected to login with a return path', async ({ page }) => {
  await page.goto('/app/settings')
  await expect(page).toHaveURL(/\/login\?redirect=%2Fapp%2Fsettings$/)
})

test('owner signs up, onboards, edits settings, survives reload and signs out', async ({ page }, testInfo) => {
  const stamp = `${Date.now().toString(36)}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`
  const email = `e2e+${stamp}@example.com`
  const slug = `e2e-${stamp}`

  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán E2E')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mật khẩu').fill('E2e-Password-123')
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()

  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill('E2E Group')
  await page.getByLabel('Tên cửa hàng').fill('Trà Sữa E2E')
  await expect(page.getByLabel('Đường dẫn cửa hàng')).toHaveValue('tra-sua-e2e')
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()

  await expect(page).toHaveURL(/\/app\/orders$/)
  await expect(page.getByTestId('active-store-name')).toHaveText('Trà Sữa E2E')

  await page.reload()
  await expect(page.getByTestId('active-store-name')).toHaveText('Trà Sữa E2E')

  await page.getByRole('link', { name: 'Cài đặt' }).click()
  await expect(page).toHaveURL(/\/app\/settings$/)
  const accepting = page.getByRole('switch', { name: 'Đang nhận đơn' })
  await expect(accepting).not.toBeChecked()
  await accepting.click()
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(page.getByText('Đã lưu cài đặt')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Đang nhận đơn' })).toBeChecked()

  await page.getByRole('button', { name: 'Đăng xuất' }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/app/orders')
  await expect(page).toHaveURL(/\/login\?redirect=/)
})

test('login shows a Vietnamese error for wrong credentials', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('khong-ton-tai@example.com')
  await page.getByLabel('Mật khẩu').fill('Sai-mat-khau-1')
  await page.getByRole('button', { name: 'Đăng nhập' }).click()
  await expect(page.getByText('Email hoặc mật khẩu không đúng')).toBeVisible()
})
```

Run: `npm run test:e2e -- tests/e2e/onboarding.spec.ts` → Expected: FAIL (trang `/signup` chưa có).

- [ ] **Step 2: Layout owner `app/layouts/owner.vue`**

```vue
<script setup lang="ts">
const { stores, activeStore, setActiveStore } = useActiveStore()
const { signOut } = useAuth()

const storeItems = computed(() => stores.value.map(store => ({ label: store.name, value: store.id })))
const selectedStoreId = computed({
  get: () => activeStore.value?.id,
  set: (id) => {
    if (id) setActiveStore(id)
  },
})

const navItems = [
  { label: 'Đơn hàng', to: '/app/orders', icon: 'i-lucide-receipt' },
  { label: 'Cài đặt', to: '/app/settings', icon: 'i-lucide-settings' },
]

async function onSignOut() {
  await signOut()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default">
    <header class="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-default bg-default/95 px-4 py-3 backdrop-blur">
      <div class="min-w-0 flex-1">
        <USelect
          v-if="storeItems.length > 1"
          v-model="selectedStoreId"
          :items="storeItems"
          aria-label="Chọn cửa hàng"
          class="w-full max-w-60"
        />
        <p v-else data-testid="active-store-name" class="truncate font-semibold">
          {{ activeStore?.name }}
        </p>
        <span v-if="storeItems.length > 1" data-testid="active-store-name" class="sr-only">{{ activeStore?.name }}</span>
      </div>
      <UButton variant="ghost" color="neutral" icon="i-lucide-log-out" @click="onSignOut">
        Đăng xuất
      </UButton>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4">
      <slot />
    </main>

    <nav class="fixed inset-x-0 bottom-0 border-t border-default bg-default pb-[env(safe-area-inset-bottom)]" aria-label="Điều hướng chính">
      <ul class="mx-auto flex max-w-3xl">
        <li v-for="item in navItems" :key="item.to" class="flex-1">
          <ULink
            :to="item.to"
            class="flex min-h-14 flex-col items-center justify-center gap-1 text-xs"
            active-class="text-primary font-semibold"
            inactive-class="text-muted"
          >
            <UIcon :name="item.icon" class="size-5" />
            {{ item.label }}
          </ULink>
        </li>
      </ul>
    </nav>
  </div>
</template>
```

- [ ] **Step 3: `app/pages/login.vue`**

```vue
<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

useHead({ title: 'Đăng nhập — ZENO' })

const schema = z.object({
  email: z.email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ email: '', password: '' })
const errorMessage = ref<string | null>(null)
const loading = ref(false)
const route = useRoute()
const { signIn } = useAuth()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMessage.value = null
  try {
    await signIn(event.data.email, event.data.password)
    await navigateTo(safeRedirect(route.query.redirect))
  }
  catch (err) {
    errorMessage.value = err instanceof AuthFailure ? err.message : 'Đăng nhập thất bại, vui lòng thử lại'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
    <h1 class="text-2xl font-semibold">Đăng nhập</h1>
    <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
    <UForm :schema="schema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
      <UFormField label="Email" name="email">
        <UInput v-model="state.email" type="email" autocomplete="email" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Mật khẩu" name="password">
        <UInput v-model="state.password" type="password" autocomplete="current-password" size="xl" class="w-full" />
      </UFormField>
      <UButton type="submit" size="xl" block :loading="loading">Đăng nhập</UButton>
    </UForm>
    <p class="text-sm text-muted">
      Chưa có tài khoản?
      <ULink to="/signup" class="font-medium text-primary">Đăng ký</ULink>
    </p>
  </main>
</template>
```

- [ ] **Step 4: `app/pages/signup.vue`**

```vue
<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { z } from 'zod'

useHead({ title: 'Tạo tài khoản — ZENO' })

const schema = z.object({
  name: z.string().trim().min(2, 'Cần ít nhất 2 ký tự').max(80),
  email: z.email('Email không hợp lệ'),
  password: z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự'),
})
type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ name: '', email: '', password: '' })
const errorMessage = ref<string | null>(null)
const loading = ref(false)
const { signUp } = useAuth()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  errorMessage.value = null
  try {
    await signUp(event.data.name, event.data.email, event.data.password)
    await navigateTo('/onboarding')
  }
  catch (err) {
    errorMessage.value = err instanceof AuthFailure ? err.message : 'Đăng ký thất bại, vui lòng thử lại'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
    <h1 class="text-2xl font-semibold">Tạo tài khoản chủ quán</h1>
    <UAlert v-if="errorMessage" color="error" variant="subtle" :title="errorMessage" />
    <UForm :schema="schema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
      <UFormField label="Tên của bạn" name="name">
        <UInput v-model="state.name" autocomplete="name" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Email" name="email">
        <UInput v-model="state.email" type="email" autocomplete="email" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Mật khẩu" name="password" hint="Ít nhất 8 ký tự">
        <UInput v-model="state.password" type="password" autocomplete="new-password" size="xl" class="w-full" />
      </UFormField>
      <UButton type="submit" size="xl" block :loading="loading">Tạo tài khoản</UButton>
    </UForm>
    <p class="text-sm text-muted">
      Đã có tài khoản?
      <ULink to="/login" class="font-medium text-primary">Đăng nhập</ULink>
    </p>
  </main>
</template>
```

- [ ] **Step 5: `app/pages/onboarding.vue`**

```vue
<script setup lang="ts">
import type { Form, FormSubmitEvent } from '@nuxt/ui'
import { onboardingInputSchema, slugify, type OnboardingInput } from '#shared/schemas/identity'

definePageMeta({ middleware: ['auth'] })
useHead({ title: 'Tạo cửa hàng — ZENO' })

const { load } = useMe()
const existing = await load()
if (existing.stores.length > 0) await navigateTo('/app/orders', { replace: true })

const config = useRuntimeConfig()
const api = useApi()
const toast = useToast()
const form = useTemplateRef<Form<OnboardingInput>>('form')

const state = reactive<Partial<OnboardingInput>>({ orgName: '', storeName: '', storeSlug: '' })
const slugTouched = ref(false)
const loading = ref(false)

watch(() => state.storeName, (name) => {
  if (!slugTouched.value) state.storeSlug = slugify(name ?? '')
})

const previewUrl = computed(() => `${config.public.appBaseUrl}/s/${state.storeSlug || '...'}`)

async function onSubmit(event: FormSubmitEvent<OnboardingInput>) {
  loading.value = true
  try {
    await api('/api/organizations', { method: 'POST', body: event.data })
    await load(true)
    await navigateTo('/app/orders')
  }
  catch (err) {
    const apiError = extractApiError(err)
    if (apiError.code === 'SLUG_TAKEN') {
      form.value?.setErrors([{ name: 'storeSlug', message: apiError.message }])
    }
    else if (apiError.code === 'ORG_EXISTS') {
      await load(true)
      await navigateTo('/app/orders')
    }
    else {
      toast.add({ color: 'error', title: apiError.message })
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 p-6">
    <div>
      <h1 class="text-2xl font-semibold">Tạo cửa hàng đầu tiên</h1>
      <p class="mt-1 text-sm text-muted">Bạn có thể thêm món, bàn và thanh toán ở bước sau.</p>
    </div>
    <UForm ref="form" :schema="onboardingInputSchema" :state="state" class="flex flex-col gap-4" @submit="onSubmit">
      <UFormField label="Tên doanh nghiệp" name="orgName" hint="Ví dụ: tên chủ quán hoặc chuỗi">
        <UInput v-model="state.orgName" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Tên cửa hàng" name="storeName">
        <UInput v-model="state.storeName" size="xl" class="w-full" />
      </UFormField>
      <UFormField label="Đường dẫn cửa hàng" name="storeSlug" :help="previewUrl">
        <UInput v-model="state.storeSlug" size="xl" class="w-full" autocapitalize="off" @input="slugTouched = true" />
      </UFormField>
      <UButton type="submit" size="xl" block :loading="loading">Tạo cửa hàng</UButton>
    </UForm>
  </main>
</template>
```

- [ ] **Step 6: Trang owner**

`app/pages/app/index.vue`:

```vue
<script setup lang="ts">
definePageMeta({
  middleware: ['auth', 'has-store', () => navigateTo('/app/orders', { replace: true })],
})
</script>

<template>
  <div />
</template>
```

`app/pages/app/orders.vue`:

```vue
<script setup lang="ts">
definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Đơn hàng — ZENO' })
</script>

<template>
  <section class="flex flex-col items-center gap-3 py-16 text-center">
    <UIcon name="i-lucide-receipt" class="size-10 text-muted" />
    <h1 class="text-lg font-semibold">Chưa có đơn hàng nào</h1>
    <p class="max-w-xs text-sm text-muted">Khi khách đặt món, đơn sẽ hiện ở đây.</p>
  </section>
</template>
```

`app/pages/app/settings.vue`:

```vue
<script setup lang="ts">
import type { StoreDetail } from '#shared/types/identity'

definePageMeta({ layout: 'owner', middleware: ['auth', 'has-store'] })
useHead({ title: 'Cài đặt — ZENO' })

const api = useApi()
const toast = useToast()
const config = useRuntimeConfig()
const { activeStore } = useActiveStore()
const { load } = useMe()

const { data: store, status, refresh } = await useAsyncData(
  'store-settings',
  () => api<StoreDetail>(`/api/stores/${activeStore.value!.id}`),
  { watch: [() => activeStore.value?.id] },
)

const draft = reactive({ name: '', isAcceptingOrders: false })
watch(store, (value) => {
  if (value) Object.assign(draft, { name: value.name, isAcceptingOrders: value.isAcceptingOrders })
}, { immediate: true })

const isOwner = computed(() => store.value?.role === 'OWNER')
const saving = ref(false)
const publicUrl = computed(() => (store.value ? `${config.public.appBaseUrl}/s/${store.value.slug}` : ''))

async function save() {
  if (!store.value) return
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
  <section class="flex flex-col gap-6">
    <h1 class="text-xl font-semibold">Cài đặt cửa hàng</h1>

    <USkeleton v-if="status === 'pending'" class="h-40 w-full" />
    <UAlert v-else-if="status === 'error'" color="error" variant="subtle" title="Không tải được cài đặt" />

    <template v-else-if="store">
      <UFormField label="Tên cửa hàng" name="name">
        <UInput v-model="draft.name" :disabled="!isOwner" size="xl" class="w-full" />
      </UFormField>

      <USwitch v-model="draft.isAcceptingOrders" :disabled="!isOwner" label="Đang nhận đơn" description="Tắt khi quán tạm nghỉ; khách vẫn xem được menu." />

      <UFormField label="Link đặt món">
        <UInput :model-value="publicUrl" readonly size="xl" class="w-full" />
      </UFormField>

      <UButton v-if="isOwner" size="xl" block :loading="saving" @click="save">Lưu thay đổi</UButton>
      <p v-else class="text-sm text-muted">Chỉ chủ cửa hàng mới thay đổi được cài đặt.</p>
    </template>
  </section>
</template>
```

- [ ] **Step 7: Chạy E2E**

Run: `npm run test:e2e -- tests/e2e/onboarding.spec.ts`
Expected: PASS trên cả `mobile-chrome` và `mobile-safari`.

**Nếu và chỉ nếu** `mobile-safari` fail ở bước `page.reload()` (mất phiên vì Safari chặn cookie bên thứ ba của domain Neon Auth): chuyển sang proxy cùng origin.

`server/routes/api/auth/[...path].ts`:

```ts
import { defineEventHandler, proxyRequest } from 'h3'
import { requireEnv } from '../../../utils/env'

export default defineEventHandler((event) => {
  const base = requireEnv('NEON_AUTH_BASE_URL').replace(/\/+$/, '')
  const path = event.path.replace(/^\/api\/auth/, '')
  return proxyRequest(event, `${base}${path}`, {
    cookieDomainRewrite: { '*': '' },
    cookiePathRewrite: { '*': '/' },
  })
})
```

và trong `nuxt.config.ts` đổi `neonAuthUrl` thành `` `${process.env.APP_BASE_URL ?? 'http://localhost:3000'}/api/auth` ``. Chạy lại E2E cả hai project; ghi quyết định vào PR description. (Không làm bước này nếu E2E đã xanh.)

- [ ] **Step 8: Cập nhật spec §9 (error codes)**

Trong `docs/superpowers/specs/2026-10-31-zeno-mini-order-v1-design.md` §9, thay dòng error codes bằng:

```markdown
`VALIDATION_FAILED` 400 · `UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `STATUS_CONFLICT`, `CART_STALE`, `SLUG_TAKEN`, `ORG_EXISTS` 409 · `STORE_CLOSED`, `MODE_DISABLED`, `INVALID_TABLE`, `INVALID_ZONE`, `PAYMENT_METHOD_UNAVAILABLE` 422 · `RATE_LIMITED` 429 · `INTERNAL` 500 · `SERVICE_UNAVAILABLE` 503.
```

- [ ] **Step 9: Chạy toàn bộ và commit**

Run: `npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run test:api && npm run test:e2e && npm run build`
Expected: tất cả PASS.

```bash
git add app tests/e2e docs/superpowers/specs server/routes nuxt.config.ts
git commit -m "feat(core): add sign-up, login, onboarding and owner shell

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## PR1 Exit Checklist (PRD Phase 1 exit)

- [ ] `tests/api/tenant-isolation.test.ts` xanh: Owner A không truy cập dữ liệu Owner B qua API, kể cả đoán đúng ID.
- [ ] Đăng ký → onboarding → settings → reload → đăng xuất chạy trên Chrome và Safari mobile.
- [ ] Không có secret trong `runtimeConfig.public` (`grep -n "public" nuxt.config.ts` chỉ có `neonAuthUrl`, `appBaseUrl`).
- [ ] Trusted domain production đã thêm trước khi deploy: `neon neon-auth domain add https://<domain-production>`.
- [ ] CI xanh trên PR `feat(core)`.



