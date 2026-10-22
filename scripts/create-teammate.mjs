// One-off: create the "Tee" teammate for Mama Tee's Kitchen. Idempotent via creation_request_id.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
const res = await fetch('https://api.chordhq.xyz/v1/teammates', {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.CHORD_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'tee-orders@mamatees.test',
    first_name: 'Tee', last_name: 'Orders', display_name: "Tee (Mama Tee's Kitchen)",
    role: 'order_desk', autonomy: 'collaborative', escalation_policy: 'escalate_to_human',
    workspace_id: env.CHORD_WORKSPACE_ID, creation_request_id: 'mamatee-tee-v1',
  }),
});
console.log(res.status, res.headers.get('x-request-id'));
console.log(JSON.stringify(await res.json(), null, 2));
