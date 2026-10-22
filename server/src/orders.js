// Order logic, kept free of HTTP/MCP so it can be tested with a fake Paystack.
import { createHash, randomBytes } from 'node:crypto';
import { BUSINESS, MENU, ZONES, soldOut, naira, isOpen } from './menu.js';

const REUSE_PENDING_MS = 30 * 60 * 1000;

export class OrderError extends Error {}

export function menuText() {
  const out = soldOut();
  const lines = [`${BUSINESS.name}: today's menu (prices in naira)`];
  for (const cat of ['mains', 'sides', 'drinks']) {
    lines.push(`\n${cat.toUpperCase()}`);
    for (const m of MENU.filter((i) => i.category === cat)) {
      lines.push(`- ${m.name}: ${naira(m.priceKobo)} [item_id: ${m.id}]${out.has(m.id) ? ' (SOLD OUT today)' : ''}`);
    }
  }
  lines.push('\nDELIVERY ZONES');
  for (const z of ZONES) lines.push(`- ${z.name}: ${z.feeKobo ? naira(z.feeKobo) : 'free'}, about ${z.eta} [delivery_zone: ${z.id}]`);
  lines.push(`\nMinimum order (food only): ${naira(BUSINESS.minOrderKobo)}. Orders ${BUSINESS.opens}-${BUSINESS.lastOrder} Lagos time.`);
  lines.push(`Kitchen is ${isOpen() ? 'OPEN' : 'CLOSED'} right now.`);
  return lines.join('\n');
}

export function priceOrder(items, zoneId) {
  if (!Array.isArray(items) || items.length === 0) throw new OrderError('The order has no items.');
  const zone = ZONES.find((z) => z.id === zoneId);
  if (!zone) throw new OrderError(`Unknown delivery zone "${zoneId}". Valid zones: ${ZONES.map((z) => z.id).join(', ')}.`);

  const out = soldOut();
  const merged = new Map();
  for (const { item_id, quantity } of items) {
    const m = MENU.find((i) => i.id === item_id);
    if (!m) throw new OrderError(`"${item_id}" is not on the menu. Call get_menu and use an exact item id.`);
    if (out.has(m.id)) throw new OrderError(`${m.name} is sold out today. Ask the customer to pick something else.`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new OrderError(`Quantity for ${m.name} must be a whole number from 1 to 20.`);
    }
    merged.set(m.id, (merged.get(m.id) || 0) + quantity);
  }

  const lines = [...merged].map(([id, qty]) => {
    const m = MENU.find((i) => i.id === id);
    return { item_id: id, name: m.name, quantity: qty, unitKobo: m.priceKobo, lineKobo: m.priceKobo * qty };
  });
  const subtotalKobo = lines.reduce((s, l) => s + l.lineKobo, 0);
  if (subtotalKobo < BUSINESS.minOrderKobo) {
    throw new OrderError(`Food subtotal is ${naira(subtotalKobo)}; the minimum order is ${naira(BUSINESS.minOrderKobo)}.`);
  }
  return { lines, zone, subtotalKobo, deliveryKobo: zone.feeKobo, totalKobo: subtotalKobo + zone.feeKobo };
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  if (/^\d{8,15}$/.test(digits)) return digits; // accept other countries as-is
  throw new OrderError('The phone number looks wrong. Ask for an 11-digit Nigerian number such as 08031234567.');
}

export function summary(order) {
  const items = order.lines.map((l) => `${l.quantity} x ${l.name} = ${naira(l.lineKobo)}`).join('\n');
  return `${items}\nDelivery (${order.zone.name}): ${order.deliveryKobo ? naira(order.deliveryKobo) : 'free'}\nTOTAL: ${naira(order.totalKobo)}`;
}

