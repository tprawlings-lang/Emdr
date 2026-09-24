# The accessibility walkthrough

**What this is.** A script for the one job that is holding real participants
out of Steady. Somebody has to use the product with a keyboard and a screen
reader, do the things a clinician and a person actually do, and write down what
happened. This sheet is so that person does not have to invent the method.

**What it is not.** It is not a substitute for doing it, and nothing here can
be signed on somebody's behalf. The gate is `accessibility` on
`/review/release`, and until a person has done this and signed it, the signup
path refuses a real participant — not as a policy people could choose to
ignore, but because the code reads the gate and says no.

---

## Before you start

**What is already covered, so you do not spend your time on it.** An automated
scan (`tests/e2e/a11y.spec.ts` and `tests/e2e/a11y-signed-in.spec.ts`) runs
over every public and signed-in route on every build and finds no serious or
critical violation. That is real evidence and it covers the machine-checkable
part: missing labels, colour contrast, landmark structure, duplicate ids.

**What it cannot tell you, which is what you are here for:** whether a person
who cannot see the screen can actually finish a task. A page can pass every
automated rule and still be impossible to use — focus that jumps somewhere
unexpected after a form submits, a confirmation nobody is told about, a list
whose order makes no sense read aloud.

**What you need:**

- A keyboard. **Put the mouse away** — not "avoid using it", physically move it.
- A screen reader. Any of VoiceOver (Mac, ⌘F5), NVDA (Windows, free), or
  Narrator (Windows, ⊞Ctrl+Enter). One is enough.
- The demo logins: `clinician.demo@steady.local` / `clinician1234` and
  `patient.demo@steady.local` / `patient1234`.
- Somewhere to write. The recording sheet is at the end of this document.

**Set aside 90 minutes.** It takes about that, and rushing it produces a
signature rather than a finding.

---

## Part one — the clinician, keyboard only

Do each task without touching the mouse. For each one write down: **did you
finish it, and what got in the way.**

1. **Sign in.** From the login page, reach both fields and the button with Tab
   and submit with Enter.
2. **Read the queue.** From `/clinician/today`, move through the rows. Can you
   tell, without looking, which bucket a row is in and why it is there?
3. **Open a row's detail.** Press the row. *Where does focus go?* If it stays
   where it was, you have just been given information you cannot find.
4. **Switch buckets.** Use the bucket filters at the top of the queue. Can you
   tell which one is currently selected?
5. **Record a contact attempt** on a row that offers it. Reach the button, the
   text box and the confirm button, and then find the confirmation afterwards.
6. **Open a person's record** and move to their Care screen.
7. **Assign support** on the Care screen: open the form, choose what, choose
   what it is working towards, write the words the person will read, and
   submit.
8. **Adjust the plan link** on an assignment you just made — change which goal
   it is working towards, and find the confirmation.
9. **Recover from a refusal.** Submit the assign form with the explanation left
   too short. *Is the refusal announced? Can you get back to the field it is
   about?* This one matters more than any of the others and is the one most
   products fail.

## Part two — the person, keyboard only

10. **Sign in** as the member.
11. **Read what your care team asked for** on `/app/today`. Can you hear who
    asked, why, what it is towards, how long it takes, what it shares and until
    when?
12. **Start the assigned activity** and go through at least two steps.
13. **Stop halfway** and leave. Then come back and find your place again.
14. **Do a check-in.**
15. **Reach crisis support** from wherever you are, at any point.

## Part three — the screen reader

Turn the screen reader on and repeat tasks 2, 3, 5, 9, 11 and 15. For each,
write down:

- **Headings.** Pull up the heading list. Does it describe the page, or is it a
  list of words?
- **Landmarks.** Can you jump to the main content, the navigation, the footer?
- **Announcements.** When something changes without the page reloading — a
  confirmation, a refusal, a panel opening — *are you told?* Silence here is
  the most common serious failure and the automated scan cannot see it.
- **Order.** Is what you hear the order the page means?

## Part four — the things people forget

16. **Zoom to 200%** (⌘/Ctrl and `+`) and redo task 2. Does anything overlap,
    get cut off, or need sideways scrolling?
17. **Narrow the window** to phone width and redo task 11.
18. **Control size.** Is anything you have to press smaller than your
    fingertip?
19. **Signing in again after being signed out.** Get signed out mid-task and
    come back.

---

## What to write down

For every task: **finished / finished with difficulty / could not finish**, and
one sentence on why. A task you finished with difficulty is a finding — write
the difficulty down rather than rounding it up to a pass.

For anything that blocked you, note: which screen, what you were doing, what
you expected, what happened.

**Do not fix anything while you are testing.** Write it down and keep going. A
walkthrough that turns into a debugging session stops being a walkthrough.

---

## When you are done

1. Put this sheet, filled in, somewhere the release record can point at it.
2. Sign the `accessibility` gate on `/review/release`. The signature records
   who you are and when, and it expires if the evidence underneath it moves.
3. If you found anything that blocks a keyboard or screen-reader path, **do not
   sign it.** The gate's own blocking condition is "any blocked keyboard or
   screen-reader path". Report what you found, let it be fixed, and come back.

---

## Sign-off

**I operated Steady with a keyboard only and with a screen reader, completed
the tasks above, and recorded what happened.**

Blocked keyboard or screen-reader paths found: ☐ none ☐ listed above

Name: ______________________________

Role: ______________________________

Date: ______________________________

Signature: __________________________
