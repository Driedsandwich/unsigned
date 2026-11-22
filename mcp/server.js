import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createTools } from './tools.js';
const mode = process.env.UNSIGNED_MCP_MODE || 'demo';
if (!['demo','live'].includes(mode)) throw new Error('UNSIGNED_MCP_MODE must be demo or live');
const privateDir = resolve(fileURLToPath(new URL('./private', import.meta.url)));
const tools = createTools({
  demo: mode === 'demo',
  async loadThemes() {
    const parsed = JSON.parse(await readFile(resolve(privateDir, 'themes.local.json'), 'utf8'));
    if (!Array.isArray(parsed.themes)) throw new Error('Invalid safe themes export');
    return parsed.themes;
  },
  async saveDraft(draft) {
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    await writeFile(resolve(privateDir, `draft-${randomUUID()}.json`), JSON.stringify(draft,null,2)+'\n', { mode: 0o600, flag: 'wx' });
  }
});
const server = new McpServer({ name: 'unsigned', version: '1.0.0' });
const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const safe = fn => async args => { try { return reply(await fn(args)); } catch { return { ...reply({ error: 'Request rejected or local data unavailable' }), isError: true }; } };
server.registerTool('get_themes', {
  description: 'Aggregated themes and respondent bands only. No individual responses or below-threshold themes.',
  inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false }
}, safe(tools.get_themes));
server.registerTool('draft_check_in_question', {
  description: 'Return an administrator request as an editable draft. No inference.',
  inputSchema: { request: z.string().trim().min(1).max(240) }, annotations: { readOnlyHint: true, openWorldHint: false }
}, safe(tools.draft_check_in_question));
server.registerTool('schedule_check_in', {
  description: 'Save a LOCAL draft only. No scheduling, publishing or external writes. Human confirmation is required.',
  inputSchema: { question: z.string().trim().min(1).max(240), proposed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, safe(tools.schedule_check_in));
await server.connect(new StdioServerTransport());
