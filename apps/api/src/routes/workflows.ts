import {
  saveWorkflowRequestSchema,
  validateGraphRequestSchema,
  validateGraphResponseSchema,
  workflowSchema,
} from '@workflow/contracts'
import { validateGraph } from '@workflow/core'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ApiError, errorResponses } from '../http/errors.js'

const idParams = z.object({ id: z.string().min(1) })

export const workflowRoutes: FastifyPluginAsyncZod = (app) => {
  app.route({
    method: 'GET',
    url: '/workflows',
    schema: {
      tags: ['workflows'],
      summary: 'Сохранённые графы',
      response: { 200: z.array(workflowSchema) },
    },
    handler: () => app.deps.workflows.list(),
  })

  app.route({
    method: 'POST',
    url: '/workflows',
    schema: {
      tags: ['workflows'],
      summary: 'Сохранить граф',
      body: saveWorkflowRequestSchema,
      response: { 201: workflowSchema, ...errorResponses(400) },
    },
    handler: async (request, reply) => {
      const workflow = await app.deps.workflows.create(request.body)
      return reply.code(201).send(workflow)
    },
  })

  /**
   * Валидация без сохранения. Отдельным маршрутом до `/:id`, иначе роутер
   * принял бы «validate» за идентификатор.
   *
   * Ответ — всегда 200 с отчётом `{ errors, warnings }`, даже когда ошибок полно:
   * запрос выполнен, а его результат — список проблем. Код `GRAPH_INVALID`
   * в конверте ошибки появляется там, где граф действительно мешает работать, —
   * при попытке запустить его.
   */
  app.route({
    method: 'POST',
    url: '/workflows/validate',
    schema: {
      tags: ['workflows'],
      summary: 'Проверить граф, ничего не сохраняя',
      body: validateGraphRequestSchema,
      response: { 200: validateGraphResponseSchema, ...errorResponses(400) },
    },
    handler: (request) => Promise.resolve(validateGraph(request.body.graph)),
  })

  app.route({
    method: 'GET',
    url: '/workflows/:id',
    schema: {
      tags: ['workflows'],
      summary: 'Граф по идентификатору',
      params: idParams,
      response: { 200: workflowSchema, ...errorResponses(404) },
    },
    handler: async (request) => {
      const workflow = await app.deps.workflows.findById(request.params.id)
      if (!workflow) throw missing(request.params.id)
      return workflow
    },
  })

  app.route({
    method: 'PUT',
    url: '/workflows/:id',
    schema: {
      tags: ['workflows'],
      summary: 'Заменить граф',
      params: idParams,
      body: saveWorkflowRequestSchema,
      response: { 200: workflowSchema, ...errorResponses(400, 404) },
    },
    handler: async (request) => {
      // PUT, а не PATCH: граф — единая структура, и частичное обновление ноды
      // без её ребра оставило бы в базе заведомо несогласованный граф.
      // Сохраняется и невалидный граф: редактор не обязан быть валидным
      // на каждом промежуточном шаге, а проверка живёт в /workflows/validate.
      const workflow = await app.deps.workflows.update(request.params.id, request.body)
      if (!workflow) throw missing(request.params.id)
      return workflow
    },
  })

  app.route({
    method: 'DELETE',
    url: '/workflows/:id',
    schema: {
      tags: ['workflows'],
      summary: 'Удалить граф',
      params: idParams,
      // 204 описан `z.null()`: тело Fastify для него всё равно не отправляет,
      // а без объявления статуса он не попадёт в документацию
      response: { 204: z.null(), ...errorResponses(404) },
    },
    handler: async (request, reply) => {
      const removed = await app.deps.workflows.remove(request.params.id)
      if (!removed) throw missing(request.params.id)
      return reply.code(204).send(null)
    },
  })

  return Promise.resolve()
}

function missing(id: string): ApiError {
  return new ApiError('WORKFLOW_NOT_FOUND', `Граф «${id}» не найден`)
}
