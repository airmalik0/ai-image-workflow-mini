import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  expectImageLoaded,
  nodeCard,
  openEditor,
  runStatus,
  runWorkflow,
  selectNode,
} from './support/editor.js'
import { FAILING_NODE, FAKE_FAIL_NODES } from './support/stand.js'

const SOURCE_IMAGE = fileURLToPath(new URL('./fixtures/source.png', import.meta.url))

/*
 * Сценарий 2 из задания (изображение → редактирование → результат) и требование
 * «повтор failed node должен быть доступен».
 *
 * Падение подстроено переменной окружения `FAKE_FAIL_NODES=editImage-1:1`:
 * заглушка роняет первую попытку ноды в каждом запуске. Ронять боевой провайдер
 * ради этого нельзя — тогда проверялась бы обработка ошибки ключа, а не отказа
 * генерации, и стенд стоил бы денег.
 */
test('упавшая нода объясняет отказ, а повтор доводит её до результата', async ({ page }) => {
  await openEditor(page)

  await page.locator('button[data-scenario="edit"]').click()
  await expect(nodeCard(page, 'imageInput-1')).toBeVisible()

  // Исходник уходит на сервер как multipart и возвращается уже как fileId:
  // превью в ноде рисуется картинкой с сервера, а не выбранным файлом.
  await selectNode(page, 'imageInput-1')
  await page.locator('input[type="file"]').setInputFiles(SOURCE_IMAGE)
  await expectImageLoaded(nodeCard(page, 'imageInput-1').locator('img'))

  await runWorkflow(page)

  const failed = nodeCard(page, FAILING_NODE)
  await expect(
    failed,
    `стенд должен быть поднят с FAKE_FAIL_NODES=${FAKE_FAIL_NODES}`,
  ).toHaveAttribute('data-status', 'error')
  // Код нужен не для красоты: по нему отказ ищется в логах и отличается от чужого.
  await expect(failed).toContainText('PROVIDER_UNAVAILABLE')

  // Запуск считается по всем job'ам: пока нода не выполнена, run не completed,
  // а ветка за упавшей нодой пропускается, а не висит вечно в очереди.
  await expect(runStatus(page)).toHaveAttribute('data-run-status', 'failed')
  await expect(nodeCard(page, 'result-1')).toHaveAttribute('data-status', 'skipped')

  await failed.getByRole('button', { name: /Повторить/ }).click()

  await expect(failed).toHaveAttribute('data-status', 'success')
  await expect(runStatus(page)).toHaveAttribute('data-run-status', 'completed')
  await expectImageLoaded(nodeCard(page, 'result-1').locator('img'))
})
