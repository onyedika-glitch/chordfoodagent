# 3-minute recording script

Screen: WhatsApp simulator on the left; on the right, the kitchen board and a
terminal tailing the server log
(`ssh root@<vps> 'docker logs -f mamatee_mcp' | grep -v mcp_request`).

| Time | Show | Say |
| --- | --- | --- |
| 0:00-0:20 | README top | Who Mama Tee is, the problem: price quotes, bank details, fake alerts. |
| 0:20-0:50 | Simulator: "Good afternoon, what do you have today?" | Tee calls `get_menu`; prices come from the server, sold-out item flagged. |
| 0:50-1:20 | "2 jollof and 2 zobo to Akoka" → address, name → "yes" | Tee maps Akoka to the Yaba zone and reads the order back before acting. |
| 1:20-1:45 | Tee's reply with total + Paystack link; log shows `order_created` | **The tool's moment:** the server priced it and created the Paystack transaction. |
| 1:45-2:05 | "Paid, check your alert" (before paying) | Tee checks Paystack, says not yet, resends the link. This is the fake-alert defence. |
| 2:05-2:35 | Pay with test card 4084 0840 8408 4081 / 408 / PIN 0000 / OTP 123456; "done" | `check_payment` → PAID; order turns green on the kitchen board. |
| 2:35-3:00 | `docs/FIELD-NOTES.md` #1 | The biggest Chord finding: one escalation mutes that customer's future chats. |
