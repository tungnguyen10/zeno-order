import { isError as isH3Error } from 'h3'
import { ZodError } from 'zod'
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '../../shared/errors'

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options)
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

const H3_STATUS_MAP: Partial<Record<number, ApiErrorBody>> = {
  400: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' },
  401: { code: 'UNAUTHENTICATED', message: 'Vui lòng đăng nhập' },
  403: { code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này' },
  404: { code: 'NOT_FOUND', message: 'Không tìm thấy' },
  405: { code: 'NOT_FOUND', message: 'Không tìm thấy' },
  413: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' },
  415: { code: 'VALIDATION_FAILED', message: 'Yêu cầu không hợp lệ' },
  429: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau' },
}

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
  if (isH3Error(err)) {
    const mapped = H3_STATUS_MAP[err.statusCode]
    if (mapped) return { status: ERROR_STATUS[mapped.code], body: { ...mapped } }
  }
  return { status: 500, body: { ...INTERNAL_BODY } }
}
