import { Notice } from '@/shared/ui'
import { useDemoLimit } from '../model/use-demo-limit'
import styles from './demo-limit-notice.module.css'

/**
 * Объявление о подмене провайдера на демо-стенде.
 *
 * Стенд публичный и ходит в платный API по ключу владельца, поэтому у него есть
 * дневной потолок. По исчерпании потолка генерацию берёт на себя офлайновый
 * провайдер — и об этом обязано быть сказано вслух: молча подменённый провайдер
 * ничем не отличается от обмана. Пока квота цела, плашки нет: сообщать не о чем.
 */
export const DemoLimitNotice = () => {
  const demo = useDemoLimit()
  if (demo === null || !demo.exhausted) return null

  return (
    <div className={styles.strip}>
      <Notice
        tone="warning"
        title="Дневной лимит демонстрации исчерпан — включён офлайн-провайдер"
        hint={`Израсходовано ${demo.used} из ${demo.limit} обращений к боевому провайдеру. Счётчик обнулится в полночь UTC.`}
      >
        Изображения рисует локальная заглушка. Граф, очередь, статусы в реальном времени, Retry и
        отмена работают по-настоящему — в платный API запросы больше не уходят.
      </Notice>
    </div>
  )
}
