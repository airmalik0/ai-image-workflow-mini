import { useMutation } from '@tanstack/react-query'
import { useId } from 'react'
import { fileUrl } from '@/shared/api'
import { Button } from '@/shared/ui'
import { uploadImage } from '../api/upload-file'
import styles from './image-uploader.module.css'

export interface ImageUploaderProps {
  label: string
  /** `fileId` из FileStorage; `null` — файла ещё нет. */
  value: string | null
  onChange: (fileId: string | null) => void
}

/** Что показываем в подписи под превью: имя файла клиенту неизвестно, известен id. */
const shortId = (fileId: string) => (fileId.length > 16 ? `${fileId.slice(0, 16)}…` : fileId)

/**
 * Загрузка исходного изображения. Файл уходит на `POST /api/files` и превращается
 * в `fileId`; превью показывается уже с сервера — так видно, что файл действительно
 * доехал, а не просто выбран в диалоге.
 */
export const ImageUploader = ({ label, value, onChange }: ImageUploaderProps) => {
  const inputId = useId()
  const mutation = useMutation({
    mutationFn: (file: File) => uploadImage(file),
    onSuccess: (result) => onChange(result.fileId),
  })

  return (
    <div className={styles.uploader}>
      <span className={styles.label}>{label}</span>

      <div className={styles.frame}>
        {value === null ? (
          <span className={styles.placeholder}>
            {mutation.isPending ? 'Загружаем…' : 'Файл не выбран'}
          </span>
        ) : (
          <img className={styles.preview} src={fileUrl(value)} alt="Загруженное изображение" />
        )}
      </div>

      <input
        id={inputId}
        className={styles.input}
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) mutation.mutate(file)
          // сброс: тот же файл должен выбираться повторно после ошибки
          event.target.value = ''
        }}
      />

      <div className={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          loading={mutation.isPending}
          onClick={() => document.getElementById(inputId)?.click()}
        >
          {value === null ? 'Выбрать файл' : 'Заменить'}
        </Button>
        {value !== null && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Убрать
          </Button>
        )}
      </div>

      {value !== null && <span className={styles.meta}>fileId: {shortId(value)}</span>}

      {mutation.error !== null && (
        <p className={styles.error}>Файл не загрузился: {mutation.error.message}</p>
      )}
    </div>
  )
}
