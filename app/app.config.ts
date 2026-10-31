// Mobile touch targets: lg/xl controls are at least 44px tall (min-h-11).
const touchTarget = { lg: { base: 'min-h-11' }, xl: { base: 'min-h-11' } }
// Switch: the label row is 44px tall and an invisible ::before pad grows the toggle's own hit area to ≥44px.
const switchTouchTarget = {
  root: 'min-h-11 items-center',
  base: "relative before:absolute before:-inset-4 before:content-['']",
  label: 'flex min-h-11 items-center',
}

export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'stone',
    },
    button: { variants: { size: touchTarget } },
    input: { variants: { size: touchTarget } },
    select: { variants: { size: touchTarget } },
    switch: { variants: { size: { lg: switchTouchTarget, xl: switchTouchTarget } } },
  },
})
