import { defineConfig } from '@neon/config/v1'

if (process.env.GITHUB_ACTIONS !== 'true' || !/^ci-\d+-[a-z0-9-]+$/.test(process.env.CI_BRANCH ?? '')) throw new Error('CI policy requires an explicit ephemeral Actions branch')

// Deliberately excludes Functions/triggers and production tuning.
export default defineConfig({
  auth: true,
  buckets: { assets: { access: 'private' }, 'product-images': { access: 'public_read' } },
  branch: (branch) => {
    if (branch.isDefault) throw new Error('CI policy refuses the default branch')
    return {}
  },
})
