import { useId } from 'react'
import { cn } from '../../lib'
import { StatusGlyph } from '../icon'
import styles from './field.module.css'

export interface FieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string | undefined
  /** Подсказка под полем. Скрывается, когда показывается ошибка. */
  hint?: string | undefined
  error?: string | undefined
  /** Включает счётчик символов и нативное ограничение длины. */
  maxLength?: number | undefined
  multiline?: boolean | undefined
  rows?: number | undefined
  disabled?: boolean | undefined
  id?: string | undefined
}

/** Доля заполнения, после которой счётчик перестаёт быть нейтральным. */
const NEAR_LIMIT = 0.9

export const Field = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
  maxLength,
  multiline = false,
  rows = 4,
  disabled = false,
  id,
}: FieldProps) => {
  const generatedId = useId()
  const controlId = id ?? generatedId
  const noteId = `${controlId}-note`

  const ratio = maxLength ? value.length / maxLength : 0
  const note = error ?? hint

  const controlProps = {
    id: controlId,
    className: cn(styles.control, multiline && styles.multiline, error && styles.invalid),
    value,
    placeholder,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': note ? noteId : undefined,
    ...(maxLength === undefined ? {} : { maxLength }),
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  }

  return (
    <div className={styles.field}>
      <div className={styles.head}>
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
        {maxLength !== undefined && (
          <span
            className={cn(
              styles.counter,
              ratio >= 1 && styles.counterFull,
              ratio >= NEAR_LIMIT && ratio < 1 && styles.counterNear,
            )}
            aria-live="polite"
          >
            {value.length} / {maxLength}
          </span>
        )}
      </div>

      {multiline ? <textarea {...controlProps} rows={rows} /> : <input {...controlProps} />}

      {note && (
        <p id={noteId} className={cn(styles.note, error && styles.noteError)}>
          {error && <StatusGlyph status="error" className={styles.noteIcon} />}
          <span>{note}</span>
        </p>
      )}
    </div>
  )
}
