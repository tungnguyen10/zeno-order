import { z } from 'zod'
import { hasChange, nameField, NO_CHANGE, positionSchema, vndSchema } from './common'

export const updateFulfillmentInputSchema = z.object({
  dineInEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
}).refine(hasChange, NO_CHANGE)
export type UpdateFulfillmentInput = z.output<typeof updateFulfillmentInputSchema>

export const createZoneInputSchema = z.object({ name: nameField(60), feeVnd: vndSchema })
export type CreateZoneInput = z.output<typeof createZoneInputSchema>

export const updateZoneInputSchema = z.object({
  name: nameField(60).optional(),
  feeVnd: vndSchema.optional(),
  active: z.boolean().optional(),
  position: positionSchema.optional(),
}).refine(hasChange, NO_CHANGE)
export type UpdateZoneInput = z.output<typeof updateZoneInputSchema>
