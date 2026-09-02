import { useState } from 'react'
import { fileUrl } from '@/shared/api'
import { cn } from '@/shared/lib'
import { ImageLightbox } from './image-lightbox'
import styles from './node.module.css'

export interface NodeImageProps {
  fileId: string
  /** Чья это картинка: подпись для читалки экрана и заголовок полноразмерного просмотра. */
  title: string
}

/**
 * Готовое изображение в карточке ноды. В графе и в событиях ходит только `fileId`,
 * поэтому байты приезжают отдельным запросом к `GET /api/files/:id` — в поток
 * событий картинки не попадают вовсе.
 *
 * `nodrag`: без него нажатие на превью React Flow принимает за начало
 * перетаскивания ноды, и полноразмерный просмотр не открывается никогда.
 */
export const NodeImage = ({ fileId, title }: NodeImageProps) => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={cn(styles.previewButton, 'nodrag')}
        onClick={() => setOpen(true)}
        title="Открыть в полном размере"
      >
        <img className={styles.preview} src={fileUrl(fileId)} alt={title} />
        <span className={styles.previewZoom} aria-hidden="true">
          ⤢
        </span>
      </button>

      {open && <ImageLightbox fileId={fileId} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}
