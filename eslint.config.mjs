import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  files: ['app/pages/**/*.vue', 'app/layouts/**/*.vue'],
  rules: {
    'vue/multi-word-component-names': 'off',
    'vue/no-restricted-syntax': ['error', {
      selector: 'VElement[rawName=/^U(Button|Input|Select|Switch|Card|Alert|Badge|FormField|Drawer|Tabs)$/]',
      message: 'Use the Z* primitives (app/components/z) instead of Nuxt UI components in pages and layouts.',
    }],
  },
}, {
  files: ['app/components/**/*.vue'],
  rules: {
    // Optional TS-typed props are intentionally undefined; defaults would only add noise.
    'vue/require-default-prop': 'off',
  },
})
