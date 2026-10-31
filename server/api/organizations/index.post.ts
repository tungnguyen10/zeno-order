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
