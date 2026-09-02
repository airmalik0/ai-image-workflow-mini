import type { ModelDescriptor } from '@workflow/contracts'

/** Идентификаторы возможностей, от которых зависят настройки в интерфейсе. */
export const CAPABILITY_IDS = ['edit', 'negativePrompt'] as const

export type CapabilityId = (typeof CAPABILITY_IDS)[number]

export interface ModelCapability {
  id: CapabilityId
  label: string
  supported: (model: ModelDescriptor) => boolean
  /** Что произойдёт вместо неподдерживаемой настройки: это и надо показать вместо поля. */
  fallback: string
}

/**
 * Матрица возможностей моделей. Нужна не для украшения: настройка, которой у модели
 * нет, обязана выглядеть выключенной с пояснением — иначе интерфейс принимает
 * значение и молча его теряет, а пользователь ищет причину в результате генерации.
 *
 * Источник признаков — `ModelDescriptor` из `GET /api/models`, а не список вендоров
 * на фронте. Поэтому `negativePrompt` возвращает `false` для всех: ни один
 * подключённый провайдер не принимает негатив отдельным полем (§7 спеки), и в
 * дескрипторе такого флага пока нет — описывать нечего. Появится провайдер,
 * который умеет, — здесь появится чтение поля, а не перечисление вендоров.
 */
export const MODEL_CAPABILITIES: readonly ModelCapability[] = [
  {
    id: 'edit',
    label: 'Редактирование изображения',
    supported: (model) => model.supportsEdit,
    fallback: 'Нода «Редактирование» с этой моделью не запустится — выберите другую',
  },
  {
    id: 'negativePrompt',
    label: 'Negative prompt отдельным полем',
    supported: () => false,
    fallback: 'Негатив из пресета вклеивается в текст промпта — это делает RequestBuilder',
  },
]

/**
 * Поддерживает ли модель настройку. Модель не выбрана — считаем, что настройки нет:
 * провайдер по умолчанию неизвестен, и обещать возможность, которой может не быть,
 * хуже, чем показать её выключенной.
 */
export const supportsCapability = (model: ModelDescriptor | null, id: CapabilityId): boolean => {
  if (model === null) return false
  const capability = MODEL_CAPABILITIES.find((item) => item.id === id)
  return capability?.supported(model) ?? false
}

export const capabilityFallback = (id: CapabilityId): string =>
  MODEL_CAPABILITIES.find((item) => item.id === id)?.fallback ?? ''
