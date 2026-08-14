# Plain Words, Fewer Boxes

**The OpenPlan interface standard. Adopted 2026-08-13.**

This is the written form of a decision Nathaniel made after using OpenPlan as a human for the
first time. Three executable guards cite it by name; it exists so that what they enforce can be
read as one idea rather than three unrelated assertions.

It is a standard for **screens**, not for architecture. Where it and a guard disagree, the guard
is what ships — fix one or the other, never route around both.

## Where this came from

Twenty releases shipped with nobody but agents looking at the product. Twenty minutes of real
human use produced a better defect list than 11,000 tests. Three of the findings were the same
finding:

> "it's too 'card' heavy in the UI, I still want to use cards, but it's ONLY cards and when they
> get super nested it gets confusing."

> "much of the copy/narrative/speaking style still seems like an agent talking to another agent,
> but this needs to be for people who are planners and most planners don't understand a lot of
> this stuff I'm packing in here."

> "the analysis section with modelling and corridor analysis and whatnot is super confusing."

The root cause is one fact: **the app had a single layout idiom — a vertical stack of nested
cards — applied to every surface regardless of purpose.** Maps were boxed instead of being the
surface, forms sat inline instead of being a flow, and procedures were drawn as parallel cards
with no sense of order.

## 1. Four archetypes. Every surface is assigned exactly one.

The fix is not "fewer cards". It is that a surface must know what kind of surface it is.

| Archetype | What it is | Where it goes |
|---|---|---|
| **Map-first** | Full-bleed map, one docked sidebar, layer picker, basemap picker | engagement public, safety, explore, aerial |
| **Guided flow** | A wizard you enter, answer one thing at a time, and leave. Everything that CREATES something | campaigns, model runs, layer uploads, projects, allocation rules |
| **Reading surface** | Document-like, generous type, almost no boxes | RTP chapters, reports, public plan page |
| **Worklist** | Where cards are genuinely right, plus real charts | dashboard, my-work, registries |

A surface that cannot name its archetype is the defect this table exists to catch.

## 2. Three frames, counting the page shell.

`shell › section › item card`. A box inside an item card is the fourth frame, and there is no
hierarchy left to spend on it.

A **box** is anything that reads as a frame to a person: a border plus a radius, **or a filled
panel with a radius and no border**. The second half is not a footnote. Swapping a border for a
background tint lowers the number a border-counting audit reports while changing nothing a reader
can perceive — **that evasion is named here and refused.** If a nested box has to go, the four
moves, in order, are: flatten it to a labelled row; merge it into its parent; move it behind a
disclosure; or give it its own page.

## 3. A card must earn the frame. Five tests, all of them judgement.

Cards are right on a worklist — a set of comparable things a planner scans and chooses between —
because a card is the device that makes two of them comparable at a glance. It is wrong as a
default. Before framing something, all five must hold:

1. There are **two or more siblings**. One card is a box around a paragraph.
2. It is **one component rendered from one array**. Hand-built "cards" that merely resemble each
   other are a layout, not a set.
3. The reader's job here is **to pick one**. If they are reading rather than choosing, this is a
   reading surface.
4. It carries **three to five facts**. Fewer is a row; more is a page.
5. It has **one click target**. Two competing actions means the reader must decide twice.

No test enforces these — judgement does not go in a test. They are what a reviewer asks.

## 4. Say the plain thing. Do not annotate the jargon.

Asked whether the copy should teach its vocabulary or hide it, Nathaniel answered: **"make it
much more ELI5."** So the rule is replacement, not glossing. "Term (plain gloss)" is the machine's
word plus homework.

Three lists, and the distinction between them is the whole point:

- **Banned** — the machine's word for something a planner already has a word for. Replace it;
  nothing is lost.
- **Kept** — the *profession's* word. "Obligation", "fiscal constraint", "horizon year" are not
  jargon to a planner, they are the job. ELI5 removes the engineer's vocabulary, never the
  planner's. Simplifying these makes the product wrong *and* patronising.
- **Protected** — a claim boundary. It may be said more plainly. It may **not** be dropped, and
  its meaning may not be widened.

**Plainer must never mean weaker.** Rewriting copy is how a caveat gets deleted, and OpenPlan's
figures go into grant applications and adopted plans. Every protected sentence has exactly one
definition site; if you are retyping a caveat, you are forking it.

## 5. A reading surface is typeset, not laid out.

One prose column, 45–90 characters per line — planners print these pages and carry them into
board meetings. No heading may be smaller than the body text it introduces. Space above a section
divided by space below its heading is at least 3, so a heading belongs to what follows it.

## What enforces this

None of it survives as a convention. Each clause above is carried by something that fails:

| Mechanism | What it can see |
|---|---|
| `src/test/worklist-cards-do-not-nest.test.ts` | Nesting in source, including branches today's data never renders. Sees a tint swap and refuses it. |
| `qa-harness/openplan-local-card-nesting-audit.js` | The real box model and real line lengths in real Chrome, per route, against `fixtures/card-nesting-budget.json`. |
| `src/test/planner-copy-says-the-plain-thing.test.ts` + `src/test/helpers/jargon-ledger.ts` | Banned-term counts as equalities; both halves of every protected caveat. |

The two card mechanisms overlap deliberately and neither is redundant: the source guard sees code
that today's data does not reach, and the browser audit sees boxes formed across component
boundaries that no class-name scan could find.

**The counts and budgets are equalities, not ceilings.** A surface that gets worse fails; one that
gets better also fails until the new number is written down in the same commit. An improvement
recorded only in a chat log is one the next lane silently undoes.
