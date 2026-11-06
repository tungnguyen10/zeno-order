import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  functions: {
    "paymentjobs": {
      name: "Payment reconciliation and expiry",
      source: "functions/payment-jobs.ts",
      env: {
        SEPAY_RECONCILE_MAX_WINDOW_HOURS: process.env.SEPAY_RECONCILE_MAX_WINDOW_HOURS ?? "48",
        PAYMENT_JOBS_ENABLED: process.env.PAYMENT_JOBS_ENABLED ?? "false",
        ...(process.env.APP_ENCRYPTION_KEY ? { APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY } : {}),
        ...(process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS ? { SEPAY_VERIFIED_DEDUPE_INTEGRATIONS: process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS } : {}),
      },
    },
  },
  triggers: {
    "payment-expiry": { type: "schedule", function: "paymentjobs", functionPath: "/expire", cron: "*/5 * * * *", enabled: process.env.PAYMENT_JOBS_ENABLED === "true" },
    "payment-reconcile": { type: "schedule", function: "paymentjobs", functionPath: "/reconcile", cron: "*/15 * * * *", enabled: process.env.PAYMENT_JOBS_ENABLED === "true" },
  },
  buckets: {
    assets: { access: "private" },
    "product-images": { access: "public_read" },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
