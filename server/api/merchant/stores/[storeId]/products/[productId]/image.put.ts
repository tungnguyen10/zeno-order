import { defineEventHandler } from 'h3'
import { createProductImagePutHandler, productImageHandlerDeps } from '../../../../../../utils/product-image-http'

export default defineEventHandler(createProductImagePutHandler(productImageHandlerDeps))
