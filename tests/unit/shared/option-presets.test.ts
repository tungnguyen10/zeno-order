import { describe, expect, it } from 'vitest'
import { buildOptionsPayload, presetOf, rulesOf, toEditableGroups, type EditableGroup } from '#shared/option-presets'
import { replaceOptionsInputSchema } from '#shared/schemas/catalog'
import type { OptionGroupDTO } from '#shared/types/catalog'

let counter = 0
const makeKey = () => `k${++counter}`

const group = (overrides: Partial<EditableGroup> = {}): EditableGroup => ({
  key: 'g',
  name: 'Size',
  preset: 'single-required',
  values: [
    { key: 'v1', name: 'M', priceRaw: '', active: true },
    { key: 'v2', name: 'L', priceRaw: '5k', active: true },
  ],
  ...overrides,
})

describe('presets', () => {
  it('maps a group to its preset and back to rules', () => {
    expect(presetOf({ required: true, maxSelect: 1 })).toBe('single-required')
    expect(presetOf({ required: false, maxSelect: 1 })).toBe('single-optional')
    expect(presetOf({ required: false, maxSelect: 3 })).toBe('multi')
    expect(rulesOf('single-required', 3)).toEqual({ required: true, minSelect: 1, maxSelect: 1 })
    expect(rulesOf('single-optional', 3)).toEqual({ required: false, minSelect: 0, maxSelect: 1 })
    expect(rulesOf('multi', 4)).toEqual({ required: false, minSelect: 0, maxSelect: 4 })
    expect(rulesOf('multi', 1)).toEqual({ required: false, minSelect: 0, maxSelect: 2 })
  })
})

describe('toEditableGroups', () => {
  it('turns server groups into editable rows with price text', () => {
    const dto: OptionGroupDTO[] = [{
      id: 'g1', name: 'Topping', required: false, minSelect: 0, maxSelect: 2, position: 0,
      values: [{ id: 'v1', name: 'Trân châu', priceDeltaVnd: 5000, active: true, position: 0 }, { id: 'v2', name: 'Thạch', priceDeltaVnd: 0, active: false, position: 1 }],
    }]
    const [editable] = toEditableGroups(dto, makeKey)
    expect(editable).toMatchObject({ name: 'Topping', preset: 'multi' })
    expect(editable!.values.map(v => [v.name, v.priceRaw, v.active])).toEqual([['Trân châu', '5000', true], ['Thạch', '', false]])
  })
})

