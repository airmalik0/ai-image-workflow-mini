/**
 * Минимальный кодировщик PNG без зависимостей.
 *
 * Он здесь по одной причине: fake-провайдер обязан отдавать настоящую картинку,
 * которую откроет браузер, а ядру запрещено тянуть инфраструктуру — ни `node:zlib`,
 * ни npm-пакета взять нельзя, к тому же пакет должен оставаться изоморфным.
 * Поэтому IDAT пакуется в zlib-поток «сохранёнными» (несжатыми) блоками deflate:
 * формат от этого не страдает, картинка получается больше, а кода — сорок строк.
 */

export interface PngText {
  keyword: string
  value: string
}

export interface PngInput {
  width: number
  height: number
  /** RGB по три байта на пиксель, построчно. */
  rgb: Uint8Array
  /** Текстовые метаданные (iTXt, UTF-8) — например, промпт, по которому нарисована картинка. */
  text?: readonly PngText[]
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_STORED_BLOCK = 0xffff

export function encodePng(input: PngInput): Uint8Array {
  const { width, height, rgb } = input
  const expected = width * height * 3
  if (rgb.length !== expected) {
    throw new Error(`ожидалось ${expected} байт RGB, получено ${rgb.length}`)
  }

  const ihdr = new Uint8Array(13)
  const header = new DataView(ihdr.buffer)
  header.setUint32(0, width)
  header.setUint32(4, height)
  ihdr[8] = 8 // бит на канал
  ihdr[9] = 2 // truecolor RGB
  ihdr[10] = 0 // единственный существующий метод сжатия
  ihdr[11] = 0 // фильтрация по строкам
  ihdr[12] = 0 // без интерлейсинга

  const chunks: Uint8Array[] = [SIGNATURE, chunk('IHDR', ihdr)]
  for (const entry of input.text ?? []) chunks.push(chunk('iTXt', itxt(entry)))
  chunks.push(chunk('IDAT', zlib(scanlines(width, height, rgb))))
  chunks.push(chunk('IEND', new Uint8Array(0)))

  return concat(chunks)
}

/** Каждой строке предшествует байт фильтра; фильтр 0 — «как есть». */
function scanlines(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3
  const out = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    out[y * (stride + 1)] = 0
    out.set(rgb.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  return out
}

function itxt(entry: PngText): Uint8Array {
  const encoder = new TextEncoder()
  const keyword = encoder.encode(entry.keyword)
  const value = encoder.encode(entry.value)
  // keyword \0 compressionFlag compressionMethod languageTag \0 translatedKeyword \0 text
  const out = new Uint8Array(keyword.length + 5 + value.length)
  out.set(keyword, 0)
  out.set(value, keyword.length + 5)
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)))
  return out
}

/** zlib-обёртка над deflate из «сохранённых» блоков: заголовок, блоки, Adler-32. */
function zlib(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / MAX_STORED_BLOCK))
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4)
  out[0] = 0x78 // CM=8 (deflate), CINFO=7 (окно 32K)
  out[1] = 0x01 // без словаря; (0x78 << 8 | 0x01) кратно 31, как требует формат

  let offset = 2
  for (let i = 0; i < blocks; i += 1) {
    const start = i * MAX_STORED_BLOCK
    const size = Math.min(MAX_STORED_BLOCK, data.length - start)
    out[offset] = i === blocks - 1 ? 1 : 0 // BFINAL, BTYPE=00 (без сжатия)
    out[offset + 1] = size & 0xff
    out[offset + 2] = (size >>> 8) & 0xff
    out[offset + 3] = ~size & 0xff
    out[offset + 4] = (~size >>> 8) & 0xff
    out.set(data.subarray(start, start + size), offset + 5)
    offset += 5 + size
  }

  new DataView(out.buffer).setUint32(offset, adler32(data))
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(data: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of data) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
