import { expect, test } from '@playwright/test'
import {
  connect,
  dropNode,
  edge,
  expectImageLoaded,
  fitView,
  nodeCard,
  openEditor,
  runStatus,
  runWorkflow,
  selectNode,
  zoomOut,
} from './support/editor.js'
import type { Port } from './support/editor.js'

/*
 * Обязательное ветвление из задания:
 *
 *            ┌→ [ Генерация A ] → [ Результат A ]
 * [ Промпт ] ┤
 *            └→ [ Генерация B ] → [ Результат B ]
 *
 * Граф собирается мышью — перетаскиванием из палитры и протяжкой связей между
 * портами, а не загрузкой готового сценария: проверяется именно редактор.
 */
test('ветвление собирается мышью, и обе ветки доходят до своей картинки', async ({ page }) => {
  await openEditor(page)
  await zoomOut(page, 3)

  const prompt = await dropNode(page, 'prompt', { x: 100, y: 300 })
  const generateTop = await dropNode(page, 'generateImage', { x: 400, y: 50 })
  const generateBottom = await dropNode(page, 'generateImage', { x: 400, y: 390 })
  const resultTop = await dropNode(page, 'result', { x: 800, y: 50 })
  const resultBottom = await dropNode(page, 'result', { x: 800, y: 390 })
  await fitView(page)

  const links: [Port, Port][] = [
    [
      { node: prompt, port: 'text' },
      { node: generateTop, port: 'prompt' },
    ],
    [
      { node: prompt, port: 'text' },
      { node: generateBottom, port: 'prompt' },
    ],
    [
      { node: generateTop, port: 'image' },
      { node: resultTop, port: 'image' },
    ],
    [
      { node: generateBottom, port: 'image' },
      { node: resultBottom, port: 'image' },
    ],
  ]

  for (const [from, to] of links) {
    await connect(page, from, to)
    await expect(edge(page, from, to)).toBeVisible()
  }

  // Текст промпта задаётся в инспекторе — тем же путём, что и у пользователя.
  await selectNode(page, prompt)
  await page.getByLabel('Текст промпта').fill('Керамическая кружка на бетонной столешнице')

  await expect(page.getByText('граф валиден')).toBeVisible()

  await runWorkflow(page)
  await expect(runStatus(page)).toHaveAttribute('data-run-status', 'completed')

  // Обе ветки независимы: успех одной ничего не говорит о второй, поэтому
  // проверяются обе — и статусом job'а, и загрузившейся картинкой.
  for (const node of [generateTop, generateBottom]) {
    await expect(nodeCard(page, node)).toHaveAttribute('data-status', 'success')
  }
  for (const node of [resultTop, resultBottom]) {
    await expectImageLoaded(nodeCard(page, node).locator('img'))
  }
})

/*
 * Типы портов из задания: `text` и `image`, несовместимые соединения блокируются.
 * Блокировка молчащая — половина требования: пользователь должен узнать причину,
 * а не гадать, почему связь не появилась.
 */
test('несовместимые порты не соединяются, и отказ объясняется', async ({ page }) => {
  await openEditor(page)
  await zoomOut(page, 2)

  const prompt = await dropNode(page, 'prompt', { x: 150, y: 120 })
  const result = await dropNode(page, 'result', { x: 520, y: 120 })
  await fitView(page)

  await connect(page, { node: prompt, port: 'text' }, { node: result, port: 'image' })

  await expect(page.getByRole('status')).toContainText(
    'Порт типа «text» нельзя соединить с «image»',
  )
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)
})
