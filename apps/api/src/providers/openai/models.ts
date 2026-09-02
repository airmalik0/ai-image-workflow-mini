/**
 * Модели OpenAI Images. В списке только то, что проверено живыми запросами
 * (`docs/research/openai-images.md`): `gpt-image-2` умеет все три нужные операции —
 * генерацию, редактирование и несколько референсов одним запросом.
 *
 * Пропорций как параметра у API нет: размер задаётся строкой `WIDTHxHEIGHT`,
 * поэтому таблица переводит пропорции пресета в конкретные размеры. Значение
 * `1824x1024` для 16:9 подсказано самим API в тексте ошибки на неверный `size`.
 */
export interface OpenAiModelSpec {
  id: string
  label: string
  supportsEdit: boolean
  /** Пропорции → значение параметра `size`. */
  sizes: Readonly<Record<string, string>>
}

export const OPENAI_MODELS: readonly OpenAiModelSpec[] = [
  {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    supportsEdit: true,
    sizes: {
      '1:1': '1024x1024',
      '3:2': '1536x1024',
      '2:3': '1024x1536',
      '16:9': '1824x1024',
      '9:16': '1024x1824',
    },
  },
]

export const DEFAULT_OPENAI_MODEL = 'gpt-image-2'

export function findOpenAiModel(id: string): OpenAiModelSpec | null {
  return OPENAI_MODELS.find((model) => model.id === id) ?? null
}
