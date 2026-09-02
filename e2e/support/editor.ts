import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

/** Точка на холсте в координатах видимой области React Flow. */
export interface Point {
  x: number
  y: number
}

/** Конец связи: нода и имя её порта — ровно так они названы в `NODE_SPECS`. */
export interface Port {
  node: string
  port: string
}

const pane = (page: Page): Locator => page.locator('.react-flow__pane')

const handle = (page: Page, { node, port }: Port): Locator =>
  page.locator(`.react-flow__handle[data-nodeid="${node}"][data-handleid="${port}"]`)

const center = async (locator: Locator): Promise<Point> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('элемент не виден на странице')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

export const openEditor = async (page: Page): Promise<void> => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Запустить' })).toBeVisible()
}

/**
 * Уменьшение масштаба перед раскладкой. Карточка генерации — 568 пикселей
 * в высоту: при масштабе 1 две ветки не помещаются в холст, и порты нижней
 * оказываются за краем, то есть недоступны мыши.
 */
export const zoomOut = async (page: Page, times: number): Promise<void> => {
  for (let step = 0; step < times; step += 1) {
    await page.locator('.react-flow__controls-zoomout').click()
  }
}

/** Показать граф целиком — тем же способом, что и пользователь. */
export const fitView = async (page: Page): Promise<void> => {
  await page.locator('.react-flow__controls-fitview').click()
  // Подгонка масштаба анимирована: без паузы координаты портов считаются на лету.
  await page.waitForTimeout(400)
}

/**
 * Нода перетаскивается из палитры на холст — тем же способом, что и руками.
 * Возвращённый идентификатор предсказуем (`kind-N`), но проверяется по факту:
 * тест не должен зависеть от того, как приложение их нумерует.
 */
export const dropNode = async (page: Page, kind: string, at: Point): Promise<string> => {
  const before = await page.locator('.react-flow__node').count()
  await page.locator(`button[data-node-kind="${kind}"]`).dragTo(pane(page), { targetPosition: at })
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1)

  const added = page.locator('.react-flow__node').nth(before)
  const id = await added.getAttribute('data-id')
  if (id === null) throw new Error(`нода «${kind}» добавилась без идентификатора`)
  return id
}

/**
 * Связь протягивается мышью от выхода к входу.
 *
 * Промежуточное движение обязательно: React Flow начинает соединение по первому
 * перемещению мыши после нажатия, и прыжок сразу в конечную точку он принял бы
 * за клик по порту.
 */
export const connect = async (page: Page, from: Port, to: Port): Promise<void> => {
  const start = await center(handle(page, from))
  const end = await center(handle(page, to))

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, { steps: 8 })
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
}

export const edgeId = (from: Port, to: Port): string =>
  `${from.node}.${from.port}--${to.node}.${to.port}`

export const edge = (page: Page, from: Port, to: Port): Locator =>
  page.locator(`.react-flow__edge[data-id="${edgeId(from, to)}"]`)

/** Карточка ноды: на ней же висит `data-status` — статус её job'а. */
export const nodeCard = (page: Page, nodeId: string): Locator =>
  page.locator(`.react-flow__node[data-id="${nodeId}"] article`)

/** Выделение ноды — клик по шапке: в теле карточки живут её собственные контролы. */
export const selectNode = async (page: Page, nodeId: string): Promise<void> => {
  await page.locator(`.react-flow__node[data-id="${nodeId}"] header`).click()
}

export const runWorkflow = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Запустить' }).click()
}

/** Статус запуска целиком — то же значение, что показано в шапке. */
export const runStatus = (page: Page): Locator => page.locator('[data-run-status]')

/**
 * Картинка ноды действительно загрузилась. `toBeVisible` тут недостаточно:
 * битый `src` — это видимый элемент нулевой ширины, и проверка «результат
 * появился» проходила бы на сломанной раздаче файлов.
 */
export const expectImageLoaded = async (image: Locator): Promise<void> => {
  await expect(image).toBeVisible()
  await expect
    .poll(async () => image.evaluate((element: HTMLImageElement) => element.naturalWidth), {
      message: 'изображение не загрузилось: naturalWidth остался нулевым',
    })
    .toBeGreaterThan(0)
}
