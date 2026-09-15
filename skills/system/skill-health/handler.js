export async function run_skill_health_check() {
  const { getSkillsHealth } = await import('../../../lib/agent/skills-engine.js')
  return getSkillsHealth()
}

export default { run_skill_health_check }
