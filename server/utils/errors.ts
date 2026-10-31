import { isError as isH3Error } from 'h3'
import { ZodError } from 'zod'
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '#shared/errors'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }

  get status(): number {
    return ERROR_STATUS[this.code]
  }
}

export function zodIssues(error: ZodError): { path: string, message: string }[] {
  return error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
}

const INTERNAL_BODY: ApiErrorBody = { code: 'INTERNAL', message: 'Đã có lỗi xảy ra, vui lòng thử lại' }

export function toApiError(err: unknown): { status: number, body: ApiErrorBody } {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { code: err.code, message: err.message }
    if (err.details !== undefined) body.details = err.details
    return { status: err.status, body }
  }
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ', details: zodIssues(err) },
    }
  }
  if (isH3Error(err) && [400, 413, 415].includes(err.statusCode)) {
    return { status: 400, body: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' } }
  }
  return { status: 500, body: { ...INTERNAL_BODY } }
}
