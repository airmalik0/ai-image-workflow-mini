import { randomUUID } from 'node:crypto'

export interface MultipartPart {
  name: string
  value: string | Uint8Array
  filename?: string
  contentType?: string
}

export interface MultipartRequest {
  headers: Record<string, string>
  payload: Buffer
}

/**
 * Сборка тела `multipart/form-data` руками. Пакет `form-data` ради этого не нужен:
 * формат — четыре строки разделителей, а лишняя зависимость в тестах маскирует
 * ошибки собственного разбора чужой реализацией.
 */
export function multipartRequest(parts: readonly MultipartPart[]): MultipartRequest {
  const boundary = `----aiwf${randomUUID().replaceAll('-', '')}`
  const chunks: Buffer[] = []

  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"`
    const headers = part.contentType === undefined ? '' : `Content-Type: ${part.contentType}\r\n`

    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${headers}\r\n`, 'utf8'),
      typeof part.value === 'string' ? Buffer.from(part.value, 'utf8') : Buffer.from(part.value),
      Buffer.from('\r\n', 'utf8'),
    )
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))

  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  }
}
