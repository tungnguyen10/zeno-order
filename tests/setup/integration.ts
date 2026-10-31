import { assertTestDatabase, loadEnvFileOverride } from '../support/test-env'

loadEnvFileOverride('.env.test')
assertTestDatabase()
