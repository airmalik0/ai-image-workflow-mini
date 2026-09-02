import {
  jobStatuses,
  MAX_PROMPT_LENGTH,
  NODE_SPECS,
  nodeKinds,
  type JobStatus,
  type NodeKind,
  type PortSpec,
} from '@workflow/contracts'
import { Fragment, useEffect, useState } from 'react'
import { RunTimelineView, parallelDemoRun, partialFailureDemoRun } from '@/widgets/run-timeline'
import { APP_NAME } from '@/shared/config'
import { BrandMark, Button, Chip, Field, Panel, StatusPill } from '@/shared/ui'
import styles from './design-system-page.module.css'

/** Что каждый статус означает в графе — подписи к шине состояний. */
const STATUS_MEANING: Record<JobStatus, string> = {
  idle: 'Нода в графе есть, планировщик до неё ещё не дошёл',
  queued: 'Все входы готовы, job поставлен в очередь и ждёт свободного воркера',
  running: 'Воркер выполняет запрос к провайдеру; попытка видна в подсказке',
  success: 'Результат записан в хранилище, потомки становятся готовыми',
  error: 'Провайдер отказал или кончились попытки; на ноде появляется Retry',
  skipped: 'Предок упал, выполнять нечего — но соседняя ветка продолжает идти',
}

/** Русские названия типов нод. Порты и их типы берутся из NODE_SPECS, а не дублируются. */
const NODE_LABELS: Record<NodeKind, string> = {
  prompt: 'Промпт',
  imageInput: 'Изображение',
  generateImage: 'Генерация',
  editImage: 'Редактирование',
  result: 'Результат',
}

const PALETTE = [
  { name: 'canvas', hex: '#0D0D0F' },
  { name: 'surface', hex: '#141417' },
  { name: 'raised', hex: '#1B1B20' },
  { name: 'border', hex: '#33333C' },
  { name: 'text', hex: '#F4F4F6' },
  { name: 'secondary', hex: '#A9AAB4' },
  { name: 'muted', hex: '#8B8C97' },
  { name: 'accent', hex: '#FF2E88' },
]

const TYPE_SCALE = [
  { token: 'display', px: 28, weight: 600 },
  { token: 'title', px: 20, weight: 600 },
  { token: 'lead', px: 16, weight: 400 },
  { token: 'body', px: 14, weight: 400 },
  { token: 'ui', px: 13, weight: 500 },
  { token: 'caption', px: 12, weight: 500 },
  { token: 'micro', px: 11, weight: 500 },
]

const SPACE_SCALE = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]

