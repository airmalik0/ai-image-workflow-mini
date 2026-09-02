import { ParamChips } from '@/entities/node'
import { usePresets } from '@/entities/preset'
import { StatusGlyph } from '@/shared/ui'
import styles from './preset-picker.module.css'

export interface PresetPickerProps {
  label: string
  value: string | null
  onChange: (presetId: string | null) => void
}

/**
 * Выбор пресета. Пресет — это заготовленный главный промпт, негатив и референсы;
 * как именно они смешиваются с промптом ноды, знает `RequestBuilder` в ядре,
 * а не этот компонент.
 */
export const PresetPicker = ({ label, value, onChange }: PresetPickerProps) => {
  const { presets, isLoading, error } = usePresets()

  return (
    <div className={styles.picker}>
      <ParamChips
        label={label}
        value={value}
        onSelect={onChange}
        empty={isLoading ? 'загружаем пресеты…' : 'пресеты недоступны'}
        options={[
          { value: null, label: 'без пресета' },
          ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
        ]}
      />

      {error !== null && (
        <p className={styles.error}>
          <StatusGlyph status="error" /> Пресеты не загрузились: {error.message}
        </p>
      )}
    </div>
  )
}
