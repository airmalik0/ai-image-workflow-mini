import type {
  CreatePresetRequest,
  Job,
  JobError,
  JobOutput,
  JobStatus,
  Preset,
  Run,
  RunStatus,
  SaveWorkflowRequest,
  UpdatePresetRequest,
  Workflow,
  WorkflowGraph,
} from '@workflow/contracts'

/**
 * Минимум, который нужен исполнителю ноды: достать пресет по id.
 * Отдельный интерфейс, чтобы воркеру не выдавать право писать в пресеты.
 */
export interface PresetLookup {
  findById(id: string): Promise<Preset | null>
}

export interface PresetRepository extends PresetLookup {
  list(): Promise<Preset[]>
  create(input: CreatePresetRequest): Promise<Preset>
  update(id: string, patch: UpdatePresetRequest): Promise<Preset | null>
  remove(id: string): Promise<boolean>
}

export interface WorkflowRepository {
  list(): Promise<Workflow[]>
  findById(id: string): Promise<Workflow | null>
  create(input: SaveWorkflowRequest): Promise<Workflow>
  update(id: string, input: SaveWorkflowRequest): Promise<Workflow | null>
  remove(id: string): Promise<boolean>
}

export interface CreateRunInput {
  workflowId: string | null
  graph: WorkflowGraph
}

/** Патч запуска. Поля отсутствуют — значит не меняются. */
export interface RunPatch {
  status?: RunStatus
  startedAt?: string | null
  finishedAt?: string | null
}

/** Патч job'а. `output` и `error` можно явно обнулять — этим пользуется retry. */
export interface JobPatch {
  status?: JobStatus
  attempt?: number
  startedAt?: string | null
  finishedAt?: string | null
  output?: JobOutput | null
  error?: JobError | null
}

/**
 * Хранилище запусков. Движок обращается к нему на каждое изменение состояния,
 * поэтому реализация обязана быть согласованной: в БД у `jobs` стоит уникальный
 * индекс `(run_id, node_id)`, и `ensureJobs` опирается на него.
 */
export interface RunRepository {
  createRun(input: CreateRunInput): Promise<Run>
  findRun(runId: string): Promise<Run | null>
  listRuns(limit: number): Promise<Run[]>
  updateRun(runId: string, patch: RunPatch): Promise<Run>

  /**
   * Идемпотентно заводит job'ы на все перечисленные ноды и возвращает их состояние.
   * Job заводится на КАЖДУЮ ноду графа сразу и в статусе `idle`: планировщик
   * считает предка без job'а неготовым, и без этого шага run молча встал бы.
   */
  ensureJobs(runId: string, nodeIds: readonly string[]): Promise<Job[]>
  listJobs(runId: string): Promise<Job[]>
  updateJob(runId: string, nodeId: string, patch: JobPatch): Promise<Job>
}
