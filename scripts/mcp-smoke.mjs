// Talks to the MCP endpoint the way Chord does: initialize, list tools, call one.
// Usage: MCP_URL=https://host/mcp MCP_TOKEN=... node scripts/mcp-smoke.mjs [tool] [json-args]
const url = process.env.MCP_URL || 'http://localhost:8787/mcp';
const [tool = 'get_menu', args = '{}'] = process.argv.slice(2);
let id = 0;

async function rpc(method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MCP_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${body}`);
  return JSON.parse(body);
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } });
console.log('server:', init.result.serverInfo);
const tools = await rpc('tools/list', {});
console.log('tools:', tools.result.tools.map((t) => t.name).join(', '));
const out = await rpc('tools/call', { name: tool, arguments: JSON.parse(args) });
console.log(`\n${tool}${out.result.isError ? ' (isError)' : ''}:\n${out.result.content.map((c) => c.text).join('\n')}`);
