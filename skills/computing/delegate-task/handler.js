// skills/computing/delegate-task/handler.js
import { delegateTasks } from '../../../lib/agent/subagent.js'

export async function executeDelegateTasks({ tasks, shared_context = '' }, context = {}) {
  const userId = context.userId
  if (!userId) return { error: 'User ID tidak tersedia.' }
  if (!Array.isArray(tasks) || tasks.length < 2) {
    return { error: 'Minimal 2 subtask diperlukan untuk delegation.' }
  }
  if (tasks.length > 4) {
    return { error: 'Maksimal 4 subtask untuk delegation.' }
  }

  const result = await delegateTasks({ tasks, userId, sharedContext: shared_context })
  return result
}

export default {
  delegate_tasks: executeDelegateTasks
}
