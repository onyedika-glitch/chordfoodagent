# Raw field-notes log (evidence as it happened; the polished notes come from this)

## 1. First message returned `no_reply` with no reason (2026-10-22 09:12 UTC)

- What happened: `POST /v1/external-chat/messages` to the new teammate returned
  `200 {"agent_invoked":false,"reason":"no_reply","thread_id":null,"steps":null}`
  after 10.8s. Request id `6f8c9e32-31ac-4b8b-bb7b-a1b5a9e6cb06`.
- How I found the cause: docs say `no_reply` covers four cases and to look up the
  thread by sender_id/session_id. `GET /v1/threads?workspace_id=…` showed
  `control_state: human_active`. `GET /v1/threads/6ad9d3a94c772d0e6f520321/turns`
  had a system turn with `metadata.handover_reason`: "The menu/order tools
  (get_menu, create_order, check_payment) are not available in this session…".
  The skill was live and correctly refused to guess prices; the MCP server simply
  wasn't registered yet.
- Fix: expected (tools not connected yet). Register MCP server, then use a new session_id.
- Chord suggestion: return `handover_reason` (and the thread_id) in the chat response
  when the teammate escalates; it already exists, and today it costs three extra
  calls and a docs read to find it. A distinct reason such as `escalated` vs
  `silent` vs `duplicate` vs `human_active` would make the flag a diagnosis.

## 2. Handover acknowledgement failed to deliver on the sync API

- Same turn: the system message "One moment — connecting you with a teammate." has
  `delivery_status: failed`, `delivery_error: "External chat send failed: External
  chat is not configured for workspace ws-43fa55ba-…"`.
- The conversation came in on the request/response surface, but the acknowledgement
  was routed to the async external-chat bridge (callback URL), which this workspace
  never configured. The caller got neither the ack text nor an error.
- Chord suggestion: for turns that arrived on the sync endpoint, return the handover
  acknowledgement as `reply` instead of sending it through the bridge.

## 3. New teammate created via API has every capability false

- `POST /v1/teammates` with `autonomy: collaborative` returned `capabilities.*` and
  `allowed_actions.*` all `false` (incl. `execute_routine`). Request id
  `4804efd7-972d-4ffd-ad3e-68802c8433ae`. It did NOT block MCP
  tool calls (get_menu/create_order/check_payment all ran), so these flags appear
  to be legacy/inbox-connector settings. The docs don't say which flags gate what.

## 4. A new session_id still lands on the old, escalated thread (sticky human_active)

- After finding #1 left thread `6ad9d3a94c772d0e6f520321` (session `smoke-1`) in
  `human_active`, I sent the same customer (`sender_id 2348031234567`) a message
  with a NEW session id `order-104236`. Response: `no_reply` in 1.3s, request id
  `3d907866-54c5-434f-8eff-d46bc3bbe85f`. No new thread was created; the message
  was appended to the old `smoke-1` thread (3rd turn there, `channel_session_id`
  still `smoke-1`).
- Docs (Quickstart, Concepts) say "change session_id to start a fresh conversation".
  In practice, an escalated customer is stuck: every new conversation is swallowed
  by the held thread and nobody answers. On WhatsApp the sender_id is the phone
  number, so this is per-customer and permanent until an operator hands back.
- Found by: listing threads and seeing no thread for the new session id, then
  reading turns of the held one. Fix: `POST /v1/threads/{id}/hand-back`
  (request id `3dd1abd1-4355-4f6e-9bee-b28003908085`), then a new session worked.
- Chord suggestion: honour session_id when the existing thread is held, or return
  `reason: "human_active"` plus the `thread_id` the message was routed to.

## 5. Custom tool (MCP) setup: what worked first time

- Register (disabled) -> set_mcp_server_ids on teammate -> enable with enabled_tools
  -> discovery -> health `{"status":"ok","latency_ms":107}`. Clean; docs accurate.
- Tool names surface to the model as `mcp__Mama_Tee_s_Kitchen_orders__get_menu`:
  the server's display name is baked into the tool name, so renaming the server
  renames every tool (and breaks skills that mention the full name). Worth a doc note.

## 6. Model sent `id` instead of `item_id`; Chord's step log made it diagnosable

- First `create_order` failed: `MCP error -32602 ... expected string, received
  undefined at items[0].item_id`. The model retried and succeeded on its own.
- The response `steps[].instruction` contained the exact arguments sent:
  `items: [{"id":"jollof-chicken",...}]`. Cause was mine: get_menu printed
  `[id: jollof-chicken]`. Fixed by labelling `[item_id: …]` and accepting `id`.
- Good: the steps array made this a 2-minute fix. Bad: see #7.

## 7. PII redaction labels a phone number as a card number

- In the same step, `"customer_phone" : "[REDACTED:card]"`. The value was
  `2348031234567` (13 digits, a Nigerian MSISDN); the tool received it intact
  (confirmed in our order store), so only the trace is redacted.
- Chord suggestion: run a Luhn check before tagging something as a card, and
  recognise E.164 numbers; for a WhatsApp-first product the phone is the main
  identifier and operators need to see it (or a stable masked form) in traces.

## 8. Deploy issues on my side (not Chord)

- `EACCES: permission denied, open '/data/orders.json.tmp'`: container runs as
  `node`, named volume created root-owned. Fixed by `mkdir /data && chown` in the
  Dockerfile before `USER node`, then recreated the volume. Tool returned a clean
  INTERNAL_ERROR ("nothing was charged") rather than crashing.
- Paystack `"email" must be a valid email`: WhatsApp customers have no email but
  Paystack requires one; `.test` placeholder domain rejected. Switched to
  `wa<phone>@example.com` (reserved domain, receipts can't reach a stranger).

## Usage so far

- 6 chat requests = 0.54 credits (~0.09/turn), ~27k prompt tokens per turn
  (skill + reference files + tool schemas + history).

## 9. Paystack would not save the sslip.io webhook URL (2026-10-22 ~10:05 UTC)

- No Paystack request in nginx access log or app log: rejected client-side.
- Added GET 200 on /paystack/webhook (some validators probe), then moved to
  foodagent.devomogo.tech (A record → VPS), certbot --expand on cert "mamatee",
  Chord MCP url updated via PUT; discovery + health ok (109 ms).
