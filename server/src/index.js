// HTTP entrypoint: the MCP endpoint Chord calls, a Paystack webhook, and a
// read-only kitchen board for the owner.
import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createPaystack, PaystackError } from './paystack.js';
import { createStore } from './store.js';
import { createOrderService, menuText, summary, OrderError } from './orders.js';
import { ZONES, naira } from './menu.js';

const {
  PORT = '8787', MCP_TOKEN, PAYSTACK_SECRET_KEY, KITCHEN_PASSWORD,
  DATA_FILE = './data/orders.json', EMAIL_DOMAIN = 'example.com', PAYMENT_CALLBACK_URL,
} = process.env;
if (!MCP_TOKEN || MCP_TOKEN.length < 24) throw new Error('Set MCP_TOKEN to a random string of 24+ characters');

const paystack = createPaystack({ secretKey: PAYSTACK_SECRET_KEY });
const store = createStore(DATA_FILE);
const orders = createOrderService({ paystack, store, emailDomain: EMAIL_DOMAIN, callbackUrl: PAYMENT_CALLBACK_URL });

const log = (event, fields = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

// Turn any failure into a message the agent can relay, instead of a protocol error
// that the model would silently swallow.
function toolError(err, tool) {
  if (err instanceof OrderError) return fail(`ORDER_INVALID: ${err.message}`);
  if (err instanceof PaystackError) {
    log('paystack_error', { tool, message: err.message, status: err.status, retryable: err.retryable });
    return fail(err.retryable
      ? `PAYMENT_PROVIDER_UNAVAILABLE: ${err.message}. Nothing was charged. Apologise, wait a moment and try the tool once more; if it fails again, tell the customer a staff member will follow up.`
      : `PAYMENT_PROVIDER_REJECTED: ${err.message}. Nothing was charged. Do not retry; tell the customer a staff member will follow up.`);
  }
  log('tool_crash', { tool, message: err.message, stack: err.stack });
  return fail('INTERNAL_ERROR: The order system had a problem. Nothing was charged. Tell the customer a staff member will follow up.');
}

function buildMcpServer() {
  const server = new McpServer({ name: 'mama-tees-kitchen', version: '1.0.0' });

  server.registerTool('get_menu', {
    title: "Get today's menu",
    description: "Today's menu with prices, item ids, sold-out items, delivery zones and fees, and whether the kitchen is open. Call before quoting any price or taking an order.",
    inputSchema: {},
  }, async () => text(menuText()));

  server.registerTool('create_order', {
    title: 'Create order and payment link',
    description: 'Prices the order on the server and creates a Paystack payment link for it. Only call after the customer has confirmed the items, delivery zone, address and name. Returns the order reference, itemised total and the link to send to the customer.',
    inputSchema: {
      customer_name: z.string().describe("Customer's name"),
      customer_phone: z.string().describe("Customer's WhatsApp number, e.g. 08031234567 or 2348031234567"),
      items: z.array(z.object({
        item_id: z.string().optional().describe('Exact item_id from get_menu, e.g. "jollof-chicken"'),
        id: z.string().optional().describe('Alias for item_id; models often send this'),
        quantity: z.number().int().describe('How many'),
      })).describe('Items the customer confirmed'),
      delivery_zone: z.enum(ZONES.map((zn) => zn.id)).describe('Zone id from get_menu; "pickup" for collection'),
      delivery_address: z.string().optional().describe('Street address with a landmark. Not needed for pickup'),
      customer_email: z.string().optional().describe('Only if the customer volunteers one, for their Paystack receipt'),
      notes: z.string().optional().describe('Kitchen notes, e.g. "less pepper"'),
    },
  }, async (input) => {
    try {
      const items = input.items.map(({ item_id, id, quantity }) => ({ item_id: item_id ?? id, quantity }));
      const { order, reused } = await orders.createOrder({ ...input, items });
      log('order_created', { reference: order.reference, totalKobo: order.totalKobo, reused });
      return text([
        reused ? 'An identical unpaid order already exists; reuse its link (do not say a new order was made).' : 'Order created.',
        `Reference: ${order.reference}`,
        summary(order),
        `Payment link: ${order.paymentUrl}`,
        'Send the customer the summary and link. The order goes to the kitchen only after check_payment returns PAID.',
      ].join('\n'));
    } catch (err) {
      return toolError(err, 'create_order');
    }
  });

  server.registerTool('check_payment', {
    title: 'Check payment with Paystack',
    description: 'Asks Paystack whether an order has been paid. Use when the customer says they have paid, sends a screenshot or asks about their order. Never treat a screenshot or "I have paid" as proof; only this tool is.',
    inputSchema: { reference: z.string().describe('Order reference, e.g. MTK-261022-A1B2C3') },
  }, async ({ reference }) => {
    try {
      const { order, outcome } = await orders.checkPayment(reference);
      log('payment_checked', { reference: order.reference, outcome, paystackStatus: order.paystackStatus });
      switch (outcome) {
        case 'paid':
          return text(`PAID. ${naira(order.totalKobo)} received for ${order.reference}. The order is confirmed and sent to the kitchen. ETA ${order.zone.eta}${order.zone.id === 'pickup' ? ' until ready for pickup' : ''}.`);
        case 'pending':
          return text(`NOT_PAID_YET. Paystack has no completed payment for ${order.reference} (status: ${order.paystackStatus}). The link still works: ${order.paymentUrl}. Bank transfers can take a few minutes to land.`);
        case 'failed':
          return text(`PAYMENT_FAILED for ${order.reference}: ${order.gatewayResponse || 'declined'}. The customer was not charged. They can try again with the same link (${order.paymentUrl}) or another card or bank.`);
        case 'amount_mismatch':
          return text(`NEEDS_REVIEW. Paystack shows ${naira(order.paidKobo)} paid but the order total is ${naira(order.totalKobo)}. Do NOT confirm the order. Tell the customer a staff member will check and contact them shortly.`);
        case 'no_link':
          return text(`NO_PAYMENT_LINK. ${order.reference} never got a working payment link, so nothing was charged. Create the order again.`);
      }
    } catch (err) {
      return toolError(err, 'check_payment');
    }
  });

  return server;
}

const app = express();

app.get('/health', (_req, res) => res.json({ ok: true }));

// Chord is the MCP client. Stateless mode: a fresh server per request, nothing to
// lose on restart and nothing shared between concurrent conversations.
app.post('/mcp', express.json({ limit: '256kb' }), async (req, res) => {
  const auth = req.get('authorization') || '';
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(MCP_TOKEN);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    log('mcp_unauthorized', { ip: req.ip });
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
  }
  // Arguments are logged to debug how the MCP client shapes tool calls. Test data only.
  log('mcp_request', { method: req.body?.method, tool: req.body?.params?.name, args: req.body?.params?.arguments });
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log('mcp_crash', { message: err.message });
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));

