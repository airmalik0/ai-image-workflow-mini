import { fileUploadResponseSchema } from '@workflow/contracts'
import type { FileUploadResponse } from '@workflow/contracts'
import { apiRequest } from '@/shared/api'

/** Имя поля формы. Одно на фронт и бэк, поэтому вынесено в константу. */
export const UPLOAD_FIELD_NAME = 'file'

/**
 * Загрузка изображения: `multipart/form-data`, а не base64 в JSON. Base64 распухает
 * на треть и упирается в лимит тела запроса — обычная фотография с телефона
 * проваливается с «request entity too large». В ноду возвращается `fileId`,
 * содержимое файла в граф не попадает никогда.
 */
export const uploadImage = (file: File, signal?: AbortSignal): Promise<FileUploadResponse> => {
  const form = new FormData()
  form.append(UPLOAD_FIELD_NAME, file, file.name)

  return apiRequest('/files', {
    schema: fileUploadResponseSchema,
    method: 'POST',
    form,
    ...(signal === undefined ? {} : { signal }),
  })
}
