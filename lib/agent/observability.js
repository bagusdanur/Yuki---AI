const ALLOWED_EVENTS = new Set([
  'agent_run_started', 'skill_selected', 'tool_call_started', 'tool_call_completed', 'tool_call_failed',
  'approval_requested', 'approval_approved', 'approval_rejected', 'workflow_resumed',
  'verification_passed', 'verification_failed', 'agent_run_completed'
])

function safeMeta(meta = {}) {
  const output = {}
  for (const [key, value] of Object.entries(meta)) {
    if (/content|prompt|message|token|secret|password|authorization|cookie|args/i.test(key)) continue
    if (['string', 'number', 'boolean'].includes(typeof value)) output[key] = typeof value === 'string' ? value.slice(0, 180) : value
  }
  return output
}

export function traceEvent(event, meta = {}) {
  if (!ALLOWED_EVENTS.has(event)) return
  console.info(JSON.stringify({ event, at: new Date().toISOString(), ...safeMeta(meta) }))
}