// Paystack pushes charge.success here, so an order is marked paid even if the
// customer never comes back to the chat. Signature is HMAC-SHA512 of the raw body.
app.post('/paystack/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const sig = req.get('x-paystack-signature') || '';
  const expected = createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.body).digest('hex');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    log('webhook_bad_signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // ack first; Paystack retries on slow responses
  let evt;
  try { evt = JSON.parse(req.body.toString('utf8')); } catch { return; }
  const ref = evt?.data?.reference;
  log('webhook', { event: evt?.event, reference: ref });
  if (evt?.event === 'charge.success' && store.get(ref)) {
    // Re-verify rather than trusting the payload's amount.
    try { await orders.checkPayment(ref); } catch (err) { log('webhook_verify_failed', { reference: ref, message: err.message }); }
  }
});

// Owner's kitchen board: paid orders to cook, plus anything needing a human.
app.get('/kitchen', (req, res) => {
  const [, b64 = ''] = (req.get('authorization') || '').split(' ');
  const pass = Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':');
  if (!KITCHEN_PASSWORD || pass !== KITCHEN_PASSWORD) {
    return res.set('WWW-Authenticate', 'Basic realm="kitchen"').sendStatus(401);
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const rows = store.all().slice(0, 100).map((o) => `<tr class="${esc(o.status)}"><td>${esc(o.createdAt.slice(11, 16))}</td><td>${esc(o.reference)}</td><td>${esc(o.status)}</td><td>${esc(o.customer.name)}<br>${esc(o.customer.phone)}</td><td>${o.lines.map((l) => `${l.quantity} x ${esc(l.name)}`).join('<br>')}${o.notes ? `<br><i>${esc(o.notes)}</i>` : ''}</td><td>${esc(o.zone.name)}<br>${esc(o.address)}</td><td>${naira(o.totalKobo)}</td></tr>`).join('');
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Kitchen board</title>
<style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}.paid{background:#e8f7ec}.needs_review,.payment_failed,.link_failed{background:#fdecea}</style>
<h1>Mama Tee's Kitchen: orders</h1><p>Green = paid, cook it. Red = needs a human. Refreshes every 30s.</p>
<table><tr><th>Time (UTC)</th><th>Ref</th><th>Status</th><th>Customer</th><th>Items</th><th>Delivery</th><th>Total</th></tr>${rows}</table>`);
});

app.listen(Number(PORT), () => log('listening', { port: Number(PORT) }));
