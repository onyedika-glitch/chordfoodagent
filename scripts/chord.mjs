// Chord setup CLI. Every call is appended to logs/chord-api.log with its
// X-Request-Id, so a failure can be quoted to Chord support (and the field notes).
//
//   node scripts/chord.mjs teammates              list teammates the key can see
//   node scripts/chord.mjs mcp-register           register the MCP server (disabled), print its id
//   node scripts/chord.mjs mcp-enable             enable it, discover tools, health check
//   node scripts/chord.mjs assign                 restrict the teammate to our MCP server
//   node scripts/chord.mjs skill                  upload + publish skill/mama-tee-orders
//   node scripts/chord.mjs chat "text" [session]  send one message as a test customer
//
// Reads ../.env: CHORD_API_KEY, CHORD_WORKSPACE_ID, CHORD_TEAMMATE_ID,
// CHORD_MCP_SERVER_ID, MCP_PUBLIC_URL, MCP_TOKEN.
import { readFileSync, readdirSync, statSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const env = process.env;
const BASE = env.CHORD_BASE_URL || 'https://api.chordhq.xyz';
mkdirSync(join(root, 'logs'), { recursive: true });

function need(...names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) { console.error(`Missing in .env: ${missing.join(', ')}`); process.exit(1); }
}

async function api(method, path, body) {
  const reqId = randomUUID();
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CHORD_API_KEY}`, 'Content-Type': 'application/json', 'X-Request-ID': reqId },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(130000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  appendFileSync(join(root, 'logs/chord-api.log'), `${JSON.stringify({
    t: new Date().toISOString(), method, path, status: res.status, ms: Date.now() - started,
    request_id: res.headers.get('x-request-id') || reqId, response: typeof json === 'string' ? json.slice(0, 2000) : json,
  })}\n`);
  if (!res.ok) {
    console.error(`${method} ${path} -> HTTP ${res.status} (request id ${res.headers.get('x-request-id') || reqId})`);
    console.error(typeof json === 'string' ? json : JSON.stringify(json, null, 2));
    process.exit(1);
  }
  return json;
}

const ws = () => `/v1/workspaces/${env.CHORD_WORKSPACE_ID}/mcp-servers`;
const print = (x) => console.log(JSON.stringify(x, null, 2));

const commands = {
  async teammates() {
    need('CHORD_API_KEY');
    const q = env.CHORD_WORKSPACE_ID ? `?workspace_id=${env.CHORD_WORKSPACE_ID}` : '';
    const list = await api('GET', `/v1/teammates${q}`);
    for (const t of list) console.log(`${t.id}  ${t.display_name || t.first_name}  ws=${t.workspace_id}  ${t.lifecycle_state}  mcp=${JSON.stringify(t.mcp_server_ids || [])}`);
  },

  async 'mcp-register'() {
    need('CHORD_API_KEY', 'CHORD_WORKSPACE_ID', 'MCP_PUBLIC_URL', 'MCP_TOKEN');
    const s = await api('POST', ws(), {
      name: "Mama Tee's Kitchen orders", url: env.MCP_PUBLIC_URL, auth_type: 'bearer',
      auth_token: env.MCP_TOKEN, transport: 'streamable_http', enabled: false,
    });
    print(s);
    console.log(`\nAdd to .env:  CHORD_MCP_SERVER_ID=${s.id}`);
  },

  async 'mcp-enable'() {
    need('CHORD_API_KEY', 'CHORD_WORKSPACE_ID', 'CHORD_MCP_SERVER_ID');
    const id = env.CHORD_MCP_SERVER_ID;
    print(await api('PUT', `${ws()}/${id}`, { enabled: true, enabled_tools: ['get_menu', 'create_order', 'check_payment'] }));
    const tools = await api('POST', `${ws()}/${id}/tools`);
    console.log('discovered tools:', tools.map((t) => t.name).join(', '));
    const health = await api('POST', `${ws()}/${id}/health`);
    print(health);
    if (health.status !== 'ok') process.exit(1); // HTTP 200 can still be a failed probe
  },

  async assign() {
    need('CHORD_API_KEY', 'CHORD_TEAMMATE_ID', 'CHORD_MCP_SERVER_ID');
    await api('PUT', `/v1/teammates/${env.CHORD_TEAMMATE_ID}`, { set_mcp_server_ids: [env.CHORD_MCP_SERVER_ID] });
    const t = await api('GET', `/v1/teammates/${env.CHORD_TEAMMATE_ID}`);
    console.log('teammate mcp_server_ids now:', t.mcp_server_ids);
  },

  async skill() {
    need('CHORD_API_KEY', 'CHORD_TEAMMATE_ID');
    const dir = join(root, 'skill/mama-tee-orders');
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    const files = walk(dir).map((f) => ({ path: relative(dir, f), content: readFileSync(f, 'utf8') }));
    const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16);
    const base = `/v1/teammates/${env.CHORD_TEAMMATE_ID}/skills`;

    let set = await api('GET', base);
    if (!set.enabled) {
      console.log('skills runtime is off for this teammate; migrating');
      set = await api('POST', `${base}/migrate`, {});
    }
    const existing = (set.skills || []).find((s) => s.name === 'mama-tee-orders');
    let skill;
    if (existing) {
      skill = await api('PUT', `${base}/${existing.id}/draft`, {
        name: 'mama-tee-orders', entrypoint: 'SKILL.md', files, expected_version: existing.version, idempotency_key: `draft-${digest}`,
      });
    } else {
      skill = await api('POST', base, { name: 'mama-tee-orders', entrypoint: 'SKILL.md', files, idempotency_key: `create-${digest}` });
    }
    const published = await api('POST', `${base}/${skill.id}/publish`, {
      expected_version: skill.version, summary: `files ${digest}`, idempotency_key: `publish-${digest}`,
    });
    console.log(`published ${published.id} v${published.published_version} (${files.length} files: ${files.map((f) => f.path).join(', ')})`);
  },

  async chat(text, session = 'demo-1') {
    need('CHORD_API_KEY', 'CHORD_WORKSPACE_ID', 'CHORD_TEAMMATE_ID');
    const r = await api('POST', '/v1/external-chat/messages', {
      workspace_id: env.CHORD_WORKSPACE_ID, teammate_id: env.CHORD_TEAMMATE_ID,
      sender_id: '2348031234567', session_id: session, display_name: 'Test customer', text,
    });
    console.log(r.agent_invoked ? r.reply : `(no reply: ${r.reason})`);
    for (const s of r.steps || []) console.log(`  · ${s.tool_name || s.title}: ${s.success === false ? 'FAILED ' : ''}${String(s.result || '').slice(0, 160)}`);
  },
};

const [cmd, ...args] = process.argv.slice(2);
if (!commands[cmd]) { console.error(`Commands: ${Object.keys(commands).join(', ')}`); process.exit(1); }
await commands[cmd](...args);
