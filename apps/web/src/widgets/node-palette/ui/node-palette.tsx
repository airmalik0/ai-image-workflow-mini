import { nodeKinds } from '@workflow/contracts'
import { NODE_DESCRIPTIONS, NODE_LABELS, PortSignature } from '@/entities/node'
import { startNodeDrag, useAddNode } from '@/features/add-node'
import styles from './node-palette.module.css'

/**
 * Палитра типов нод. Список берётся из `nodeKinds`, а сигнатура портов — из
 * `NODE_SPECS`: новый тип ноды появится здесь сам, без правки этого файла.
 *
 * Добавить ноду можно двумя способами — перетащить на канвас или нажать.
 * Клавиатура работает наравне с мышью: элемент палитры — обычная кнопка.
 */
export const NodePalette = () => {
  const { addAtViewportCenter } = useAddNode()

  return (
    <section className={styles.palette} aria-label="Палитра нод">
      <span className={styles.title}>Палитра нод</span>

      <ul className={styles.list}>
        {nodeKinds.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              className={styles.item}
              draggable
              data-node-kind={kind}
              onDragStart={(event) => startNodeDrag(event, kind)}
              onClick={() => addAtViewportCenter(kind)}
              title={`Добавить ноду «${NODE_LABELS[kind]}»`}
            >
              <span className={styles.head}>
                <span className={styles.name}>{NODE_LABELS[kind]}</span>
                <PortSignature kind={kind} />
              </span>
              <span className={styles.description}>{NODE_DESCRIPTIONS[kind]}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className={styles.hint}>
        Квадрат — порт <b>text</b>, круг — <b>image</b>. Соединяются только порты одного типа, и у
        входа может быть один источник; выход ветвится сколько угодно раз.
      </p>
    </section>
  )
}
