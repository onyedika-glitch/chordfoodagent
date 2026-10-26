# Formats the server's JSON log lines into one readable line per action.
import json
import sys

def naira(kobo):
    return "N{:,}".format(kobo // 100)

for line in sys.stdin:
    try:
        e = json.loads(line)
    except ValueError:
        continue
    t, ev = e["t"][11:19], e["event"]
    if ev == "mcp_request" and e.get("method") == "tools/call":
        args = {k: v for k, v in (e.get("args") or {}).items() if k != "customer_phone"}
        print(f"{t}  Chord called {e['tool']}  {json.dumps(args) if args else ''}")
    elif ev == "order_created":
        reused = "  (same link reused)" if e.get("reused") else ""
        print(f"{t}  Paystack link created  {e['reference']}  total {naira(e['totalKobo'])}{reused}")
    elif ev == "payment_checked":
        print(f"{t}  Paystack says: {e['outcome'].upper()}  ({e['reference']}, status {e['paystackStatus']})")
    elif ev == "webhook":
        print(f"{t}  Paystack webhook: {e.get('type')}  {e.get('reference')}")
    elif ev == "callback":
        print(f"{t}  Customer returned from checkout: {e['outcome'].upper()}")
    elif ev in ("paystack_error", "tool_crash", "webhook_bad_signature"):
        print(f"{t}  !! {ev}: {e.get('message', '')}")
    sys.stdout.flush()
