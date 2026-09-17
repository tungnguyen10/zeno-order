import { defineEventHandler } from 'h3'
import { createProductImageDeleteHandler, productImageHandlerDeps } from '../../../../../../utils/product-image-http'

export default defineEventHandler(createProductImageDeleteHandler(productImageHandlerDeps))
