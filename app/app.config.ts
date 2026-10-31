// Mobile touch targets: lg/xl controls are at least 44px tall (min-h-11).
const touchTarget = { lg: { base: 'min-h-11' }, xl: { base: 'min-h-11' } }

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'stone',
    },
    button: { variants: { size: touchTarget } },
    input: { variants: { size: touchTarget } },
    select: { variants: { size: touchTarget } },
  },
})
