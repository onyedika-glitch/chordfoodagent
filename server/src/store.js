// Orders persisted to one JSON file. Small on purpose: a single vendor does
// tens of orders a day. Writes go to a temp file and are renamed, so a crash
// mid-write can't corrupt the store.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createStore(file) {
  let orders = {};
  if (file) {
    try {
      orders = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(orders, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  return {
    get: (ref) => orders[ref],
    put(order) {
      orders[order.reference] = order;
      persist();
      return order;
    },
    update(ref, patch) {
      if (!orders[ref]) return undefined;
      orders[ref] = { ...orders[ref], ...patch, updatedAt: new Date().toISOString() };
      persist();
      return orders[ref];
    },
    all: () => Object.values(orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}
