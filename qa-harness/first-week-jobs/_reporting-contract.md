# How to report what happened

This part is the same for every job. Read it once, then do the job.

You are being asked to do a real piece of work in real software. Nobody wants a
tour of the product. What is wanted is an honest account of where a competent
new person would get stuck, and enough proof of each sticking point that
somebody who was not watching can see it for themselves.

## While you work

Work like a person with a job to do, not like a tester. Try the thing you would
try. When it does not work, try the next thing you would try. Give up on a path
only after you have genuinely looked — scrolled the page to the bottom, opened
the menus, read the empty state. **Not scrolling is the single most common way
this exercise produces a false report.**

Keep going after a dead end. One blocked path is not the end of the job; find
another way to the same outcome, and if there is no other way, say so.

Start from the address named in the job, then use only links and controls you
can see. Do not type or construct a route to skip navigation. If the software
does not expose a way to reach the next step, that is the finding.

**Stay on the address you were given.** If it stops answering, wait, retry, and
then report that as the finding and stop. Do not go looking for the software on
another address or another port. There are other, unrelated programs running on
this machine; working in one of those produces a report about software nobody
asked you to look at, and it will be thrown away.

## Capturing evidence, at the moment it happens

The instant you are stuck or surprised — before you navigate anywhere else —
capture two files:

1. **A screenshot** of the page. Save it as `evidence/<finding-id>.png`.
2. **The page snapshot.** Take a page snapshot and write the FULL text you got
   back — the whole tree, exactly as returned, including the line that names the
   page URL — to `evidence/<finding-id>.snapshot.txt`. Copy it; do not summarise
   it, shorten it, or tidy it. It is checked against what the browser recorded,
   and a rewritten one will be thrown out.

If the page is long, the snapshot already contains the whole page whether or not
you scrolled. That is deliberate, and it is how a "I couldn't find it" report
gets checked.

## Write the report as you go, not at the end

**Write `findings.json` after your FIRST finding, and rewrite it after every one
after that.** You have a limited number of steps and you will not be told when
you are near the end. A report written at the end is a report that does not
exist: the first attempt at this exercise captured three screenshots, worked for
five minutes, ran out of steps, and produced nothing at all. Everything it had
learned was thrown away because it was still in its head.

So: get a valid `findings.json` on disk early, even with one rough finding in
it, and improve it as you go. Set `outcomeReached` to where you have got to so
far and update it as that changes.

## The report

`findings.json`, in your working directory. Exactly this shape:

```json
{
  "job": "<the job id you were given>",
  "outcomeReached": "yes | partly | no",
  "whatIDid": "A short plain-English account of the route you took, in order.",
  "whatWouldHaveHelped": "The one thing that would have made this job easy.",
  "findings": [
    {
      "id": "f1",
      "title": "One line, in plain words, naming what went wrong",
      "severity": "blocker | confusing | cosmetic",
      "whatIWasTryingToDo": "In a planner's words, not the software's.",
      "whatHappened": "What the screen actually did.",
      "url": "http://localhost:PORT/the/exact/page",
      "screenshot": "evidence/f1.png",
      "snapshot": "evidence/f1.snapshot.txt",
      "presentText": ["exact text that IS on that page and proves you were there"],
      "absentText": ["exact text you looked for and could NOT find"],
      "reproduce": ["Step 1", "Step 2", "Step 3 — and here is where it goes wrong"]
    }
  ]
}
```

Severity means: **blocker** — the job cannot be finished this way at all.
**confusing** — it can be finished, but only by guessing, backtracking, or
knowing something nobody told you. **cosmetic** — it looks wrong but costs
nothing.

## The rules that decide whether a finding counts

Your report is checked by a script before anybody reads it. A finding is thrown
away, not investigated, if:

- the screenshot is missing or is not a real image of a page;
- the snapshot is missing, or is short enough to be a summary rather than the
  page;
- the snapshot does not contain the URL you filed the finding against;
- anything in `presentText` is not actually in the page snapshot;
- **anything in `absentText` IS in the page snapshot** — you reported something
  missing that was on the page, which usually means you did not scroll or did
  not open the menu;
- the snapshot does not match what the browser recorded when it was taken.

So: every "I couldn't find X" finding must put X in `absentText`. If you are not
willing to name what was missing, you are not sure it was missing.

Name a **control**, not a topic. "Funding" will be somewhere in the prose of a
page that has no funding button, and your finding will be thrown out for it.
"Add funding to this project" is a control. Quote the words you expected to be
able to click.

Two solid findings with clean evidence are worth more than nine you are half
sure of. An empty `findings` list is a completely acceptable answer if the job
went fine — say so and say what worked. Write that version of the file early
too, so that something exists no matter how the session ends.
