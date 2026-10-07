# Agent Stories: Waypoints

Shown in the app's **Scout Rules** card under the **Agent Story** tab, rendered from the `story`
and `template` fields of `data/scout-card.json`. Keep this file and that JSON in sync, and add a
changelog line to the card when a story changes.

---

## The template

A user story extended for agents. The first line is the concept. The lines after it force the
technical decisions into the open, so they're made on purpose instead of downstream.

> **As** [who], **when** [trigger], **I want** [goal], **so that** [outcome].
> **It may:** [the actions and tools it gets]
> **It must never:** [hard rules, enforced in code]
> **It decides:** [what's left to the model's judgment]
> **It stops when:** [what counts as done, plus limits]
> **I'll know it works when:** [the test and the number]

**How to use it**
- Write the first line before anything else. If you can't, the agent isn't defined yet.
- Ask whether it needs to be an agent at all. If the steps are always the same, a fixed pipeline is
  simpler and more reliable. (Adding a pin is a pipeline, not an agent, for exactly this reason.)
- "It must never" and "It decides" are the boundary between code and model. Every "never" should be
  enforced in code, not only stated in the prompt.
- Update the story whenever the agent changes, and add a line to the changelog.

---

## Scout

Checked against `api/scout.js`, `js/scout.js` and `js/scout-tools.js` on 2026-10-07.

> **As** a traveler with specific interests, **when** I press Scout on a pin or on the area I'm
> looking at, **I want** places I haven't found yet, **so that** I can plan trips around what I care about.
> **It may:** search the web, read my pins, look up coordinates, measure distances, and check for
> duplicates and past decisions.
> **It must never:** add a pin, guess a location, or re-suggest something I've already accepted or rejected.
> **It decides:** what fits my taste and what's worth showing.
> **It stops when:** it has up to 3 strong finds near a pin (10 for an area), or none are good enough;
> or at its limits of 8 searches (12 for an area) and 20 steps; or when I press Stop.
> **I'll know it works when:** I accept at least a third of what it shows.

Where the code enforces each "never":
- **Add a pin:** Scout has no tool that writes pins. Accept opens the normal add form.
- **Guess a location:** a suggestion's coordinates must match a geocode from this run (`unverified_location`).
- **Re-suggest a decision:** checked against `scout-log.jsonl` (`already_decided`).
