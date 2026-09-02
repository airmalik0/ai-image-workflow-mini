/**
 * Настоящий baseline-JPEG 8×8, 794 байта: снят `sips` с нарисованного кодом PNG
 * и вложен сюда base64. Кодировщика JPEG в Node нет, а тест загрузки обязан
 * работать на настоящем формате: подсунуть шуму заголовок `FF D8 FF` — значит
 * проверить не загрузку изображения, а собственную доверчивость.
 */
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKAC' +
  'AAQAAAABAAAACKADAAQAAAABAAAACAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZ' +
  'jwCyBOmACZjs+EJ+/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIB' +
  'AwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNE' +
  'RUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfI' +
  'ycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIB' +
  'AgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpD' +
  'REVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMADw8PDw8PGg8PGiQaGhokMSQkJCQxPjExMTExPks+Pj4+Pj5L' +
  'S0tLS0tLS1paWlpaWmlpaWlpdnZ2dnZ2dnZ2dv/bAEMBEhMTHhweNBwcNHtURVR7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7' +
  'e3t7e3t7e3t7e3t7e3t7e3t7e3t7e3t7e//dAAQAAf/aAAwDAQACEQMRAD8Ar2ekdOK0v7I9q0bPtWlWFTET5tx4PFVPZLU/' +
  '/9k='

export const TINY_JPEG: Uint8Array = new Uint8Array(Buffer.from(TINY_JPEG_BASE64, 'base64'))

/**
 * JPEG заданного размера. Добивка идёт сегментами COM (`FF FE`) сразу после SOI:
 * это штатная часть формата, декодер её пропускает, и файл остаётся настоящей
 * картинкой — в отличие от «шум с приклеенным заголовком».
 *
 * Данные добивки псевдослучайны и детерминированы: тест сравнивает выгруженные
 * байты с загруженными, и второй прогон обязан дать тот же файл.
 */
export function buildJpeg(sizeBytes: number): Uint8Array {
  if (sizeBytes < TINY_JPEG.length) throw new Error('Размер меньше минимального JPEG')

  const chunks: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)]
  let size = TINY_JPEG.length
  let seed = 1

  while (size < sizeBytes) {
    // длина сегмента COM включает сами два байта длины и не превышает 65535
    const segment = Math.min(65533, sizeBytes - size - 2)
    if (segment < 4) break
    const payload = new Uint8Array(segment - 2)
    for (let i = 0; i < payload.length; i += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      payload[i] = (seed >>> 16) & 0xff
    }
    const header = new Uint8Array(4)
    header[0] = 0xff
    header[1] = 0xfe
    header[2] = (segment >> 8) & 0xff
    header[3] = segment & 0xff
    chunks.push(header, payload)
    size += segment + 2
  }

  chunks.push(TINY_JPEG.subarray(2))

  const result = new Uint8Array(chunks.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of chunks) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
