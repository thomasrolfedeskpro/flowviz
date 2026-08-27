# Intake: intent and depth

A FlowViz flow is a guided explanation, not a picture of a system. Two flows over
the same code can be completely different documents depending on who is reading
and what they need to walk away knowing. Getting that settled first is cheaper
than rewriting forty steps.

Ask in one batch. Four questions is plenty; you can infer the rest and confirm as
you go.

## The four questions

**1. Who reads this, and what should they understand afterwards?**

The single most useful answer. "A new joiner should understand why a ticket write
is hard to reason about" produces a very different flow from "the team needs to
agree where to put the cache". Push for the *conclusion*, not the topic — if the
answer is "how tickets work", ask what about it matters.

**2. Where does it start and stop?**

Boundaries are where flows bloat. "From the agent clicking save to the row being
written" is a scope. "How ticketing works" is not. Get the first and last moment
explicitly and write them down in `meta.description`.

**3. How much depth?** (the tiers below)

**4. Is there anything measured?**

Durations, counts, retries, rows, cost. If yes, the flow can carry numbers —
`footer` notes for the ones that matter, `packet.count` for repeats, `waterfall`
bars for comparing steps — provided the checkout supports those fields. If no,
don't invent them; a diagram with fabricated timings is worse than one without.

## The three depth tiers

Offer these by name with their cost. Most people pick correctly once they see
what the extremes look like.

### Sketch

**"I want someone to get the shape of this in thirty seconds."**

- 4–8 steps, up to about 8 components, one tier of zones
- One step per stage, not per call
- No nested scenes, no waterfall, footers only for a headline fact

Good for onboarding, a slide, or agreeing on scope before a deeper flow. The
discipline is leaving things out: if a component doesn't change the story, it
isn't in the diagram.

### Walkthrough — the default

**"I want to explain how this actually works to someone who will work on it."**

- 8–20 steps, up to about 15 components
- One step per meaningful moment: a call is made, data is transformed, a
  response comes back
- Zones for trust or deployment boundaries, annotations on the surprising bits,
  `meta.file`/`meta.line` so people can jump to the code

This is what most requests mean. Pick it unless something says otherwise.

### Forensic

**"Every hop, because we're about to change it."**

- 20–40 steps, aggregation rules doing real work
- Repeats collapsed with `packet.count` and stated in a footer, never one step
  per repeat
- Numbers where they exist: footers for the damning ones, waterfall bars so
  steps can be compared
- Nested scenes for subsystems that would otherwise wreck the top-level grid

The failure mode here is a diagram nobody can watch. If you find yourself past
40 steps, that is the signal to split subsystems into nested scenes or to cut
scope — not to keep going.

## Mixed depth

"High level, but I want the detail of the payment service" is the common answer
and it is not a compromise — it is what nested scenes are for. Top level stays a
sketch; one component carries a walkthrough inside it. Check the checkout
supports `component.detail` and `step.scene` before promising it.

If it doesn't, the honest options are two separate flows that link by name, or a
single deeper flow. Say which you're doing.

## Turning answers into a budget

| They said | Steps | Components | Reach for |
|---|---|---|---|
| "quick overview for the team channel" | 5–8 | ≤8 | zones, one packet per step |
| "explain this to the new backend hire" | 10–18 | ≤15 | annotations, `meta.file`, response paths |
| "we're refactoring this next quarter" | 20–40 | ≤25 | `packet.count`, footers, waterfall, nested scenes |
| "this trace is 4.5s and I don't know why" | 15–30 | ≤20 | waterfall bars, footers with the numbers, aggregation |

These are budgets, not targets. A flow that answers its question in six steps is
finished at six steps.

## Sanity checks before you write

- Can you state the flow's conclusion in one sentence? If not, go back to Q1.
- Does every component change the story? Delete the ones that don't.
- Does every step move something, transform something, or reveal something? A
  step that only re-highlights is padding.
- Are the numbers real? If you inferred a duration, say so in the handover.
