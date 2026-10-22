# Deployment field notes

Three problems that would hurt the next builder, then shorter ones. Request ids
are Chord `X-Request-Id`s; full responses are in [`field-notes-log.md`](field-notes-log.md).

## 1. One escalation silently mutes a customer for good

**What happened.** My first test message reached the teammate before its tools
were connected, so it correctly handed over to a human. Later, with the tools
live, I messaged as the same customer with a **new** `session_id`
(`order-104236`). I got `200 {"agent_invoked":false,"reason":"no_reply"}` in 1.3s
(request `3d907866-54c5-434f-8eff-d46bc3bbe85f`) and no reply.

**How I found the cause.** `GET /v1/threads?workspace_id=…` had no thread for
the new session at all. Reading the turns of the old thread
(`6ad9d3a94c772d0e6f520321`, session `smoke-1`, `control_state: human_active`)
showed my new message appended there as its third turn. The docs say a new
`session_id` starts a fresh conversation; for a held thread it doesn't.

**Fix.** `POST /v1/threads/6ad9d3a94c772d0e6f520321/hand-back` (request
`3dd1abd1-4355-4f6e-9bee-b28003908085`), then a new session worked.

**What I'd change in Chord.** On WhatsApp the `sender_id` is the phone number, so
one unresolved escalation means that customer gets silence on every future
order, with nothing telling the business. Either honour `session_id` for held
threads, or return `reason: "human_active"` with the `thread_id` the message was
routed to, and fire a webhook when a held thread receives new customer messages.
At minimum, document the behaviour next to the `session_id` field.

## 2. `no_reply` hides the diagnosis Chord already has, and the customer sees nothing

**What happened.** The first message returned
`{"agent_invoked":false,"reason":"no_reply","thread_id":null,"steps":null}` after
10.8s (request `6f8c9e32-31ac-4b8b-bb7b-a1b5a9e6cb06`).

**How I found the cause.** The Chat docs list four causes behind `no_reply` and
suggest finding the thread by sender and session. That took three calls: list
threads, find it, read turns. The system turn there had the real reason in
`metadata.handover_reason`: *"The menu/order tools (get_menu, create_order,
check_payment) are not available in this session…"*. The same turn also showed the
customer-facing acknowledgement ("One moment — connecting you with a teammate.")
with `delivery_status: failed`, `delivery_error: "External chat is not configured
for workspace ws-43fa55ba-…"`. The message arrived on the request/response API,
but the ack was routed to the async bridge this workspace never set up.

**Fix.** Nothing to fix on my side (the agent was right to escalate). I added
request-id logging to every Chord call so the next one would take seconds.

**What I'd change in Chord.** Put `handover_reason` and `thread_id` in the
response when the teammate escalates, and use distinct reasons (`escalated`,
`human_active`, `duplicate`, `silent`). For turns that came in on the sync
endpoint, return the handover acknowledgement as `reply` instead of trying a
bridge that may not exist; otherwise the customer is left with silence.

## 3. The trace hides the phone number and calls it a card number

**What happened.** The first `create_order` call failed validation
(`MCP error -32602 … received undefined at items[0].item_id`). Chord's
`steps[].instruction` showed the exact arguments, which made the cause obvious:
the model sent `id` because my `get_menu` output labelled items `[id: …]`. I
relabelled them `[item_id: …]` and made the server accept both. The same trace
showed `"customer_phone" : "[REDACTED:card]"`.

**How I found the cause.** I compared with the order my server stored: it had
`2348031234567` intact, so only the trace is redacted. A 13-digit Nigerian
mobile number matches a naive card-number pattern.

**Workaround.** None needed for the demo; worth knowing when reading traces.

**What I'd change in Chord.** Run a Luhn check before tagging something as a
card, and recognise E.164 phone numbers. For WhatsApp businesses the phone is the
customer's identity; operators need to see it, or at least a stable masked
form like `234803•••4567`, to follow up an order.

## Smaller things

- **MCP server display name is baked into tool names.** Tools reach the model as
  `mcp__Mama_Tee_s_Kitchen_orders__get_menu`. Renaming the server renames every
  tool. A doc line would help; a stable server slug would be better.
- **Capabilities all `false` on a new teammate.** `POST /v1/teammates` returned
  every `capabilities.*` and `allowed_actions.*` as `false` (request
  `4804efd7-972d-4ffd-ad3e-68802c8433ae`). MCP tools still worked, but the docs
  don't say which flags gate what, so I lost time checking.
- **No way to read the workspace id.** There is no `GET /v1/workspaces`; I found
  it on a teammate record. A `GET /v1/me` returning tenant, workspaces and the
  key's scopes would make the Quickstart's step 1 self-serve.
- **The model can't be chosen.** The brief lists "a model" as one of a teammate's
  four parts, but the public `model` field is retired (`MODEL_OVERRIDE_RETIRED`)
  and the API has no other model setting. If model choice is a product
  feature, the API doesn't expose it.
- **Cost visibility is good.** `GET /v1/usage` showed 6 turns = 0.54 credits
  (~27k prompt tokens a turn), enough to plan testing within the 50 credits.

## On my side (not Chord)

- `EACCES … /data/orders.json.tmp`: container runs as `node`, but Docker created
  the volume owned by root. Fixed with `mkdir /data && chown node` in the Dockerfile.
  The tool returned a clean `INTERNAL_ERROR` ("nothing was charged") rather than crashing.
- Paystack rejects `wa<phone>@customers.mamatees.test` (`"email" must be a valid
  email`). WhatsApp customers have no email, so I use `@example.com`, a
  reserved domain, so receipts can't reach a stranger.
- The VPS was briefly unreachable from my network (all ports filtered); it came
  back without changes on my side.
