# Going live with Tee: a note for Mama Tee

**What Tee does.** Tee answers your WhatsApp orders around the clock while the
kitchen is open. It shows today's menu, takes the order and address, sends the
customer a Paystack payment link, and confirms the order only when Paystack
says the money has arrived. Paid orders appear in green on your kitchen board
(`/kitchen` link, refreshes every 30 seconds). Screenshots and "I've sent it"
messages are never accepted as payment, so fake alerts stop working.

**What Tee doesn't do.** It doesn't give discounts, take pay-on-delivery,
change or cancel paid orders, issue refunds, book riders, or answer allergy
questions. Complaints, refunds, allergies, orders above 20 plates and anyone
asking for a person are handed to your team.

**Before real customers use it:**

1. **Your Paystack account.** Finish Paystack business verification, switch the
   server to your live secret key, and set the live webhook URL in Paystack. Do
   one real ₦100 order end to end before announcing anything.
2. **A WhatsApp number.** Connect a WhatsApp Business number to Tee in Chord.
   Use a new number at first and keep your current one for staff, so you can
   switch back in a minute.
3. **Your real menu and fees.** Check the prices, delivery zones and hours. Sold-out
   items can be switched off without code (tell your tech person the item name).
4. **Who gets told when something goes wrong.** Name one person (and a backup)
   whose phone gets the alert when Tee hands over a conversation or a payment
   needs checking. A handed-over customer gets no reply from Tee until that
   person hands the chat back, so someone must check at least every 15 minutes
   during opening hours.
5. **When a payment fails.** The customer is told they were not charged and is
   sent the link again. If Paystack is down, Tee says a staff member will follow
   up, and the order shows red on the board. Decide who calls those customers.
6. **Money checks.** Each evening, compare the green orders on the board with
   your Paystack settlement. Any order marked "needs review" (wrong amount paid)
   must be checked by hand before cooking.
7. **Back-ups and monitoring.** Back up the order file daily and set an uptime
   alert on the server's `/health` page.

**Trial plan.** Run Tee for one week on lunch orders only, with a staff member
reading along, then extend to dinner. Track hours saved and orders paid
without staff help.
