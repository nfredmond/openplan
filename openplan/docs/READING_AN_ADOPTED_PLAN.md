# Reading an adopted plan into OpenPlan

**Who this is for:** the planner starting a plan update, who has last cycle's adopted RTP as a PDF
and does not want to retype three hundred pages of it. **Who else needs to read it:** whoever
operates your deployment, for the one section about scanned documents.

OpenPlan can read an adopted plan and copy out what it finds — revenue and cost lines, performance
measures, planning periods, programmed project costs, and the plan's own policy and goal text —
each one with the page it came from and the sentence it was copied from. **Nothing it copies goes
into your plan until you save it.**

The one thing to understand before starting: **this is copying, not writing.** OpenPlan will not
summarise the plan, will not work out a total, will not fill in a figure the document does not
state, and will not decide anything on your behalf. If a figure it proposes is not in the words it
quotes, that proposal is thrown away rather than shown to you — so a reading that finds forty
figures is forty figures the document actually prints.

---

## 1. Put the plan in your document library

Open **Documents**, upload the PDF, and set its kind to **RTP**.

**Success looks like:** the document appears in the library and its status becomes **Ready**, with a
page count. Ready means OpenPlan pulled text out of it page by page, which is what lets everything
below cite a page.

**If it says the document could not be read**, the PDF is a scan — a picture of each page with no
text layer, which is what most plans older than a few years are. OpenPlan says so plainly instead of
pretending; see [Scanned plans](#4-scanned-plans-what-ocr-needs) below.

---

## 2. Read it into a plan cycle

Open the plan cycle you are working on → **Document review** → choose the document → **Read this
document**.

One reading covers one document and one plan cycle. If you are working through several previous
plans, read them one at a time — the pairing of a document to a plan cycle is a judgement, and there
is deliberately no button that does forty of them at once.

**Success looks like:** the reading finishes and says what it found, including what it threw away —
for example *41 proposed; 6 dropped because their figures were not in the text they cited.* A
reading that dropped things is the check working, not a fault.

**What it costs:** each reading makes several calls to the AI service your deployment is configured
with, and the review screen states the limits it read to. A document read only as far as a ceiling
looks, from every screen afterwards, exactly like a document that ends there — so OpenPlan says
when it stopped early.

---

## 3. Check each thing it found

Every proposal appears on a card with three things you can check: the value, the page, and the
document's own sentence. There is **no confidence score anywhere** — a number grading the machine's
own work would only stop you reading the quote, and the quote is the check that means something.

Each card also says how the proposal compares with what your plan already records:

- **New** — nothing like it is recorded yet.
- **Already recorded** — you have this. Saving it again would record the same figure twice, so
  setting it aside is offered first.
- **Conflicts** — you have this line, with a *different* figure. Both are shown side by side with
  the page and the quote. This is the most valuable moment in the whole feature: it is how you catch
  a ledger typed out of a draft the adopted plan later superseded.

**Save into the plan** runs the same save a figure you typed by hand runs — the same checks, the same
limits, the same audit record. **Change and save** sends your corrected values instead; the proposal
keeps recording what the machine suggested, so *what did the planner change?* stays answerable
afterwards. **Set aside** records the decision and touches nothing.

A saved figure keeps a chip naming the document and page it came from — in the app, on your public
plan page, and in the body of the board packet. If you later edit the figure, the chip says the
agency changed it, because the page it cites no longer says what the row says.

### Projects

A project's programmed cost is copied out with the project's **name as the plan prints it**, and you
choose which project in OpenPlan it is. Nothing matches names for you and no project is created from
a document.

### The plan's dollar year

Accepting the plan-wide dollar year re-derives every escalated figure in the cycle. The card says how
many lines that is before you press it.

The plan's **escalation rate** is deliberately not copied — a plan writes "3.5 percent" and OpenPlan
stores `0.035`, and converting between the two is arithmetic, not transcription. Type it once by
hand.

---

## 4. Scanned plans: what OCR needs

A scanned PDF has no text to copy, so OpenPlan marks it as unreadable and it cannot be cited. Turning
those into readable documents needs one extra service, which your deployment operator sets up once:

- the OCR worker in `workers/ocr_worker/` (its `workers/ocr_worker/DEPLOY.md` is a short checklist);
- `OPENPLAN_KB_OCR_WORKER_URL` and `OPENPLAN_KB_OCR_WORKER_TOKEN`, which are required together;
- `OPENPLAN_KB_OCR_CALLBACK_BEARER_TOKEN`, without which recognised text can never land;
- `OPENPLAN_KB_OCR_LANGUAGES` if your documents are not in English. **This one is not cosmetic:** a
  Spanish plan recognised with the English model comes back looking exactly like text and saying
  nothing, and nothing downstream can tell.

With the worker configured, a scanned document offers **Read with OCR** and becomes citable page by
page like any other. Without it, the library says this deployment has no OCR service — rather than
saying scans are unsupported, which would be a different and untrue thing.

Everything in that list is described for operators in
[`docs/SELF_HOSTING.md`](SELF_HOSTING.md).

---

## 5. The plan's own words

Policy, goal, action and objective statements are copied out **word for word or not at all**. They do
not go into your plan's ledger, and they do not go into a chapter by themselves — they wait on
**Document review → Place copied chapter text**, where you choose which chapter of *your* plan each
block belongs in. OpenPlan never guesses that pairing.

A placed block sits in the chapter's waiting text, badged with the document and page it came from,
until you accept it. **Accepting is not publishing.** A chapter says what you write in the chapter
editor; an accepted block is a quotation you have read and stand behind, ready to copy in.

If a block is not a word-for-word copy of the page it cites — shortened, tidied, or two statements
joined into one — it is refused, with the reason. A block is a quote or it does not exist.

---

## 6. Working through several previous plans

Previous plans live in the registry as **archived** cycles. The registry hides archived plans by
default and offers them on a **Show archived plans** button carrying their count, so a decade of
history does not bury the plan you are writing. A cycle that has had a document read into it is
labelled with how many figures were saved and how many are still waiting.

Deleting a document that backs saved figures is refused, and the refusal names the plan and the
count — those citations would otherwise point at nothing.

---

## What OpenPlan will not do here

Worth stating plainly, because each one is a deliberate refusal rather than a missing feature:

- It will not summarise or paraphrase the plan. Every word it stages is the plan's own.
- It will not compute anything — no total, no subtotal, no balance, no year-of-expenditure figure,
  no period midpoint, no score. Your plan's fiscal finding stays computed from rows you accepted.
- It will not record a zero for a cost the plan leaves blank. Unpriced is a real answer.
- It will not fill in an escalation year the plan does not name, because doing so would silently
  delete the public disclosure that OpenPlan assumed the period's midpoint.
- It will not accept anything on your behalf, in bulk or otherwise, and no AI assistant in OpenPlan
  can accept one either.
