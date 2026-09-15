export async function run_skill_health_check() {
  const [{ getSkillsHealth }, { executeCalculateExpression }, { executeRunJavascriptCode }, { analyze_code_syntax }, { executeGetCurrentTime }, { selectAgentToolNames }] = await Promise.all([
    import('../../../lib/agent/skills-engine.js'),
    import('../../computing/safe-calculator/handler.js'),
    import('../../computing/code-scratchpad/handler.js'),
    import('../../computing/code-analyzer/handler.js'),
    import('../../productivity/datetime-helper/handler.js'),
    import('../../../lib/agent/runner.js')
  ])
  const registry = await getSkillsHealth()
  const checks = []
  const check = async (name, fn) => {
    const started = Date.now()
    try {
      const ok = await fn()
      checks.push({ name, status: ok ? 'healthy' : 'unhealthy', durationMs: Date.now() - started })
    } catch (error) {
      checks.push({ name, status: 'unhealthy', durationMs: Date.now() - started, error: String(error.message || error).slice(0, 180) })
    }
  }
  await check('calculator', async () => (await executeCalculateExpression({ expression: '25% * 200' }))?.result === 50)
  await check('code-scratchpad', async () => (await executeRunJavascriptCode({ code: 'console.log("health")\nreturn 2 + 2' }))?.exitCode === 0)
  await check('code-analyzer', async () => (await analyze_code_syntax({ code: 'const ok = true', language: 'javascript' }))?.valid === true)
  await check('datetime', async () => Boolean((await executeGetCurrentTime({ timezone: 'WIB' }))?.iso))
  await check('explicit-routing', async () => {
    const scratch = selectAgentToolNames('Pakai Code Scratchpad untuk jalankan JavaScript')
    const learning = selectAgentToolNames('Pakai Self-Improvement untuk simpan evaluasi')
    return scratch.size === 1 && scratch.has('run_javascript_code') && learning.has('record_self_improvement') && !learning.has('run_skill_health_check')
  })
  const functionalHealthy = checks.every(item => item.status === 'healthy')
  return {
    success: Boolean(registry.healthy && functionalHealthy),
    healthy: Boolean(registry.healthy && functionalHealthy),
    skills_count: registry.skills_count,
    tools_count: registry.tools_count,
    missing_schemas: registry.missing_schemas,
    status: registry.healthy && functionalHealthy ? 'healthy' : 'degraded',
    registry_health: { status: registry.healthy ? 'healthy' : 'unhealthy', skills_count: registry.skills_count, tools_count: registry.tools_count, missing_schemas: registry.missing_schemas },
    functional_health: { status: functionalHealthy ? 'healthy' : 'degraded', checks },
    untested_live_capabilities: ['web-search', 'url-reader', 'browser-agent', 'api-tester', 'ryukomik-expert', 'scheduler'],
    note: 'Status ini membedakan kesehatan registrasi dari synthetic check. Capability jaringan yang belum dites dilaporkan terpisah, bukan dianggap sehat.'
  }
}

export default { run_skill_health_check }
