import { fileUploadResponseSchema } from '@workflow/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ACCEPTED_MIME_TYPES, sniffImageType } from '../files/sniff.js'
import { ApiError, errorResponses } from '../http/errors.js'

/** Год кэша: идентификатор — хеш содержимого, значит файл по нему не меняется никогда. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

export const fileRoutes: FastifyPluginAsyncZod = (app) => {
  app.route({
    method: 'POST',
    url: '/files',
    schema: {
      tags: ['files'],
      summary: 'Загрузить изображение',
      description:
        'multipart/form-data, поле «file». Не base64 в JSON: base64 распухает на треть ' +
        'и упирается в лимит тела, из-за чего обычная фотография с телефона не загружается. ' +
        `Принимаются ${ACCEPTED_MIME_TYPES.join(', ')}; предел размера — MAX_UPLOAD_BYTES.`,
      consumes: ['multipart/form-data'],
      response: { 201: fileUploadResponseSchema, ...errorResponses(400, 413, 415) },
    },
    handler: async (request, reply) => {
      if (!request.isMultipart()) {
        throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Ожидается multipart/form-data с полем «file»')
      }

      const part = await request.file()
      if (part === undefined) {
        throw new ApiError('BAD_REQUEST', 'В запросе нет файла: ожидается поле «file»')
      }

      // toBuffer уважает limits.fileSize и бросает FST_REQ_FILE_TOO_LARGE (413):
      // ошибка приходит нам, а не обрывом соединения на клиенте
      const bytes = new Uint8Array(await part.toBuffer())

      const mimeType = sniffImageType(bytes)
      if (mimeType === null) {
        throw new ApiError(
          'UNSUPPORTED_MEDIA_TYPE',
          `Файл не опознан как изображение. Принимаются: ${ACCEPTED_MIME_TYPES.join(', ')}`,
        )
      }

      const fileId = await app.deps.files.put(bytes, mimeType)
      // хранилище адресуется содержимым, поэтому повторная загрузка даёт тот же id;
      // запись метаданных идемпотентна и дублей не плодит
      await app.deps.fileCatalog.record({
        id: fileId,
        mimeType,
        sizeBytes: bytes.length,
        source: 'upload',
      })

      request.log.info({ fileId, sizeBytes: bytes.length, mimeType }, 'изображение загружено')

      return reply.code(201).send({ fileId, url: app.deps.files.url(fileId) })
    },
  })

  app.route({
    method: 'GET',
    url: '/files/:id',
    schema: {
      tags: ['files'],
      summary: 'Отдать изображение',
      // идентификатор проверяет само хранилище: у fs-адаптера это фиксированный
      // алфавит хеша, и «../» отсекается там же, а не эвристикой в роуте
      description:
        'Тело ответа — байты изображения. Файл адресуется хешем содержимого, поэтому ' +
        'отдаётся с годовым immutable-кэшем. Неизвестный идентификатор — 404 FILE_NOT_FOUND ' +
        'в общем конверте ошибки.',
      params: z.object({ id: z.string().min(1).max(200) }),
      // ответ — байты картинки, а не JSON: схемой его не описать, зато `produces`
      // говорит документации правду. Buffer Fastify отдаёт минуя сериализатор,
      // поэтому `z.unknown()` здесь не потеря типизации, а её отсутствие по существу
      produces: [...ACCEPTED_MIME_TYPES],
      response: { 200: z.unknown() },
    },
    handler: async (request, reply) => {
      const file = await app.deps.files.get(request.params.id)
      return reply
        .header('content-type', file.mimeType)
        .header('cache-control', IMMUTABLE_CACHE)
        .send(Buffer.from(file.bytes))
    },
  })

  return Promise.resolve()
}
