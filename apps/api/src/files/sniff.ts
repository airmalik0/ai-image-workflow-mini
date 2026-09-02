/**
 * Типы, которые принимает загрузка. Список совпадает с тем, что понимают оба
 * провайдера: PNG, JPEG и WebP. GIF и HEIC приняты не будут — лучше отказать
 * на загрузке, чем показать ошибку провайдера через полминуты генерации.
 */
export const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number]

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

/**
 * Тип содержимого по сигнатуре, а не по заголовку части формы: `Content-Type`
 * присылает клиент, и доверять ему — значит хранить исполняемый файл под именем
 * картинки. `null` — формат не опознан, загрузка отклоняется.
 */
export function sniffImageType(bytes: Uint8Array): AcceptedMimeType | null {
  if (startsWith(bytes, PNG)) return 'image/png'
  if (startsWith(bytes, JPEG)) return 'image/jpeg'
  // WebP: RIFF....WEBP, четыре байта размера между сигнатурами
  if (startsWith(bytes, RIFF) && startsWith(bytes.subarray(8), WEBP)) return 'image/webp'
  return null
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false
  return signature.every((byte, index) => bytes[index] === byte)
}