describe('buildOptionsPayload', () => {
  it('builds a payload the API schema accepts', () => {
    const result = buildOptionsPayload([group(), group({ name: 'Topping', preset: 'multi', values: [{ key: 'a', name: 'Trân châu', priceRaw: '5.000', active: true }, { key: 'b', name: 'Thạch', priceRaw: '3k', active: true }, { key: 'c', name: 'Pudding', priceRaw: '7k', active: true }] })])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.groups[0]).toEqual({
      name: 'Size', required: true, minSelect: 1, maxSelect: 1,
      values: [{ name: 'M', priceDeltaVnd: 0, active: true }, { name: 'L', priceDeltaVnd: 5000, active: true }],
    })
    expect(result.groups[1]).toMatchObject({ required: false, minSelect: 0, maxSelect: 3 })
    expect(replaceOptionsInputSchema.safeParse({ groups: result.groups }).success).toBe(true)
  })

  it('drops blank value rows and trims names', () => {
    const result = buildOptionsPayload([group({ name: '  Size ', values: [{ key: 'a', name: ' M ', priceRaw: '', active: true }, { key: 'b', name: '   ', priceRaw: '9k', active: true }] })])
    expect(result).toMatchObject({ ok: true, groups: [{ name: 'Size', values: [{ name: 'M', priceDeltaVnd: 0, active: true }] }] })
  })

  it('reports a missing group name, no values, a bad price and a required group with nothing active', () => {
    expect(buildOptionsPayload([group({ name: ' ' })])).toEqual({ ok: false, error: 'Nhóm option cần có tên' })
    expect(buildOptionsPayload([group({ values: [{ key: 'a', name: ' ', priceRaw: '', active: true }] })]))
      .toEqual({ ok: false, error: 'Nhóm "Size" cần ít nhất một lựa chọn' })
    expect(buildOptionsPayload([group({ values: [{ key: 'a', name: 'M', priceRaw: 'abc', active: true }] })]))
      .toEqual({ ok: false, error: 'Giá cộng thêm của "M" không hợp lệ' })
    expect(buildOptionsPayload([group({ values: [{ key: 'a', name: 'M', priceRaw: '', active: false }] })]))
      .toEqual({ ok: false, error: 'Nhóm "Size" cần ít nhất một lựa chọn đang bật' })
  })

  it('an empty editor list is a valid payload that clears every option', () => {
    expect(buildOptionsPayload([])).toEqual({ ok: true, groups: [] })
  })

  it('round-trips a server group without changing its rules', () => {
    const dto: OptionGroupDTO = {
      id: 'g', name: 'Đường', required: true, minSelect: 1, maxSelect: 1, position: 0,
      values: [{ id: 'a', name: '100%', priceDeltaVnd: 0, active: true, position: 0 }, { id: 'b', name: '50%', priceDeltaVnd: 0, active: true, position: 1 }],
    }
    const result = buildOptionsPayload(toEditableGroups([dto], makeKey))
    expect(result).toMatchObject({ ok: true, groups: [{ name: 'Đường', required: true, minSelect: 1, maxSelect: 1 }] })
  })

  it('preserves required multi-select and nonzero optional minimums when editing values', () => {
    const dto: OptionGroupDTO[] = [
      { id: 'required', name: 'Toppings', required: true, minSelect: 2, maxSelect: 3, position: 0, values: [
        { id: 'a', name: 'A', priceDeltaVnd: 0, active: true, position: 0 },
        { id: 'b', name: 'B', priceDeltaVnd: 0, active: true, position: 1 },
        { id: 'c', name: 'C', priceDeltaVnd: 0, active: true, position: 2 },
      ] },
      { id: 'minimum', name: 'Sauce', required: false, minSelect: 1, maxSelect: 2, position: 1, values: [
        { id: 'd', name: 'D', priceDeltaVnd: 0, active: true, position: 0 },
        { id: 'e', name: 'E', priceDeltaVnd: 0, active: true, position: 1 },
      ] },
    ]
    const editable = toEditableGroups(dto, makeKey)
    editable[0]!.values[0]!.name = 'A new name'
    const result = buildOptionsPayload(editable)
    expect(result).toMatchObject({ ok: true, groups: [
      { required: true, minSelect: 2, maxSelect: 3 },
      { required: false, minSelect: 1, maxSelect: 2 },
    ] })
    editable[0]!.preset = 'single-optional'
    const changed = buildOptionsPayload(editable)
    expect(changed.ok).toBe(true)
    if (changed.ok) expect(changed.groups[0]).toMatchObject({ required: false, minSelect: 0, maxSelect: 1 })
    editable[0]!.preset = 'multi'
    editable[0]!.presetChanged = true
    const reset = buildOptionsPayload(editable)
    expect(reset.ok).toBe(true)
    if (reset.ok) expect(reset.groups[0]).toMatchObject({ required: false, minSelect: 0, maxSelect: 3 })
  })

  it('rejects option limits before sending to the API', () => {
    expect(buildOptionsPayload(Array.from({ length: 11 }, (_, i) => group({ key: `g${i}`, name: `Group ${i}` }))))
      .toMatchObject({ ok: false })
    expect(buildOptionsPayload([group({ values: Array.from({ length: 31 }, (_, i) => ({ key: `v${i}`, name: `Value ${i}`, priceRaw: '', active: true })) })]))
      .toMatchObject({ ok: false })
    expect(buildOptionsPayload([group({ name: 'x'.repeat(61) })])).toMatchObject({ ok: false })
    expect(buildOptionsPayload([group({ values: [{ key: 'v', name: 'x'.repeat(61), priceRaw: '', active: true }] })]))
      .toMatchObject({ ok: false })
  })
})
