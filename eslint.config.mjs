import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  files: ['app/pages/**/*.vue', 'app/layouts/**/*.vue'],
  rules: {
    'vue/multi-word-component-names': 'off',
    // 'warn' until Task 9 migrates the last page; then it becomes 'error'.
    'vue/no-restricted-syntax': ['warn', {
      selector: 'VElement[rawName=/^U(Button|Input|Select|Switch|Card|Alert|Badge|FormField)$/]',
      message: 'Use the Z* primitives (app/components/z) instead of Nuxt UI components in pages and layouts.',
    }],
  },
})
