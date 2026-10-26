# Recording the 3-minute demo

## Set up (5 minutes, before you press record)

1. **Close everything else.** Turn on Do Not Disturb (GNOME: click the clock →
   Do Not Disturb) so no notifications pop up.
2. **Browser window, left half of the screen**, with three tabs:
   - Simulator: https://chat.tsglabs.dev/c/rhicSkBeePRgPGRH5CL6qrap (press
     *reset* if an old chat is showing).
   - Kitchen board: https://foodagent.devomogo.tech/kitchen (log in once now; any
     username, password = `KITCHEN_PASSWORD` in `.env`).
   - The GitHub repo, scrolled to the problem statement.
   Zoom the simulator to 125% (Ctrl +) so the text reads on video.
3. **Terminal, right half of the screen**, font enlarged (Ctrl +):
   `cd ~/Documents/chord-food-agent && scripts/watch.sh`
   This prints one line per tool action: what Chord asked for, and what Paystack said.
4. **Have the test card ready to paste**: `4084 0840 8408 4081`, expiry `12/30`,
   CVV `408`, PIN `0000`, OTP `123456`.
5. Do one silent practice run first. It costs about 1 credit.

## Record

Use **SimpleScreenRecorder** (installed): *Record the entire screen*, 30 fps,
tick *Record audio* with your mic, output MP4 (H.264, AAC). Start, then hide its
window. (OBS also works if you prefer it.)

Speak to the reviewer, not the screen. Short sentences. It's fine to keep typing
while you talk.

| Time | Do | Say (roughly) |
| --- | --- | --- |
| 0:00 | Repo tab, problem statement | "I'm applying for forward-deployed engineering. Mama Tee's Kitchen is a Lagos food vendor taking orders on WhatsApp. The owner spends hours quoting prices and checking transfer screenshots, and fake debit alerts cost her real money." |
| 0:20 | Simulator: start chat, send *"Good afternoon, what do you have today?"* | "Tee is a Chord teammate with a skill I wrote and a custom tool on my server." Point at the terminal: "That's Chord calling get_menu; prices come from the server, not the model." |
| 0:45 | *"2 jollof and 2 zobo, deliver to Akoka"*, then the address, your name, a test number like 08031234567, then *"yes"* | "It maps Akoka to the Yaba delivery zone and reads the order back before doing anything." |
| 1:20 | Reply arrives with total and Paystack link | **"This is the tool doing its job."** Point at the terminal: "create_order priced the cart on the server and created a real Paystack test transaction. The model never does arithmetic on money." |
| 1:40 | Before paying, send *"paid, check your alert"* | "This is the fake-alert case. Tee asks Paystack, Paystack says not paid, so no food leaves the kitchen." Point at `Paystack says: PENDING`. |
| 2:00 | Open the link, pay with the test card, land on the return page | "Paystack's webhook just hit my server." Point at `Paystack webhook: charge.success`. |
| 2:20 | Back in the simulator: *"done, I've paid"* | Point at `Paystack says: PAID` and Tee's confirmation. Switch to the kitchen board: "and the order is green for the kitchen." |
| 2:40 | Repo tab: `docs/FIELD-NOTES.md` | "Biggest thing I found: once Chord hands a customer to a human, that customer's later chats on any session land in the held thread and get no reply. Details, request ids and suggested fixes are in the field notes." |

If something goes wrong on camera, such as a slow reply or a tool error, keep
going and say what happened. Handling failure is part of what they're assessing.

## After

- Trim the start and end if needed. Keep it at 3:00 or less.
- Upload to YouTube as **Unlisted** (or Loom / Google Drive with "anyone with the
  link can view"), and open the link in a private window to check it plays.
- Add the link to the top of the README.
