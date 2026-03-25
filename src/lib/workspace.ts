/**
 * Workspace 存储层抽象
 *
 * 支持两种存储实现：
 * - FileSystemWorkspaceStorage: 文件系统存储（适合本地开发/服务器部署）
 * - DatabaseWorkspaceStorage: 数据库存储（适合 serverless 部署）
 *
 * 通过 WORKSPACE_STORAGE_TYPE 环境变量选择：
 * - "filesystem"（默认）：文件系统存储
 * - "database"：数据库存储
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export type AgentType =
  | 'trend'
  | 'topic'
  | 'research'
  | 'write'
  | 'images'
  | 'review'
  | 'publish'

export interface WorkspaceInfo {
  id: string
  accountId: string
  path: string
  status: 'running' | 'completed' | 'failed'
  currentStep: AgentType | null
  createdAt: string
  updatedAt: string
  checkpoint: {
    completedSteps: AgentType[]
    lastOutput: Record<string, unknown>
  }
}

interface RunJson {
  id: string
  accountId: string
  status: 'running' | 'completed' | 'failed'
  currentStep: AgentType | null
  createdAt: string
  updatedAt: string
  checkpoint: {
    completedSteps: AgentType[]
    lastOutput: Record<string, unknown>
  }
}

export const STEP_ORDER: AgentType[] = [
  'trend',
  'topic',
  'research',
  'write',
  'images',
  'review',
  'publish',
]

// Steps that are executed per-topic (after topic selection)
export const PER_TOPIC_STEPS: AgentType[] = [
  'research',
  'write',
  'images',
  'review',
  'publish',
]

const STEP_DIRS: Record<AgentType, string> = {
  trend: '01-trend',
  topic: '02-topic',
  research: '03-research',
  write: '04-write',
  images: '05-images',
  review: '06-review',
  publish: '07-publish',
}

// Per-topic step compound key format: "{step}:{topicId}"
export function perTopicStepKey(step: AgentType, topicId: string): string {
  return `${step}:${topicId}`
}

export function parsePerTopicStepKey(key: string): { step: AgentType; topicId: string } | null {
  const parts = key.split(':')
  if (parts.length !== 2) return null
  const [step, topicId] = parts as [AgentType, string]
  if (!STEP_ORDER.includes(step)) return null
  return { step, topicId }
}

// ============================================================================
// IWorkspaceStorage 接口（异步）
// ============================================================================

export interface IWorkspaceStorage {
  create(accountId: string, workspaceId?: string): Promise<WorkspaceInfo>
  get(workspaceId: string): Promise<WorkspaceInfo | null>
  readPreviousOutput(workspaceId: string, step: AgentType, filename?: string): Promise<unknown | null>
  writeOutput(workspaceId: string, step: AgentType, filename: string, content: string | Buffer): Promise<void>
  checkpoint(workspaceId: string, step: AgentType, output: unknown, topicId?: string): Promise<void>
  setStatus(workspaceId: string, status: 'completed' | 'failed'): Promise<void>
  resume(workspaceId: string): Promise<{
    currentStep: AgentType
    previousOutputs: Record<string, unknown>
    topicBatch: Record<string, AgentType[]>
  }>
  list(): Promise<WorkspaceInfo[]>
  delete(workspaceId: string): Promise<void>
}

// ============================================================================
// FileSystemWorkspaceStorage
// ============================================================================

function getWorkspacesDir(): string {
  const dir = path.resolve(process.cwd(), 'workspaces')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getWorkspaceDir(workspaceId: string): string {
  return path.join(getWorkspacesDir(), workspaceId)
}

function toWorkspaceInfo(runJson: RunJson, workspacePath: string): WorkspaceInfo {
  return {
    id: runJson.id,
    accountId: runJson.accountId,
    path: workspacePath,
    status: runJson.status,
    currentStep: runJson.currentStep,
    createdAt: runJson.createdAt,
    updatedAt: runJson.updatedAt,
    checkpoint: runJson.checkpoint,
  }
}

class FileSystemWorkspaceStorage implements IWorkspaceStorage {
  async create(accountId: string, workspaceId?: string): Promise<WorkspaceInfo> {
    const id = workspaceId ?? randomUUID()
    const workspacePath = getWorkspaceDir(id)

    if (fs.existsSync(workspacePath)) {
      throw new Error(`Workspace ${id} already exists at ${workspacePath}`)
    }

    fs.mkdirSync(workspacePath, { recursive: true })

    const now = new Date().toISOString()
    const runJson: RunJson = {
      id,
      accountId,
      status: 'running',
      currentStep: null,
      createdAt: now,
      updatedAt: now,
      checkpoint: { completedSteps: [], lastOutput: {} },
    }

    for (const step of STEP_ORDER) {
      fs.mkdirSync(path.join(workspacePath, STEP_DIRS[step]), { recursive: true })
    }
    fs.mkdirSync(path.join(workspacePath, 'output'), { recursive: true })
    fs.writeFileSync(path.join(workspacePath, 'run.json'), JSON.stringify(runJson, null, 2), 'utf-8')

    return toWorkspaceInfo(runJson, workspacePath)
  }

  async get(workspaceId: string): Promise<WorkspaceInfo | null> {
    const workspacePath = getWorkspaceDir(workspaceId)
    const runJsonPath = path.join(workspacePath, 'run.json')
    if (!fs.existsSync(runJsonPath)) return null
    try {
      const content = fs.readFileSync(runJsonPath, 'utf-8')
      return toWorkspaceInfo(JSON.parse(content) as RunJson, workspacePath)
    } catch {
      return null
    }
  }

  async readPreviousOutput(
    workspaceId: string,
    step: AgentType,
    filename = 'output.json',
  ): Promise<unknown | null> {
    const workspacePath = getWorkspaceDir(workspaceId)
    const filePath = path.join(workspacePath, STEP_DIRS[step], filename)
    if (!fs.existsSync(filePath)) return null
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      try { return JSON.parse(content) } catch { return content }
    } catch {
      return null
    }
  }

  async writeOutput(
    workspaceId: string,
    step: AgentType,
    filename: string,
    content: string | Buffer,
  ): Promise<void> {
    const workspacePath = getWorkspaceDir(workspaceId)
    const stepDir = path.join(workspacePath, STEP_DIRS[step])
    if (!fs.existsSync(stepDir)) {
      fs.mkdirSync(stepDir, { recursive: true })
    }
    fs.writeFileSync(path.join(stepDir, filename), content)
  }

  async checkpoint(workspaceId: string, step: AgentType, output: unknown, topicId?: string): Promise<void> {
    const workspacePath = getWorkspaceDir(workspaceId)
    const runJsonPath = path.join(workspacePath, 'run.json')
    if (!fs.existsSync(runJsonPath)) throw new Error(`Workspace ${workspaceId} does not exist`)

    const content = fs.readFileSync(runJsonPath, 'utf-8')
    const runJson = JSON.parse(content) as RunJson

    // For per-topic steps, use compound key format: "step:topicId"
    const isPerTopic = PER_TOPIC_STEPS.includes(step)
    const effectiveKey = (isPerTopic && topicId) ? perTopicStepKey(step, topicId) : step
    const effectiveStepIndex = STEP_ORDER.indexOf(step)
    const nextStep = STEP_ORDER[effectiveStepIndex + 1] ?? null

    const updatedRunJson: RunJson = {
      ...runJson,
      currentStep: nextStep as AgentType | null,
      updatedAt: new Date().toISOString(),
      checkpoint: {
        completedSteps: [...runJson.checkpoint.completedSteps, effectiveKey as AgentType],
        lastOutput: { ...runJson.checkpoint.lastOutput, [effectiveKey]: output },
      },
    }
    fs.writeFileSync(runJsonPath, JSON.stringify(updatedRunJson, null, 2), 'utf-8')
  }

  async setStatus(workspaceId: string, status: 'completed' | 'failed'): Promise<void> {
    const workspacePath = getWorkspaceDir(workspaceId)
    const runJsonPath = path.join(workspacePath, 'run.json')
    if (!fs.existsSync(runJsonPath)) throw new Error(`Workspace ${workspaceId} does not exist`)
    const content = fs.readFileSync(runJsonPath, 'utf-8')
    const runJson = JSON.parse(content) as RunJson
    runJson.status = status
    runJson.updatedAt = new Date().toISOString()
    fs.writeFileSync(runJsonPath, JSON.stringify(runJson, null, 2), 'utf-8')
  }

  async resume(workspaceId: string): Promise<{
    currentStep: AgentType
    previousOutputs: Record<string, unknown>
    topicBatch: Record<string, AgentType[]>
  }> {
    const workspace = await this.get(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} does not exist`)
    if (workspace.status !== 'running') {
      throw new Error(`Workspace ${workspaceId} is not running (status: ${workspace.status})`)
    }

    // Build topicBatch from compound keys and find last global step and last step overall
    const topicBatch: Record<string, AgentType[]> = {}
    let lastGlobalStep: AgentType | undefined
    let lastCompletedStep: AgentType | undefined

    for (const key of workspace.checkpoint.completedSteps) {
      const parsed = parsePerTopicStepKey(key)
      if (parsed) {
        // Per-topic step with compound key: add to topicBatch
        if (!topicBatch[parsed.topicId]) {
          topicBatch[parsed.topicId] = []
        }
        topicBatch[parsed.topicId].push(parsed.step)
        lastCompletedStep = parsed.step
      } else if (PER_TOPIC_STEPS.includes(key as AgentType)) {
        // Legacy per-topic step without topicId (e.g., 'research' without ':topicId')
        // Add to topicBatch with empty string as key to indicate legacy/unknown topic
        const legacyKey = '__legacy__'
        if (!topicBatch[legacyKey]) {
          topicBatch[legacyKey] = []
        }
        topicBatch[legacyKey].push(key as AgentType)
        lastCompletedStep = key as AgentType
      } else {
        // Global step (trend or topic)
        lastGlobalStep = key as AgentType
        lastCompletedStep = key as AgentType
      }
    }

    // Determine currentStep:
    // - If there are per-topic steps (indicated by lastCompletedStep being a per-topic step or topicBatch having entries),
    //   use lastCompletedStep to compute next step
    // - Otherwise, use lastGlobalStep
    const hasPerTopicSteps = Object.keys(topicBatch).length > 0
    const effectiveLastStep = hasPerTopicSteps
      ? lastCompletedStep
      : lastGlobalStep

    const currentStep = !effectiveLastStep
      ? STEP_ORDER[0]
      : STEP_ORDER[STEP_ORDER.indexOf(effectiveLastStep) + 1]

    const previousOutputs: Record<string, unknown> = {}
    for (const step of workspace.checkpoint.completedSteps) {
      previousOutputs[step] = workspace.checkpoint.lastOutput[step] ?? null
    }

    return { currentStep, previousOutputs, topicBatch }
  }

  async list(): Promise<WorkspaceInfo[]> {
    const workspacesDir = getWorkspacesDir()
    if (!fs.existsSync(workspacesDir)) return []

    const dirs = fs.readdirSync(workspacesDir).filter((entry) => {
      try {
        return fs.statSync(path.join(workspacesDir, entry)).isDirectory()
      } catch {
        return false
      }
    })

    const workspaces: WorkspaceInfo[] = []
    for (const entry of dirs) {
      const ws = await this.get(entry)
      if (ws) workspaces.push(ws)
    }

    return workspaces.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
  }

  async delete(workspaceId: string): Promise<void> {
    const workspacePath = getWorkspaceDir(workspaceId)
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true })
    }
  }
}

// ============================================================================
// DatabaseWorkspaceStorage (for serverless)
// ============================================================================

class DatabaseWorkspaceStorage implements IWorkspaceStorage {
  private readonly TASK_RUN_TYPE = 'FULL_PIPELINE' as const

  async create(accountId: string, workspaceId?: string): Promise<WorkspaceInfo> {
    const id = workspaceId ?? randomUUID()
    const now = new Date().toISOString()

    return {
      id,
      accountId,
      path: `db://taskRun/${id}`,
      status: 'running',
      currentStep: null,
      createdAt: now,
      updatedAt: now,
      checkpoint: { completedSteps: [], lastOutput: {} },
    }
  }

  async get(workspaceId: string): Promise<WorkspaceInfo | null> {
    try {
      const taskRun = await prisma.taskRun.findFirst({
        where: { id: workspaceId, taskType: this.TASK_RUN_TYPE },
      })
      if (!taskRun) return null

      let checkpoint = { completedSteps: [] as AgentType[], lastOutput: {} as Record<string, unknown> }
      try {
        const outputData = JSON.parse(taskRun.output || '{}')
        checkpoint = outputData.checkpoint ?? checkpoint
      } catch { /* ignore */ }

      return {
        id: taskRun.id,
        accountId: taskRun.accountId,
        path: `db://taskRun/${taskRun.id}`,
        status: taskRun.status === 'RUNNING' ? 'running'
          : taskRun.status === 'SUCCESS' ? 'completed' : 'failed',
        currentStep: checkpoint.completedSteps.length > 0
          ? STEP_ORDER[checkpoint.completedSteps.length]
          : null,
        createdAt: taskRun.startedAt.toISOString(),
        updatedAt: (taskRun.finishedAt ?? taskRun.startedAt).toISOString(),
        checkpoint,
      }
    } catch {
      return null
    }
  }

  async readPreviousOutput(
    workspaceId: string,
    step: AgentType,
    filename = 'output.json',
  ): Promise<unknown | null> {
    try {
      const taskRun = await prisma.taskRun.findFirst({
        where: { id: workspaceId, taskType: this.TASK_RUN_TYPE },
      })
      if (!taskRun) return null

      const outputData = JSON.parse(taskRun.output || '{}')
      const stepData = (outputData[step] as Record<string, unknown> | undefined) ?? {}
      return stepData[filename] ?? null
    } catch {
      return null
    }
  }

  async writeOutput(
    workspaceId: string,
    step: AgentType,
    filename: string,
    content: string | Buffer,
  ): Promise<void> {
    const taskRun = await prisma.taskRun.findFirst({
      where: { id: workspaceId, taskType: this.TASK_RUN_TYPE },
    })
    if (!taskRun) throw new Error(`Workspace ${workspaceId} does not exist`)

    let outputData: Record<string, unknown> = {}
    try { outputData = JSON.parse(taskRun.output || '{}') } catch { /* start fresh */ }

    const stepData = (outputData[step] as Record<string, unknown>) ?? {}
    stepData[filename] = typeof content === 'string'
      ? content
      : Buffer.from(content).toString('base64')

    outputData[step] = stepData
    await prisma.taskRun.update({
      where: { id: workspaceId },
      data: { output: JSON.stringify(outputData) },
    })
  }

  async checkpoint(workspaceId: string, step: AgentType, output: unknown, topicId?: string): Promise<void> {
    const taskRun = await prisma.taskRun.findFirst({
      where: { id: workspaceId, taskType: this.TASK_RUN_TYPE },
    })
    if (!taskRun) throw new Error(`Workspace ${workspaceId} does not exist`)

    let checkpoint = { completedSteps: [] as AgentType[], lastOutput: {} as Record<string, unknown> }
    try {
      const outputData = JSON.parse(taskRun.output || '{}')
      checkpoint = outputData.checkpoint ?? checkpoint
    } catch { /* ignore */ }

    // For per-topic steps, use compound key format: "step:topicId"
    const isPerTopic = PER_TOPIC_STEPS.includes(step)
    const effectiveKey = (isPerTopic && topicId) ? perTopicStepKey(step, topicId) : step
    const effectiveStepIndex = STEP_ORDER.indexOf(step)
    const nextStep = STEP_ORDER[effectiveStepIndex + 1] ?? null

    const updatedCheckpoint = {
      completedSteps: [...checkpoint.completedSteps, effectiveKey as AgentType],
      lastOutput: { ...checkpoint.lastOutput, [effectiveKey]: output },
    }

    let outputData: Record<string, unknown> = {}
    try { outputData = JSON.parse(taskRun.output || '{}') } catch { /* ignore */ }

    outputData.checkpoint = updatedCheckpoint
    outputData.currentStep = nextStep

    await prisma.taskRun.update({
      where: { id: workspaceId },
      data: { output: JSON.stringify(outputData) },
    })
  }

  async setStatus(workspaceId: string, status: 'completed' | 'failed'): Promise<void> {
    const prismaStatus = status === 'completed' ? 'SUCCESS' : 'FAILED'
    await prisma.taskRun.updateMany({
      where: { id: workspaceId, taskType: this.TASK_RUN_TYPE },
      data: { status: prismaStatus, finishedAt: new Date() },
    })
  }

  async resume(workspaceId: string): Promise<{
    currentStep: AgentType
    previousOutputs: Record<string, unknown>
    topicBatch: Record<string, AgentType[]>
  }> {
    const workspace = await this.get(workspaceId)
    if (!workspace) throw new Error(`Workspace ${workspaceId} does not exist`)
    if (workspace.status !== 'running') {
      throw new Error(`Workspace ${workspaceId} is not running (status: ${workspace.status})`)
    }

    // Build topicBatch from compound keys and find last global step and last step overall
    const topicBatch: Record<string, AgentType[]> = {}
    let lastGlobalStep: AgentType | undefined
    let lastCompletedStep: AgentType | undefined

    for (const key of workspace.checkpoint.completedSteps) {
      const parsed = parsePerTopicStepKey(key)
      if (parsed) {
        // Per-topic step with compound key: add to topicBatch
        if (!topicBatch[parsed.topicId]) {
          topicBatch[parsed.topicId] = []
        }
        topicBatch[parsed.topicId].push(parsed.step)
        lastCompletedStep = parsed.step
      } else if (PER_TOPIC_STEPS.includes(key as AgentType)) {
        // Legacy per-topic step without topicId (e.g., 'research' without ':topicId')
        // Add to topicBatch with empty string as key to indicate legacy/unknown topic
        const legacyKey = '__legacy__'
        if (!topicBatch[legacyKey]) {
          topicBatch[legacyKey] = []
        }
        topicBatch[legacyKey].push(key as AgentType)
        lastCompletedStep = key as AgentType
      } else {
        // Global step (trend or topic)
        lastGlobalStep = key as AgentType
        lastCompletedStep = key as AgentType
      }
    }

    // Determine currentStep:
    // - If there are per-topic steps (indicated by lastCompletedStep being a per-topic step or topicBatch having entries),
    //   use lastCompletedStep to compute next step
    // - Otherwise, use lastGlobalStep
    const hasPerTopicSteps = Object.keys(topicBatch).length > 0
    const effectiveLastStep = hasPerTopicSteps
      ? lastCompletedStep
      : lastGlobalStep

    const currentStep = !effectiveLastStep
      ? STEP_ORDER[0]
      : STEP_ORDER[STEP_ORDER.indexOf(effectiveLastStep) + 1]

    const previousOutputs: Record<string, unknown> = {}
    for (const step of workspace.checkpoint.completedSteps) {
      previousOutputs[step] = workspace.checkpoint.lastOutput[step] ?? null
    }

    return { currentStep, previousOutputs, topicBatch }
  }

  async list(): Promise<WorkspaceInfo[]> {
    const taskRuns = await prisma.taskRun.findMany({
      where: { taskType: this.TASK_RUN_TYPE },
      orderBy: { startedAt: 'desc' },
    })

    const workspaces: WorkspaceInfo[] = []
    for (const taskRun of taskRuns) {
      const ws = await this.get(taskRun.id)
      if (ws) workspaces.push(ws)
    }
    return workspaces
  }

  async delete(workspaceId: string): Promise<void> {
    await prisma.taskRun.deleteMany({
      where: { id: workspaceId, taskType: this.TASK_RUN_TYPE },
    })
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

function createWorkspaceStorage(): IWorkspaceStorage {
  const storageType = process.env.WORKSPACE_STORAGE_TYPE ?? 'filesystem'
  switch (storageType) {
    case 'database':
      return new DatabaseWorkspaceStorage()
    case 'filesystem':
    default:
      return new FileSystemWorkspaceStorage()
  }
}

// ============================================================================
// WorkspaceManager Facade（兼容现有调用方，内部异步化）
// ============================================================================

export class WorkspaceManager {
  private storage: IWorkspaceStorage

  constructor() {
    this.storage = createWorkspaceStorage()
  }

  async create(accountId: string, workspaceId?: string): Promise<WorkspaceInfo> {
    return this.storage.create(accountId, workspaceId)
  }

  async get(workspaceId: string): Promise<WorkspaceInfo | null> {
    return this.storage.get(workspaceId)
  }

  async readPreviousOutput(
    workspaceId: string,
    step: AgentType,
    filename = 'output.json',
  ): Promise<unknown | null> {
    return this.storage.readPreviousOutput(workspaceId, step, filename)
  }

  async writeOutput(
    workspaceId: string,
    step: AgentType,
    filename: string,
    content: string | Buffer,
  ): Promise<void> {
    return this.storage.writeOutput(workspaceId, step, filename, content)
  }

  async checkpoint(workspaceId: string, step: AgentType, output: unknown, topicId?: string): Promise<void> {
    return this.storage.checkpoint(workspaceId, step, output, topicId)
  }

  async setStatus(workspaceId: string, status: 'completed' | 'failed'): Promise<void> {
    return this.storage.setStatus(workspaceId, status)
  }

  async resume(workspaceId: string): Promise<{
    currentStep: AgentType
    previousOutputs: Record<string, unknown>
    topicBatch: Record<string, AgentType[]>
  }> {
    return this.storage.resume(workspaceId)
  }

  async list(): Promise<WorkspaceInfo[]> {
    return this.storage.list()
  }

  async delete(workspaceId: string): Promise<void> {
    return this.storage.delete(workspaceId)
  }

  getStepDir(workspaceId: string, step: AgentType): string {
    return path.join(getWorkspaceDir(workspaceId), STEP_DIRS[step])
  }

  getOutputDir(workspaceId: string): string {
    return path.join(getWorkspaceDir(workspaceId), 'output')
  }

  getNextStep(currentStep: AgentType): AgentType | null {
    const currentIndex = STEP_ORDER.indexOf(currentStep)
    if (currentIndex === -1 || currentIndex === STEP_ORDER.length - 1) return null
    return STEP_ORDER[currentIndex + 1]
  }
}

export const workspaceManager = new WorkspaceManager()
