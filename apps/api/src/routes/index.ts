import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { sseRoutes } from '../realtime/sse.js'
import { wsRoutes } from '../realtime/ws.js'
import { fileRoutes } from './files.js'
import { healthRoutes } from './health.js'
import { presetRoutes } from './presets.js'
import { runRoutes } from './runs.js'
import { workflowRoutes } from './workflows.js'

/** Все роуты под общим префиксом `/api`. */
export const apiRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(healthRoutes)
  await app.register(presetRoutes)
  await app.register(workflowRoutes)
  await app.register(fileRoutes)
  await app.register(runRoutes)
  await app.register(sseRoutes)
  await app.register(wsRoutes)
}
