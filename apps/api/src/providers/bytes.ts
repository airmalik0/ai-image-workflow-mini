/** Base64 из ответа провайдера → байты. Вид без копирования: картинки весят мегабайты. */
export function decodeBase64(data: string): Uint8Array {
  const buffer = Buffer.from(data, 'base64')
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

export function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}

/**
 * Тип картинки по сигнатуре файла.
 *
 * Нужен там, где провайдер его не называет: OpenAI отдаёт голый `b64_json`
 * без mime, а формат зависит от модели и параметров (`gpt-image-2` — PNG,
 * с `output_format` — JPEG или WebP). Записать в хранилище неверный mimeType —
 * значит отдать браузеру картинку, которую он не покажет.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp'
  return null
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}
