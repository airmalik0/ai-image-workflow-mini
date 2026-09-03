import { deflateSync } from 'node:zlib'

/**
 * Референсные картинки сида рисуются кодом, а не лежат в репозитории бинарниками.
 *
 * Причина простая: бинарь в git — это версия, которую нельзя прочитать в ревью
 * и нельзя воспроизвести. Пятьдесят строк кодировщика дают детерминированные
 * PNG (байт в байт одинаковые при каждом сиде), а значит и стабильные
 * идентификаторы в content-addressed хранилище.
 *
 * **Здесь только фоны и фактуры, ни одного предмета** — и это не вкусовщина.
 * Проверено на живом `gpt-image-2`: фоновый референс модель применяет как сцену
 * (кружка со снимка остаётся собой, бетон меняется на бесшовный белый), а референс
 * с предметом композитит в кадр — с нарисованной сферой вместо отредактированной
 * фотографии приезжала сфера. Референс-предмет из набора поэтому убран.
 */
export interface ReferenceImage {
  slug: string
  title: string
  mimeType: string
  bytes: Uint8Array
}

const SIZE = 512

type Painter = (x: number, y: number) => readonly [number, number, number]

export function buildReferenceImages(): ReferenceImage[] {
  return [
    image('ref-premium-3d', 'Premium 3D: градиентный фон', premiumBackdrop),
    image('ref-studio-packshot', 'Предметная съёмка: белый циклорама-фон', studioPackshot),
    image('ref-watercolor', 'Акварель: пастельные пятна', watercolor),
    image('ref-neon-poster', 'Неон: сетка на тёмном', neonGrid),
    image('ref-soft-portrait', 'Портрет: тёплый ключевой свет', softPortrait),
  ]
}

function image(slug: string, title: string, painter: Painter): ReferenceImage {
  return { slug, title, mimeType: 'image/png', bytes: encodePng(SIZE, SIZE, render(painter)) }
}

function render(painter: Painter): Uint8Array {
  const rgb = new Uint8Array(SIZE * SIZE * 3)
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const [r, g, b] = painter(x / SIZE, y / SIZE)
      const offset = (y * SIZE + x) * 3
      rgb[offset] = clamp(r)
      rgb[offset + 1] = clamp(g)
      rgb[offset + 2] = clamp(b)
    }
  }
  return rgb
}

// --- палитры ---------------------------------------------------------------

function premiumBackdrop(x: number, y: number): readonly [number, number, number] {
  const diagonal = (x + y) / 2
  return [232 - diagonal * 70, 228 - diagonal * 52, 226 - diagonal * 24]
}

function studioPackshot(x: number, y: number): readonly [number, number, number] {
  const shadow = Math.max(0, 1 - Math.hypot((x - 0.5) * 1.6, (y - 0.82) * 5)) * 60
  const backdrop = y < 0.68 ? 250 : 244
  return [backdrop - shadow, backdrop - shadow, backdrop - shadow * 0.92]
}

function watercolor(x: number, y: number): readonly [number, number, number] {
  const first = blob(x, y, 0.34, 0.36, 0.3)
  const second = blob(x, y, 0.66, 0.58, 0.26)
  const third = blob(x, y, 0.5, 0.78, 0.2)
  return [
    252 - second * 70 - third * 20,
    248 - first * 60 - third * 40,
    244 - first * 20 - second * 30,
  ]
}

function neonGrid(x: number, y: number): readonly [number, number, number] {
  const horizon = 0.55
  // остаток в JS для отрицательных чисел отрицателен, поэтому нужен свой mod:
  // без него левая половина сетки просто не рисуется
  const line = y > horizon ? Math.abs(mod((y - horizon) * 14, 1) - 0.5) : 1
  const column = Math.abs(mod((x - 0.5) * 12, 1) - 0.5)
  const glow = y > horizon ? Math.max(0, 1 - line * 6) + Math.max(0, 1 - column * 6) * 0.5 : 0
  const sky = Math.max(0, 1 - Math.abs(y - horizon) * 3)
  return [18 + glow * 220 + sky * 90, 8 + glow * 60 + sky * 20, 40 + glow * 200 + sky * 120]
}

function softPortrait(x: number, y: number): readonly [number, number, number] {
  const key = Math.max(0, 1 - Math.hypot(x - 0.34, y - 0.3) * 1.7)
  const vignette = Math.max(0, 1 - Math.hypot(x - 0.5, y - 0.5) * 1.25)
  return [
    70 + key * 165 + vignette * 40,
    56 + key * 130 + vignette * 30,
    48 + key * 96 + vignette * 24,
  ]
}

function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

function blob(x: number, y: number, cx: number, cy: number, radius: number): number {
  return Math.max(0, 1 - Math.hypot(x - cx, y - cy) / radius)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

// --- кодировщик PNG --------------------------------------------------------

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * Минимальный PNG: truecolor 8 бит, фильтр 0, сжатие штатным `node:zlib`.
 * В инфраструктурном пакете zlib брать можно — в отличие от ядра, которое
 * обязано оставаться изоморфным и потому пакует свои картинки вручную.
 */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    Buffer.from(rgb.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // бит на канал
  header[9] = 2 // truecolor RGB
  header[10] = 0 // единственный метод сжатия
  header[11] = 0 // фильтрация по строкам
  header[12] = 0 // без интерлейсинга

  return new Uint8Array(
    Buffer.concat([
      Buffer.from(SIGNATURE),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
