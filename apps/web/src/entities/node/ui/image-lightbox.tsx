import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { fileUrl } from '@/shared/api'
import { Button } from '@/shared/ui'
import styles from './image-lightbox.module.css'

export interface ImageLightboxProps {
  fileId: string
  /** Подпись: чья это картинка — нода и её тип. */
  title: string
  onClose: () => void
}

/**
 * Полноразмерный просмотр результата.
 *
 * Портал в `body` здесь не украшение: карточка ноды живёт внутри полотна React Flow,
 * к которому применён `transform` со сдвигом и масштабом. Любой «модальный» слой,
 * отрисованный внутри ноды, унаследовал бы этот масштаб и перестал бы быть
 * полноразмерным — ради чего просмотр и открывают.
 */
export const ImageLightbox = ({ fileId, title, onClose }: ImageLightboxProps) => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — полный размер`}
      // клик по фону закрывает; клик по самой картинке — нет
      onClick={onClose}
    >
      <div className={styles.frame} onClick={(event) => event.stopPropagation()}>
        <img className={styles.image} src={fileUrl(fileId)} alt={title} />
        <div className={styles.bar}>
          <span className={styles.title}>{title}</span>
          <code className={styles.fileId}>{fileId}</code>
          <span className={styles.spacer} />
          <a
            className={styles.link}
            href={fileUrl(fileId)}
            target="_blank"
            rel="noreferrer"
            // ссылка на файл: полный размер без интерфейса и возможность сохранить
          >
            Открыть файл
          </a>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
