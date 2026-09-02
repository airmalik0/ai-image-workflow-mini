import {
  createPresetRequestSchema,
  presetSchema,
  updatePresetRequestSchema,
} from '@workflow/contracts'
import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ApiError, errorResponses } from '../http/errors.js'

const idParams = z.object({ id: z.string().min(1) })

/**
 * Пресеты — отдельная сущность, как требует ТЗ: нода хранит только `presetId`,
 * а не копию промпта. Поэтому правка пресета меняет поведение всех нод, которые
 * на него ссылаются, — ровно этого от пресета и ждут.
 */
export const presetRoutes: FastifyPluginAsyncZod = (app) => {
  app.route({
    method: 'GET',
    url: '/presets',
    schema: {
      tags: ['presets'],
      summary: 'Список пресетов',
      response: { 200: z.array(presetSchema) },
    },
    handler: () => app.deps.presets.list(),
  })

  app.route({
    method: 'POST',
    url: '/presets',
    schema: {
      tags: ['presets'],
      summary: 'Создать пресет',
      body: createPresetRequestSchema,
      response: { 201: presetSchema, ...errorResponses(400) },
    },
    handler: async (request, reply) => {
      const preset = await app.deps.presets.create(request.body)
      return reply.code(201).send(preset)
    },
  })

  app.route({
    method: 'GET',
    url: '/presets/:id',
    schema: {
      tags: ['presets'],
      summary: 'Пресет по идентификатору',
      params: idParams,
      response: { 200: presetSchema, ...errorResponses(404) },
    },
    handler: async (request) => {
      const preset = await app.deps.presets.findById(request.params.id)
      if (!preset) throw missing(request.params.id)
      return preset
    },
  })

  app.route({
    method: 'PATCH',
    url: '/presets/:id',
    schema: {
      tags: ['presets'],
      summary: 'Изменить пресет',
      params: idParams,
      body: updatePresetRequestSchema,
      response: { 200: presetSchema, ...errorResponses(400, 404) },
    },
    handler: async (request) => {
      // PATCH, а не PUT: `negativePrompt: null` обязан отличаться от «поле не передано»,
      // иначе форма инспектора, отправляющая одно поле, затирает остальные
      const preset = await app.deps.presets.update(request.params.id, request.body)
      if (!preset) throw missing(request.params.id)
      return preset
    },
  })

  app.route({
    method: 'DELETE',
    url: '/presets/:id',
    schema: {
      tags: ['presets'],
      summary: 'Удалить пресет',
      params: idParams,
      // 204 описан `z.null()`: тело Fastify для него всё равно не отправляет,
      // а без объявления статуса он не попадёт в документацию
      response: { 204: z.null(), ...errorResponses(404) },
    },
    handler: async (request, reply) => {
      const removed = await app.deps.presets.remove(request.params.id)
      if (!removed) throw missing(request.params.id)
      return reply.code(204).send(null)
    },
  })

  return Promise.resolve()
}

function missing(id: string): ApiError {
  return new ApiError('PRESET_NOT_FOUND', `Пресет «${id}» не найден`)
}
