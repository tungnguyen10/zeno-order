import { sendWebResponse, toWebRequest } from 'h3'
import { defineApiHandler } from '../../../utils/api-handler'
import { proxyAuth } from '../../../utils/auth-proxy'

export default defineApiHandler(async event => sendWebResponse(event, await proxyAuth(toWebRequest(event), 'sign-up/email')))