const MODELS = [
  { id: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash', edit: true },
  { id: 'gpt-image-2', label: 'GPT Image 2', edit: true },
  { id: 'fake', label: 'Fake (без ключа)', edit: false },
]

const PRESETS = ['Premium 3D', 'Плоская иллюстрация', 'Продуктовое фото']

/** Порты рисуются формой: квадрат — text, круг — image. */
const renderPorts = (ports: Record<string, PortSpec>) =>
  Object.entries(ports).map(([name, spec]) => (
    <span
      key={name}
      title={`${name}: ${spec.type}`}
      className={`${styles.port} ${spec.type === 'image' ? styles.portImage : ''}`}
    />
  ))

export const DesignSystemPage = () => {
  const [prompt, setPrompt] = useState(
    'Кружка на бетонной столешнице, мягкий боковой свет, минимализм',
  )
  const [shortInput, setShortInput] = useState('generate-')
  const [model, setModel] = useState(MODELS[0]?.id ?? '')
  const [preset, setPreset] = useState<string | null>(PRESETS[0] ?? null)
  const [busy, setBusy] = useState(false)
  // Витрина таймлайна работает на фикстуре: параллелизм видно и без поднятого бэкенда.
  const [timelineNode, setTimelineNode] = useState<string | null>('generateImage-2')

  useEffect(() => {
    if (!busy) return
    const timer = setTimeout(() => setBusy(false), 1600)
    return () => clearTimeout(timer)
  }, [busy])

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>
          <BrandMark className={styles.brandMark} />
          {APP_NAME}
        </span>
        <span className={styles.brandDivider} />
        <span className={styles.breadcrumb}>Основания интерфейса</span>
        <span className={styles.topbarSpacer} />
        <Chip marked title="Активный провайдер изображений">
          Провайдер: fake
        </Chip>
        <Button variant="ghost" size="sm">
          Сценарии
        </Button>
        <Button variant="primary" size="sm" loading={busy} onClick={() => setBusy(true)}>
          Запустить
        </Button>
      </header>

      <div className={styles.body}>
        <aside className={`${styles.rail} ${styles.railLeft}`}>
          <span className={styles.railTitle}>Палитра нод</span>
          <div className={styles.paletteList}>
            {nodeKinds.map((kind) => (
              <div key={kind} className={styles.paletteItem}>
                <span className={styles.paletteName}>{NODE_LABELS[kind]}</span>
                <span className={styles.ports}>
                  {renderPorts(NODE_SPECS[kind].inputs)}
                  <span className={styles.portsDivider} />
                  {renderPorts(NODE_SPECS[kind].outputs)}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            Список собран из NODE_SPECS. Квадрат — порт text, круг — image. Рабочая палитра с
            перетаскиванием — в <a href="#/">редакторе графа</a>.
          </p>
        </aside>

        <main className={styles.main}>
          <div className={styles.content}>
            <section className={styles.intro}>
              <h1>Основания интерфейса</h1>
              <p className={styles.lede}>
                Всё, из чего собирается редактор графа: шкалы, статусы и пять базовых элементов во
                всех состояниях. Канвас встанет в эту же рамку — колонки и док уже на местах.
              </p>
              <p className={styles.rule}>
                Правило цвета одно.{' '}
                <span className={styles.ruleTerm}>Розовый принадлежит пользователю</span>: кнопка,
                выбранный чип, фокус, активная связь — то, где можно действовать.{' '}
                <span className={styles.ruleTerm}>Цвет статуса принадлежит системе</span>: нода не
                станет розовой сама по себе, что бы с ней ни происходило.
              </p>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>Жизненный цикл job&apos;а</h2>
                <p className={styles.sectionNote}>
                  Шесть статусов приходят из @workflow/contracts. Форма глифа дублирует цвет,
                  поэтому пилюли различимы и без него.
                </p>
              </div>
              <div className={styles.bus}>
                {jobStatuses.map((status) => (
                  <div key={status} className={styles.busRow}>
                    <StatusPill status={status} />
                    <span className={styles.busMeaning}>
                      <span className={styles.busKey}>{status}</span> — {STATUS_MEANING[status]}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>Таймлайн запуска</h2>
                <p className={styles.sectionNote}>
                  Диаграмма Ганта по startedAt/finishedAt каждого job&apos;а. Полосы двух генераций
                  от одного промпта стоят на общем отрезке времени — это и есть доказательство
                  параллелизма, которое не требует чтения кода. Данные ниже — фикстура живого
                  прогона; в редакторе на её месте состояние из кэша запроса.
                </p>
              </div>
              <div className={styles.timeline}>
                <RunTimelineView
                  state={parallelDemoRun()}
                  selectedNodeId={timelineNode}
                  onSelectNode={setTimelineNode}
                />
              </div>
              <div className={styles.timeline}>
                <RunTimelineView state={partialFailureDemoRun()} />
              </div>
              <p className={styles.sectionNote}>
                Второй прогон — падение одной ветки: соседняя доходит до конца, потомок упавшей
                получает skipped, а текст и код отказа провайдера показаны целиком.
              </p>
            </section>

            <Panel
              title="Кнопки"
              description="Три варианта, два размера. Загрузка не меняет ширину — подпись остаётся на месте."
              actions={
                <Button variant="ghost" size="sm" onClick={() => setBusy(true)}>
                  Показать загрузку
                </Button>
              }
            >
              <div className={styles.specimenGrid}>
                <span />
                <span className={styles.specimenHead}>обычная</span>
                <span className={styles.specimenHead}>с иконкой</span>
                <span className={styles.specimenHead}>загрузка</span>
                <span className={styles.specimenHead}>выключена</span>

                {(['primary', 'secondary', 'ghost'] as const).map((variant) => (
                  <Fragment key={variant}>
                    <span className={styles.specimenLabel}>{variant}</span>
                    <div className={styles.row}>
                      <Button variant={variant} loading={busy} onClick={() => setBusy(true)}>
                        Запустить
                      </Button>
                    </div>
                    <div className={styles.row}>
                      <Button variant={variant} icon={<BrandMark />}>
                        Сценарий
                      </Button>
                    </div>
                    <div className={styles.row}>
                      <Button variant={variant} loading>
                        Запустить
                      </Button>
                    </div>
                    <div className={styles.row}>
                      <Button variant={variant} disabled>
                        Запустить
                      </Button>
                    </div>
                  </Fragment>
                ))}

                <span className={styles.specimenLabel}>размер sm</span>
                <div className={styles.row}>
                  <Button variant="primary" size="sm">
                    Retry
                  </Button>
                </div>
                <div className={styles.row}>
                  <Button variant="secondary" size="sm" icon={<BrandMark />}>
                    Копия
                  </Button>
                </div>
                <div className={styles.row}>
                  <Button variant="secondary" size="sm" loading>
                    Retry
                  </Button>
                </div>
                <div className={styles.row}>
                  <Button variant="ghost" size="sm" disabled>
                    Отменить
                  </Button>
                </div>
              </div>
            </Panel>

            <Panel
              title="Поля"
              description="Счётчик живёт в строке метки: он не отбирает высоту у промпта и виден во время набора."
            >
              <div className={styles.stack}>
                <Field
                  label="Промпт"
                  value={prompt}
                  onChange={setPrompt}
                  maxLength={MAX_PROMPT_LENGTH}
                  multiline
                  rows={3}
                  placeholder="Опишите, что нужно сгенерировать"
                  hint="Пресет добавит свою часть промпта перед вашей."
                />
                <Field
                  label="Идентификатор ноды"
                  value={shortInput}
                  onChange={setShortInput}
                  maxLength={24}
                  error="Такой идентификатор уже занят нодой generate-a"
                />
                <Field
                  label="Файл изображения"
                  value=""
                  onChange={() => {}}
                  placeholder="Загрузка появится в задаче 19"
                  disabled
                />
              </div>
            </Panel>

            <Panel
              title="Чипы"
              description="Выбор модели и пресета прямо в ноде: один клик, без выпадающих списков."
            >
              <div className={styles.stack}>
                <div>
                  <p className={styles.groupLabel}>Модель — точка слева означает поддержку edit</p>
                  <div className={styles.row}>
                    {MODELS.map((item) => (
                      <Chip
                        key={item.id}
                        marked={item.edit}
                        selected={model === item.id}
                        onClick={() => setModel(item.id)}
                      >
                        {item.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className={styles.groupLabel}>Пресет — повторный клик снимает выбор</p>
                  <div className={styles.row}>
                    {PRESETS.map((item) => (
                      <Chip
                        key={item}
                        selected={preset === item}
                        onClick={() => setPreset(preset === item ? null : item)}
                      >
                        {item}
                      </Chip>
                    ))}
                    <Chip disabled title="Пресет удалён">
                      Архивный пресет
                    </Chip>
                  </div>
                </div>
              </div>
            </Panel>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2>Шкалы</h2>
                <p className={styles.sectionNote}>
                  Ни одного значения по месту: цвет, кегль и отступы берутся из токенов в
                  app/styles/tokens.css.
                </p>
              </div>
              <div className={styles.stack}>
                <div>
                  <p className={styles.groupLabel}>Цвет</p>
                  <div className={styles.swatches}>
                    {PALETTE.map((color) => (
                      <div key={color.name} className={styles.swatch}>
                        <div className={styles.swatchChip} style={{ background: color.hex }} />
                        <span className={styles.swatchName}>{color.name}</span>
                        <span className={styles.swatchHex}>{color.hex}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={styles.groupLabel}>Кегль</p>
                  <div className={styles.scale}>
                    {TYPE_SCALE.map((item) => (
                      <div key={item.token} className={styles.scaleRow}>
                        <span className={styles.scaleMeta}>
                          {item.px}/{item.weight}
                        </span>
                        <span style={{ fontSize: item.px, fontWeight: item.weight }}>
                          {item.token}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className={styles.groupLabel}>Отступы, шаг 4</p>
                  <div className={styles.steps}>
                    {SPACE_SCALE.map((value) => (
                      <div key={value} className={styles.step}>
                        <span className={styles.stepBar} style={{ width: value }} />
                        <span className={styles.stepValue}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </main>

        <aside className={`${styles.rail} ${styles.railRight}`}>
          <span className={styles.railTitle}>Инспектор ноды</span>
          <div>
            {Object.entries(NODE_SPECS.generateImage.inputs).map(([name, spec]) => (
              <div key={name} className={styles.inspectorRow}>
                <span className={styles.inspectorKey}>{name}</span>
                <span className={styles.inspectorValue}>
                  вход · {spec.type}
                  {spec.required ? ' · обязателен' : ''}
                </span>
              </div>
            ))}
            {Object.entries(NODE_SPECS.generateImage.outputs).map(([name, spec]) => (
              <div key={name} className={styles.inspectorRow}>
                <span className={styles.inspectorKey}>{name}</span>
                <span className={styles.inspectorValue}>выход · {spec.type}</span>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            Так выглядят порты ноды generateImage. Форму параметров инспектор соберёт из той же
            таблицы — <span className={styles.placeholderTask}>задача 19</span>.
          </p>
        </aside>
      </div>

      <footer className={styles.dock}>
        <span className={styles.dockTitle}>Таймлайн запуска</span>
        <span>
          Полосы job'ов по времени: перекрытие двух веток — то самое доказательство параллелизма
        </span>
        <span className={styles.topbarSpacer} />
        <span className={styles.placeholderTask}>задача 21</span>
      </footer>
    </div>
  )
}
