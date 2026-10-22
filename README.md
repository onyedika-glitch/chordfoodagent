# Tee: a WhatsApp order desk for a Lagos food vendor, built on Chord

**Role:** Forward-deployed Engineering

**Problem statement.** Mama Tee's Kitchen (a fictional but typical Yaba food
vendor doing 60-90 WhatsApp orders a day) loses the owner 3-4 hours a day to
quoting prices, sending bank details and checking transfer screenshots, and loses
real money to fake "debit alert" screenshots. Tee takes the order on WhatsApp,
prices it on the server, sends a Paystack payment link and only releases the
order to the kitchen once Paystack itself confirms payment, so a screenshot can
never get food out of the door. That's worth paying for because it removes the
owner's most repetitive work and closes the fraud gap at the same time. I left
out rider dispatch, refunds, order changes after payment and a real WhatsApp
number; complaints, refunds, allergies and bulk orders go to a human.

| Deliverable | Where |
| --- | --- |
| Live agent | Chord teammate **"Tee (Mama Tee's Kitchen)"** (`90bcdae1-8b91-413b-8c39-1be43dc77b17`), test it in the WhatsApp simulator |
| Skill files | [`skill/mama-tee-orders/`](skill/mama-tee-orders) |
| Custom tool (MCP server) | [`server/`](server), live at `https://mamatee.186-240-148-169.sslip.io/mcp` |
| Deployment field notes | [`docs/FIELD-NOTES.md`](docs/FIELD-NOTES.md) (raw evidence log: [`docs/field-notes-log.md`](docs/field-notes-log.md)) |
| Go-live note for the owner | [`docs/GO-LIVE.md`](docs/GO-LIVE.md) |
| Recording script | [`docs/RECORDING.md`](docs/RECORDING.md) |

## How it works

```
WhatsApp customer
      │
      ▼
Chord teammate "Tee"  ── skill: mama-tee-orders (order flow, rules, business context)
      │  MCP (Streamable HTTP, bearer token)
      ▼
mama-tees-kitchen MCP server (Node, on a VPS behind nginx + Let's Encrypt)
  ├─ get_menu       menu, prices, sold-out items, zones, open/closed
  ├─ create_order   prices the cart server-side → Paystack /transaction/initialize
  └─ check_payment  Paystack /transaction/verify → PAID / NOT_PAID_YET / FAILED / NEEDS_REVIEW
      ▲
Paystack webhook (charge.success, HMAC-SHA512 verified) → re-verifies, marks paid
/kitchen          password-protected order board for the owner
```

Design choices that matter:

- **The model never computes money.** `create_order` takes item ids and
  quantities; the server prices them from `menu.js` and tells the model the total.
  A hallucinated price can't reach Paystack.
- **Only Paystack is proof of payment.** `check_payment` verifies with Paystack
  and also checks the amount and currency against the order, so a reused or
  tampered reference comes back as `NEEDS_REVIEW`, not `PAID`.
- **Errors come back as instructions, not stack traces.** Every failure returns
  a coded message (`ORDER_INVALID`, `PAYMENT_PROVIDER_UNAVAILABLE`,
  `PAYMENT_PROVIDER_REJECTED`, `INTERNAL_ERROR`) telling the agent what to say,
  always including whether the customer was charged. The skill maps each code to
  a behaviour.
- **Duplicate-safe.** If the model calls `create_order` twice for the same cart
  within 30 minutes, it gets the same link back, not a second charge.
- **Paystack's "abandoned" is treated as unpaid**, because Paystack also reports
  never-opened links as abandoned.
- **Refuses live keys** unless `ALLOW_LIVE_KEYS=1`.

## Run it

Requirements: Node 20+, a Paystack **test** secret key, a Chord API key.

```bash
cp .env.example .env              # fill in keys; MCP_TOKEN: openssl rand -hex 24
cd server && npm ci && npm test   # 7 unit tests, fake Paystack
set -a; . ../.env; set +a; ALWAYS_OPEN=1 npm start   # http://localhost:8787/mcp

# talk to it the way Chord does
MCP_URL=http://localhost:8787/mcp MCP_TOKEN=... node ../scripts/mcp-smoke.mjs get_menu
```

### Deploy (what I did)

The VPS already runs nginx for other apps, so the container binds to
`127.0.0.1:10020` and nginx proxies a dedicated hostname to it:

```bash
scripts/deploy.sh                               # tar → VPS, docker compose -p mamatee up -d --build, health check
# one-time on the VPS: deploy/nginx-mamatee.conf → sites-enabled, nginx -t, reload, then
certbot --nginx -d mamatee.186-240-148-169.sslip.io --cert-name mamatee
```

### Wire it into Chord

```bash
node scripts/create-teammate.mjs      # one-off: creates the "Tee" teammate
node scripts/chord.mjs skill          # upload + publish skill/mama-tee-orders
node scripts/chord.mjs mcp-register   # register the MCP server (disabled); put the id in .env
node scripts/chord.mjs assign         # restrict the teammate to this server
node scripts/chord.mjs mcp-enable     # enable, discover tools, health probe
node scripts/chord.mjs chat "Good afternoon, what do you have today?" my-session
```

Every Chord call is appended to `logs/chord-api.log` with its request id;
that log is where the field notes came from.

## Repo layout

```
skill/mama-tee-orders/     SKILL.md + references/business.md, references/examples.md
server/src/                index.js (HTTP + MCP + webhook + kitchen board), orders.js,
                           paystack.js, menu.js, store.js
server/test/               unit tests with a fake Paystack
scripts/                   chord.mjs (Chord setup CLI), mcp-smoke.mjs, deploy.sh, create-teammate.mjs
deploy/                    docker-compose.yml, nginx-mamatee.conf
docs/                      FIELD-NOTES.md, GO-LIVE.md, RECORDING.md, field-notes-log.md
```

## How I used AI tools

I worked with Claude Code (Claude Opus) as a pair: it read the Chord docs and
OpenAPI spec, drafted the MCP server, skill and scripts, ran the Chord API
calls and deployment over SSH, and kept the evidence log as problems came up. I
chose the problem, role and hosting, made the product decisions (server-side
pricing, screenshot policy, escalation list), reviewed the code, and did the
browser-side steps (Paystack checkout, simulator sign-in). The agent itself runs entirely on Chord;
Chord picks the model.
