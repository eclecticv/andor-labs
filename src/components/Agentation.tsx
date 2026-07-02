import { Agentation } from 'agentation';

/**
 * Dev-only visual feedback island.
 * Syncs annotations to the local Agent Feedback Server (agentation-mcp on :4747),
 * which the coding agent reads via the agentation MCP tools.
 * Mounted only when import.meta.env.DEV is true (see Base.astro) — never ships to prod.
 */
export default function AgentationDevTool() {
  return <Agentation endpoint="http://localhost:4747" />;
}