export function createOrderService({ paystack, store, emailDomain, callbackUrl, now = () => new Date() }) {
  async function createOrder(input) {
    if (!isOpen(now())) {
      throw new OrderError(`The kitchen is closed. We take orders ${BUSINESS.opens}-${BUSINESS.lastOrder} Lagos time.`);
    }
    const phone = normalizePhone(input.customer_phone);
    const name = String(input.customer_name || '').trim();
    if (!name) throw new OrderError("Ask the customer's name before creating the order.");
    const address = String(input.delivery_address || '').trim();
    if (input.delivery_zone !== 'pickup' && address.length < 8) {
      throw new OrderError('A delivery order needs a full street address with a landmark.');
    }
    const priced = priceOrder(input.items, input.delivery_zone);

    // The model sometimes calls the tool twice for one order (retries, or the customer
    // repeating "yes"). Same customer + same cart within 30 min: hand back the same link.
    const cartKey = createHash('sha256')
      .update(JSON.stringify([phone, priced.lines.map((l) => [l.item_id, l.quantity]), priced.zone.id, address]))
      .digest('hex').slice(0, 16);
    const existing = store.all().find((o) => o.cartKey === cartKey && o.status === 'awaiting_payment'
      && now() - new Date(o.createdAt) < REUSE_PENDING_MS);
    if (existing) return { order: existing, reused: true };

    const reference = `MTK-${now().toISOString().slice(2, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const email = input.customer_email?.includes('@') ? input.customer_email.trim() : `wa${phone}@${emailDomain}`;

    const order = {
      reference, cartKey, status: 'creating', customer: { name, phone, email },
      ...priced, address, notes: String(input.notes || '').slice(0, 300),
      createdAt: now().toISOString(),
    };
    store.put(order);

    let tx;
    try {
      tx = await paystack.initialize({
        email, amount: priced.totalKobo, currency: 'NGN', reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        channels: ['card', 'bank_transfer', 'ussd', 'bank'],
        metadata: {
          order_reference: reference,
          custom_fields: [
            { display_name: 'Customer', variable_name: 'customer', value: name },
            { display_name: 'WhatsApp', variable_name: 'phone', value: phone },
            { display_name: 'Zone', variable_name: 'zone', value: priced.zone.id },
          ],
        },
      });
    } catch (err) {
      store.update(reference, { status: 'link_failed', error: err.message });
      throw err;
    }
    return { order: store.update(reference, { status: 'awaiting_payment', paymentUrl: tx.authorization_url }), reused: false };
  }

  // Ask Paystack (never the customer's screenshot) whether the order is paid.
  async function checkPayment(reference) {
    const ref = String(reference || '').trim().toUpperCase();
    const order = store.get(ref);
    if (!order) throw new OrderError(`No order with reference ${ref}. Check the reference from the payment message.`);
    if (order.status === 'paid') return { order, outcome: 'paid' };
    if (order.status === 'link_failed') return { order, outcome: 'no_link' };

    const tx = await paystack.verify(ref);
    const record = { paystackStatus: tx.status, gatewayResponse: tx.gateway_response, checkedAt: now().toISOString() };

    if (tx.status === 'success') {
      // Paid, but for the right amount? Guards against a tampered or reused reference.
      if (tx.amount !== order.totalKobo || tx.currency !== 'NGN') {
        return { order: store.update(ref, { ...record, status: 'needs_review', paidKobo: tx.amount }), outcome: 'amount_mismatch' };
      }
      return { order: store.update(ref, { ...record, status: 'paid', paidAt: tx.paid_at || now().toISOString(), channel: tx.channel }), outcome: 'paid' };
    }
    if (tx.status === 'failed' || tx.status === 'reversed') {
      return { order: store.update(ref, { ...record, status: 'payment_failed' }), outcome: 'failed' };
    }
    // "abandoned" on Paystack also covers links that were never opened, so treat
    // it as not-yet-paid rather than as the customer walking away.
    return { order: store.update(ref, record), outcome: 'pending' };
  }

  return { createOrder, checkPayment };
}
