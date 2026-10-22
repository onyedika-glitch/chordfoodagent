import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrderService, priceOrder, normalizePhone, OrderError } from '../src/orders.js';
import { createStore } from '../src/store.js';
import { PaystackError } from '../src/paystack.js';

process.env.ALWAYS_OPEN = '1';

function fakePaystack({ verifyResult, initError } = {}) {
  const calls = [];
  return {
    calls,
    async initialize(p) {
      calls.push(['init', p]);
      if (initError) throw initError;
      return { authorization_url: `https://checkout.paystack.com/${p.reference}`, reference: p.reference };
    },
    async verify(ref) {
      calls.push(['verify', ref]);
      return typeof verifyResult === 'function' ? verifyResult(ref) : verifyResult;
    },
  };
}

const order = {
  customer_name: 'Ada', customer_phone: '0803 123 4567',
  items: [{ item_id: 'jollof-chicken', quantity: 2 }, { item_id: 'zobo', quantity: 2 }],
  delivery_zone: 'yaba-surulere', delivery_address: '12 Alagomeji St, by the church',
};

test('server prices the order; the model cannot', () => {
  const p = priceOrder(order.items, 'yaba-surulere');
  assert.equal(p.subtotalKobo, 2 * 450000 + 2 * 70000);
  assert.equal(p.totalKobo, p.subtotalKobo + 150000);
});

test('rejects unknown, sold-out and under-minimum orders', () => {
  assert.throws(() => priceOrder([{ item_id: 'shawarma', quantity: 1 }], 'pickup'), OrderError);
  assert.throws(() => priceOrder([{ item_id: 'poundo-egusi', quantity: 1 }], 'pickup'), /sold out/);
  assert.throws(() => priceOrder([{ item_id: 'zobo', quantity: 1 }], 'pickup'), /minimum/);
  assert.throws(() => priceOrder([{ item_id: 'zobo', quantity: 0 }], 'pickup'), /whole number/);
});

test('normalizes Nigerian numbers', () => {
  assert.equal(normalizePhone('0803 123 4567'), '2348031234567');
  assert.equal(normalizePhone('+234 803 123 4567'), '2348031234567');
  assert.throws(() => normalizePhone('123'), OrderError);
});

test('creates a Paystack transaction for the server-computed amount', async () => {
  const paystack = fakePaystack();
  const svc = createOrderService({ paystack, store: createStore(), emailDomain: 'x.test' });
  const { order: o } = await svc.createOrder(order);
  const [, init] = paystack.calls[0];
  assert.equal(init.amount, o.totalKobo);
  assert.equal(init.email, 'wa2348031234567@x.test');
  assert.match(o.reference, /^MTK-\d{6}-[0-9A-F]{6}$/);
  assert.equal(o.status, 'awaiting_payment');
});

test('a repeated create for the same cart reuses the pending link', async () => {
  const paystack = fakePaystack();
  const svc = createOrderService({ paystack, store: createStore(), emailDomain: 'x.test' });
  const a = await svc.createOrder(order);
  const b = await svc.createOrder(order);
  assert.equal(b.reused, true);
  assert.equal(a.order.reference, b.order.reference);
  assert.equal(paystack.calls.length, 1);
});

test('payment outcomes: success, amount mismatch, failed, abandoned', async () => {
  for (const [tx, outcome, status] of [
    [(o) => ({ status: 'success', amount: o.totalKobo, currency: 'NGN' }), 'paid', 'paid'],
    [() => ({ status: 'success', amount: 100, currency: 'NGN' }), 'amount_mismatch', 'needs_review'],
    [() => ({ status: 'failed', gateway_response: 'Declined' }), 'failed', 'payment_failed'],
    [() => ({ status: 'abandoned' }), 'pending', 'awaiting_payment'],
  ]) {
    const store = createStore();
    let created;
    const paystack = fakePaystack({ verifyResult: () => tx(created) });
    const svc = createOrderService({ paystack, store, emailDomain: 'x.test' });
    created = (await svc.createOrder(order)).order;
    const r = await svc.checkPayment(created.reference.toLowerCase());
    assert.equal(r.outcome, outcome);
    assert.equal(r.order.status, status);
  }
});

test('a Paystack outage leaves the order marked link_failed, not pending', async () => {
  const store = createStore();
  const paystack = fakePaystack({ initError: new PaystackError('Paystack did not respond in time', { retryable: true }) });
  const svc = createOrderService({ paystack, store, emailDomain: 'x.test' });
  await assert.rejects(svc.createOrder(order), PaystackError);
  assert.equal(store.all()[0].status, 'link_failed');
  assert.equal((await svc.checkPayment(store.all()[0].reference)).outcome, 'no_link');
});
