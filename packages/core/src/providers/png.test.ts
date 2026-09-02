import { inflateSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { encodePng } from './png.js'

/**
 * Проверка ручного zlib-потока настоящим распаковщиком: без неё ошибка в
 * «сохранённых» блоках или в Adler-32 всплыла бы только в браузере проверяющего.
 */
function chunkOf(png: Uint8Array, type: string): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  let offset = 8
  while (offset < png.length) {
    const length = view.getUint32(offset)
    const name = String.fromCharCode(...png.subarray(offset + 4, offset + 8))
    if (name === type) return png.subarray(offset + 8, offset + 8 + length)
    offset += length + 12
  }
  throw new Error(`в файле нет чанка ${type}`)
}

const solid = (width: number, height: number, rgb: [number, number, number]): Uint8Array => {
  const bytes = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i += 1) bytes.set(rgb, i * 3)
  return bytes
}

const inflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateSync(data))

it('пишет корректную сигнатуру и IHDR', () => {
  const png = encodePng({ width: 4, height: 3, rgb: solid(4, 3, [10, 20, 30]) })
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = chunkOf(png, 'IHDR')
  const header = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength)
  expect(header.getUint32(0)).toBe(4)
  expect(header.getUint32(4)).toBe(3)
  expect(ihdr[8]).toBe(8)
  expect(ihdr[9]).toBe(2)
})

it('IDAT распаковывается штатным zlib и совпадает с исходными пикселями', () => {
  const png = encodePng({ width: 2, height: 2, rgb: solid(2, 2, [255, 0, 128]) })
  // на каждую строку — байт фильтра плюс два пикселя по три байта
  expect([...inflate(chunkOf(png, 'IDAT'))]).toEqual([
    0, 255, 0, 128, 255, 0, 128, 0, 255, 0, 128, 255, 0, 128,
  ])
})

it('картинка больше одного deflate-блока тоже распаковывается', () => {
  const width = 200
  const height = 200
  const png = encodePng({ width, height, rgb: solid(width, height, [1, 2, 3]) })
  expect(inflate(chunkOf(png, 'IDAT')).length).toBe(height * (width * 3 + 1))
})

it('текстовые метаданные пишутся в iTXt в UTF-8', () => {
  const png = encodePng({
    width: 1,
    height: 1,
    rgb: solid(1, 1, [0, 0, 0]),
    text: [{ keyword: 'prompt', value: 'кот в скафандре' }],
  })
  const itxt = chunkOf(png, 'iTXt')
  const decoded = new TextDecoder().decode(itxt)
  // keyword, затем пять служебных нулевых байт, затем сам текст
  expect(decoded.startsWith('prompt\u0000\u0000\u0000\u0000\u0000')).toBe(true)
  expect(decoded.endsWith('кот в скафандре')).toBe(true)
})
