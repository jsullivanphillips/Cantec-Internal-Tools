/** Resolves promises for workflow queue items awaiting server confirmation. */

import type { TechnicianWorksheetStop } from './monthlyRoutesShared'

export type WorkflowQueueResult = {
  ok: boolean
  stop?: TechnicianWorksheetStop
  queued?: boolean
}

const waiters = new Map<string, (result: WorkflowQueueResult) => void>()

export function waitForWorkflowQueueItem(id: string): Promise<WorkflowQueueResult> {
  return new Promise((resolve) => {
    waiters.set(id, resolve)
  })
}

export function resolveWorkflowQueueItem(id: string, result: WorkflowQueueResult): void {
  const resolve = waiters.get(id)
  if (!resolve) return
  waiters.delete(id)
  resolve(result)
}

export function rejectWorkflowQueueItem(id: string, result: WorkflowQueueResult): void {
  resolveWorkflowQueueItem(id, result)
}
