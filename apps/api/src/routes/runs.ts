import {
  createRunRequestSchema,
  createRunResponseSchema,
  runSchema,
  runStateSchema,
} from '@workflow/contracts'
import type { RunState, WorkflowGraph } from '@workflow/contracts'
import { validateGraph } from '@workflow/core'
import type { FastifyInstance } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ApiError, errorResponses } from '../http/errors.js'

/** Параметры маршрутов названы `runId` и `nodeId` — по ним же собирается контекст логов. */
const runParams = z.object({ runId: z.string().min(1) })
const nodeParams = z.object({ runId: z.string().min(1), nodeId: z.string().min(1) })

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export const runRoutes: FastifyPluginAsyncZod = (app) => {
  app.route({
    method: 'POST',
    url: '/runs',
    schema: {
      tags: ['runs'],
      summary: 'Запустить граф',
      description:
        'Принимает либо сам граф, либо идентификатор сохранённого workflow. ' +
        'Граф проверяется до создания запуска: невалидный не оставляет следов в истории.',
      body: createRunRequestSchema,
      response: { 201: createRunResponseSchema, ...errorResponses(400, 404) },
    },
    handler: async (request, reply) => {
      const { runs, workflows } = app.deps

      let graph: WorkflowGraph
      let workflowId: string | null = null
      if ('graph' in request.body) {
        graph = request.body.graph
      } else {
        const workflow = await workflows.findById(request.body.workflowId)
        if (!workflow) {
          throw new ApiError('WORKFLOW_NOT_FOUND', `Граф «${request.body.workflowId}» не найден`)
        }
        graph = workflow.graph
        workflowId = workflow.id
      }

      // валидация до создания run'а: движок граф не проверяет, а запись о запуске,
      // который заведомо не может быть исполнен, — мусор в истории
      const validation = validateGraph(graph)
      if (validation.errors.length > 0) {
        throw new ApiError('GRAPH_INVALID', 'Граф нельзя запустить: он не прошёл проверку', {
          details: validation,
        })
      }

      const run = await runs.createRun({ workflowId, graph })
      // start возвращает управление после постановки первой волны в очередь,
      // а не после её исполнения: ответ клиенту не ждёт генерации
      await app.orchestrator.start(run.id)

      const started = await runs.findRun(run.id)
      return reply.code(201).send({ runId: run.id, status: started?.status ?? run.status })
    },
  })

  app.route({
    method: 'GET',
    url: '/runs',
    schema: {
      tags: ['runs'],
      summary: 'История запусков',
      querystring: listQuery,
      response: { 200: z.array(runSchema), ...errorResponses(400) },
    },
    handler: (request) => app.deps.runs.listRuns(request.query.limit),
  })

  app.route({
    method: 'GET',
    url: '/runs/:runId',
    schema: {
      tags: ['runs'],
      summary: 'Состояние запуска целиком',
      description: 'Polling-фолбэк: то же, что приходит потоком событий, одним ответом.',
      params: runParams,
      response: { 200: runStateSchema, ...errorResponses(404) },
    },
    handler: (request) => runState(app, request.params.runId),
  })

  app.route({
    method: 'POST',
    url: '/runs/:runId/cancel',
    schema: {
      tags: ['runs'],
      summary: 'Отменить запуск',
      description:
        'Снимает из очереди ещё не начатые ноды и прерывает работающие. ' +
        'Повторная отмена завершённого запуска ничего не меняет.',
      params: runParams,
      response: { 200: runStateSchema, ...errorResponses(404) },
    },
    handler: async (request) => {
      await app.orchestrator.cancel(request.params.runId)
      return runState(app, request.params.runId)
    },
  })

  app.route({
    method: 'POST',
    url: '/runs/:runId/nodes/:nodeId/retry',
    schema: {
      tags: ['runs'],
      summary: 'Перезапустить ноду',
      description:
        'Сбрасывает ноду и её потомков в idle и запускает планировщик заново. ' +
        'Успешные предки не пересчитываются: их выходы уже сохранены.',
      params: nodeParams,
      response: { 200: runStateSchema, ...errorResponses(400, 404) },
    },
    handler: async (request) => {
      await app.orchestrator.retry(request.params.runId, request.params.nodeId)
      return runState(app, request.params.runId)
    },
  })

  return Promise.resolve()
}

async function runState(app: FastifyInstance, runId: string): Promise<RunState> {
  const run = await app.deps.runs.findRun(runId)
  if (!run) throw new ApiError('RUN_NOT_FOUND', `Запуск «${runId}» не найден`)
  return { run, jobs: await app.deps.runs.listJobs(runId) }
}
