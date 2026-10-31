import { defineApiHandler } from '../utils/api-handler'
import { AppError } from '../utils/errors'

export default defineApiHandler(() => {
  throw new AppError('NOT_FOUND', 'Không tìm thấy')
})
