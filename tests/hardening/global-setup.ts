import type { TestProject } from 'vitest/node'
import { startProductionServer } from '../support/production-server'

export default async function setup(project: TestProject) {
  const server = await startProductionServer()
  project.provide('production', server.context)
  return server.stop
}
