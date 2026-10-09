# Agent Card: Scout

**Project:** Waypoints · **Owner:** Dan Benner · **Last updated:** 2026-10-07
**Status:** Live. Pin Scout (Nearby) and Area Scout built and in use. Connections not built yet.

The same content renders in the app's **Scout Rules** card (Scout Rules view) from `data/scout-card.json`;
its Agent Story view matches `AGENT-STORIES.md`. When Scout's behaviour changes, update all three
and add a changelog line.

## Job
Finds places worth adding to Dan's map that fit his taste, checks them, and explains why.

## Trigger
- **Pin Scout:** the round Scout button inside an open pin's panel.
- **Area Scout:** the round Scout button on the map, top left under the title. Always on. Scouts the area
  on screen: the active flag's country when it fills the view, otherwise the view itself.

## Reads
- Dan's pins: names and blurbs he wrote (unstructured), coordinates and categories (structured).
- The open pin (Pin Scout) or the pins in view (Area Scout).
- Web pages found by search.
- Past decisions in `scout-log.jsonl`: what Dan accepted, rejected or overruled.

## Tools
| Tool | What it does |
|---|---|
| web_search | Searches and reads pages: 8 per Pin Scout run, 12 per Area Scout run |
| search_my_pins / get_pin / pins_in_view | Reads Dan's pins |
| geocode | Real coordinates and the town (OpenStreetMap Nominatim) |
| distance_km | Calculates distance; the model never estimates it |
| check_duplicate | Pins within 500 m or with the same normalized name |
| past_decisions | Reads the decisions log |
| submit_findings | Hands in results; the only way to finish |

## Hard rules (code enforces, every time)
Failures move to Rejected with the reason code shown.
- Coordinates come from a geocode in this run, never the model's guess → `unverified_location`
- Pin Scout: within 60 km of the pin → `too_far`
- Area Scout: inside the view → `outside_view`
- Not within 500 m of a pin, and not the same name → `duplicate`
- Not something Dan already accepted or rejected → `already_decided`
- Evidence links must come from this run's own searches → `vague_thread`
- Caps: 3 for a pin, 10 for an area → `weak_fit`
- An empty result needs a reason → `nothing_reason`
- One resubmission allowed after failures.
- House style: names in Title Case, never an ampersand.

## Model judgment (can vary run to run)
- What fits Dan's taste, argued from his own pins (it must cite them).
- What's worth a detour versus a tourist trap.
- The summary and "why Scout chose it" text.
- Coming with Connections: whether a named thread is real and specific, with two sources.

## Output
A tray from the bottom: equal-height cards with photos and Accept / Reject on each, an inspector
with the same actions pinned at the top, and a Rejected tab with reasons and Overrule. Or a
"nothing worth adding" result with the reason. The last run survives a refresh.

## Can't / won't
- Never adds a pin. Accept opens the normal add form for Dan to review.
- No schedule; runs only when Dan presses a button.
- Single user: Dan's map only.
- Can be confidently wrong; sources are there so Dan can check.

## How we know it's good
Shown live in the card from `scout-log.jsonl` (one summary line per run since 2026-10-06):
- **Accept rate:** accepted ÷ shown
- **Overrule rate:** overrules ÷ Scout's rejections
- **Wrong facts:** target 0 (not tracked yet)
- **Cost per run:** average, Sonnet 5.5 tokens plus searches

Test set for tuning: 10 pins (3 music, 2 film, 2 castles, 2 modern, 1 nature) and 3 areas
(UK, London, one EU city).

## Changelog
- 2026-10-07: Added the Agent Story view (see AGENT-STORIES.md).
- 2026-10-06: Reject works in one press; status lines rotate while Scout works; opacity-only pulse; per-run log lines feed the card.
- 2026-10-05: Tray actions on every card; the last run survives a refresh; Title Case names, no ampersands.
- 2026-10-05: Launched Pin Scout (Nearby) and Area Scout. Jill's map retired; Scout is single-user.

## Files
Spec: `_source/waypoints-scout-spec-v2.md` (local only) · Code: `js/scout.js`, `js/scout-tools.js`,
`js/scout-card.js`, `api/scout.js` · Card data: `data/scout-card.json` · Decisions: `scout-log.jsonl`
