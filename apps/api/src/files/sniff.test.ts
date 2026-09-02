import { describe, expect, it } from 'vitest'
import { encodePng } from '../db/reference-images.js'
import { TINY_JPEG } from '../testing/images.js'
import { sniffImageType } from './sniff.js'

describe('sniffImageType', () => {
  it('узнаёт PNG по сигнатуре', () => {
    expect(sniffImageType(encodePng(2, 2, new Uint8Array(12)))).toBe('image/png')
  })

  it('узнаёт JPEG по сигнатуре', () => {
    expect(sniffImageType(TINY_JPEG)).toBe('image/jpeg')
  })

  it('узнаёт WebP по паре RIFF/WEBP, а не по одному RIFF', () => {
    const riff = new TextEncoder().encode('RIFF')
    const webp = new TextEncoder().encode('WEBP')
    const wave = new TextEncoder().encode('WAVE')

    const asWebp = new Uint8Array(16)
    asWebp.set(riff, 0)
    asWebp.set(webp, 8)
    const asWave = new Uint8Array(16)
    asWave.set(riff, 0)
    asWave.set(wave, 8)

    expect(sniffImageType(asWebp)).toBe('image/webp')
    expect(sniffImageType(asWave)).toBeNull()
  })

  it('не изображение — null, каким бы ни был заголовок части формы', () => {
    expect(sniffImageType(new TextEncoder().encode('#!/bin/sh'))).toBeNull()
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
    // усечённая сигнатура PNG не считается PNG
    expect(sniffImageType(Uint8Array.of(0x89, 0x50))).toBeNull()
  })
})
