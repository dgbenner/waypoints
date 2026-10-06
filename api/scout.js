/* ============================================================================
 * WAYPOINTS — /api/scout  (Vercel serverless, Node)
 *
 * The Scout agent's loop runs in the browser (js/scout.js). Each step of that
 * loop is one POST here, which holds the API key and pins the model, tools and
 * limits. Client tools (search_my_pins, geocode, check_duplicate, ...) are
 * executed by the browser; web_search runs on Anthropic's side.
 *
 * POST { action, password, ... }
 *   step      { messages, mode, searchesUsed } → one model turn (mode: pin | area)
 *   geocode   { query }                   → Nominatim
 *   reverse   { lat, lng, zoom }          → a name for the map view (Area Scout)
 *   image     { name, region, country }   → findImage()
 *   decide    { mode, scope, name, lat, lng, decision, reason } → scout-log.jsonl
 *   decisions {}                          → scout-log.jsonl, read live from GitHub
 *   runlog    { mode, scope, considered, rejected_rule, rejected_judgment, shown, searches,
 *               tokens_in, tokens_out, cost_usd } → one summary line per run (for the agent card)
 * ========================================================================== */
const Anthropic = require('@anthropic-ai/sdk');
const { appendJsonl, readJsonl, readBody, findImage, geocode, reverseGeocode } = require('./_lib');

const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 8000;
const SEARCH_CAP = { pin: 8, area: 12 };   // web searches per run
const LOG_FILE = 'scout-log.jsonl';

const REJECT_REASONS = ['unverified_location', 'sources_disagree', 'duplicate', 'too_far',
  'outside_view', 'vague_thread', 'no_thread', 'closed_or_gone', 'tourist_trap', 'weak_fit',
  'already_decided'];

// Kept byte-stable so the tools + system prefix caches across steps; the
// per-run details (which pin, detour limit) go in the first user message.
const SYSTEM = `You are Scout, a researcher for Dan's travel map. You find places he'd genuinely want to visit, not top-10 lists. His existing pins define his taste: offbeat history, music sites (Joy Division, The Smiths, The Cure), album-cover and film locations, modern architecture, castles.

You run in one of two modes, named in the first message:
- Pin Scout: places worth a detour near one pin Dan has opened (kind "nearby"), within the detour limit given. At most 3.
- Area Scout: places inside the map view Dan is looking at that fit his taste (kind "area"). Call pins_in_view first. At most 10, all inside the view.

1. Read the pin (get_pin) or the view (pins_in_view), and use search_my_pins to see what else Dan has plotted, so you can argue fit from his real pins.
2. Search the web for candidates.
3. Verify every candidate: geocode it (never use your own estimate for a location), check_duplicate to make sure it isn't already on the map, call past_decisions once to skip anything Dan already accepted or rejected, and keep the URLs that back each claim.
4. Be selective. When in doubt, reject it with a reason. Nothing is a good result if nothing is good.
5. Never claim something your sources don't say. Evidence URLs must come from your own web searches in this run.
6. Write place names in Title Case. Never use "&" anywhere; write "and".
Finish by calling submit_findings. It is the only way to end the run.`;

const CLIENT_TOOLS = [
  {
    name: 'search_my_pins',
    description: "Search Dan's existing pins. Dan's pins define his taste; use them to argue fit. Matches words against name, blurb, region and country. Returns id, name, country, themes, blurb.",
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Words to match, e.g. "joy division" or "brutalist"' },
        theme: { type: 'string', enum: ['music', 'art', 'literary', 'chess', 'castle', 'cathedral', 'monument', 'industrial', 'coast', 'mountain', 'wildlife', 'food'] },
        country: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 40 }
      }
    }
  },
  {
    name: 'get_pin',
    description: 'The full record for one of Dan\'s pins, by id.',
    input_schema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } }
  },
  {
    name: 'pins_in_view',
    description: 'Area Scout: the map view Dan is looking at — its bounds, a place name for it, and the pins inside it.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'geocode',
    description: 'Geocode a place with OpenStreetMap Nominatim. Returns lat, lng and display_name, or an error. Never use your own estimate for a location; a suggestion\'s lat/lng must come from this tool. Include the town and country in the query.',
    input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } }
  },
  {
    name: 'distance_km',
    description: 'Great-circle distance in km. Give from_id (one of Dan\'s pins) or from_lat/from_lng, plus to_lat/to_lng. Do not do this math yourself.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['to_lat', 'to_lng'],
      properties: {
        from_id: { type: 'string' }, from_lat: { type: 'number' }, from_lng: { type: 'number' },
        to_lat: { type: 'number' }, to_lng: { type: 'number' }
      }
    }
  },
  {
    name: 'check_duplicate',
    description: 'Is this place already on Dan\'s map? Returns any pin within 500 m, or whose normalized name matches.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['name', 'lat', 'lng'],
      properties: { name: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' } }
    }
  },
  {
    name: 'past_decisions',
    description: 'Places Dan accepted or rejected in earlier Scout runs. Do not suggest these again.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'submit_findings',
    description: 'The only way to finish. The code checks every suggestion (geocoded location, detour limit or view bounds, duplicates, past decisions, evidence from this run\'s searches, the cap) and moves failures to rejected. If it moves anything, you may resubmit once.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['headline_facts', 'suggestions', 'rejected', 'nothing_reason'],
      properties: {
        headline_facts: {
          type: 'object', additionalProperties: false, required: ['searched', 'considered'],
          properties: {
            searched: { type: 'integer', description: 'Web pages/results you read' },
            considered: { type: 'integer', description: 'Candidate places you weighed' }
          }
        },
        suggestions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['kind', 'name', 'lat', 'lng', 'summary', 'about', 'why_chosen', 'fits_pins', 'evidence'],
            properties: {
              kind: { type: 'string', enum: ['nearby', 'area'], description: 'nearby for Pin Scout, area for Area Scout' },
              name: { type: 'string' },
              lat: { type: 'number', description: 'From geocode' },
              lng: { type: 'number', description: 'From geocode' },
              summary: { type: 'string', description: 'One line for the card' },
              about: { type: 'string', description: '3–5 sentences: what it is' },
              why_chosen: { type: 'string', description: '2–3 sentences: why Dan would want it' },
              fits_pins: { type: 'array', items: { type: 'string' }, description: "Ids of Dan's pins that make the case" },
              evidence: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false, required: ['url', 'claim'],
                  properties: { url: { type: 'string' }, claim: { type: 'string' } }
                }
              }
            }
          }
        },
        rejected: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['name', 'reason', 'note'],
            properties: {
              name: { type: 'string' },
              reason: { type: 'string', enum: REJECT_REASONS },
              note: { type: 'string', description: 'One line' }
            }
          }
        },
        nothing_reason: { type: 'string', description: 'Required if suggestions is empty; otherwise ""' }
      }
    }
  }
];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body;
  try { body = await readBody(req); } catch (e) { return res.status(400).json({ error: 'Bad JSON' }); }

  // The agent card's numbers are public (counts and costs only, no place names), so the
  // card reads properly when opened from another site.
  if (body.action === 'cardstats') {
    try { return res.status(200).json(await cardstats()); }
    catch (e) { return res.status(500).json({ error: String((e && e.message) || e) }); }
  }

  const secret = process.env.WAYPOINTS_ADD_SECRET;
  if (secret && body.password !== secret) return res.status(401).json({ error: 'Bad access key' });

  try {
    switch (body.action) {
      case 'step': return res.status(200).json(await step(body));
      case 'geocode': {
        const g = await geocode(String(body.query || '').slice(0, 300));
        return res.status(200).json(g || { error: 'No match for that query' });
      }
      case 'reverse':
        return res.status(200).json(await reverseGeocode(Number(body.lat), Number(body.lng), Number(body.zoom) || 8));
      case 'image':
        return res.status(200).json({ url: await findImage(body.name, body.region, body.country) });
      case 'decide': return res.status(200).json(await decide(body));
      case 'runlog': return res.status(200).json(await runlog(body));
      case 'decisions': return res.status(200).json({ decisions: await readJsonl(LOG_FILE) });
      default: return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};

/* ------------------------------------- step -------------------------------- */
async function step(body) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  if (!Array.isArray(body.messages) || !body.messages.length) throw new Error('No messages');
  const Client = Anthropic.default || Anthropic;
  const client = new Client();

  // The run-wide search cap is enforced per request through max_uses. It only
  // changes after a step that searched, so the cached prefix survives the
  // geocode/duplicate steps in between. Once spent, the browser tells the model
  // to stop searching; max_uses can't go below 1.
  const cap = SEARCH_CAP[body.mode] || SEARCH_CAP.pin;
  const used = Math.max(0, Number(body.searchesUsed) || 0);
  const remaining = Math.max(1, cap - used);

  const msg = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    cache_control: { type: 'ephemeral' },
    system: SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: remaining }].concat(CLIENT_TOOLS),
    tool_choice: { type: 'auto' },
    messages: body.messages
  });

  return {
    content: msg.content,
    stop_reason: msg.stop_reason,
    stop_details: msg.stop_details || null,
    model: msg.model,
    usage: msg.usage,
    searchCap: cap
  };
}

/* ---------------------------------- cardstats ----------------------------- */
async function cardstats() {
  const log = await readJsonl(LOG_FILE);
  const runs = log.filter(d => d.decision === 'run').map(r => ({
    at: r.at, mode: r.mode, scope: r.scope, considered: r.considered, rejected_rule: r.rejected_rule,
    rejected_judgment: r.rejected_judgment, shown: r.shown, searches: r.searches,
    tokens_in: r.tokens_in, tokens_out: r.tokens_out, cost_usd: r.cost_usd
  }));
  const since = runs.length ? runs[0].at : null;   // count decisions only from when runs were logged
  const count = kind => since ? log.filter(d => d.decision === kind && d.at >= since).length : 0;
  return { runs, accepted: count('accepted'), overruled: count('overruled') };
}

/* ------------------------------------ runlog ------------------------------- */
// One line per finished run, so the agent card can show real numbers.
async function runlog(body) {
  const n = k => Math.max(0, Math.round(Number(body[k]) || 0));
  const entry = {
    at: new Date().toISOString(), decision: 'run',
    mode: body.mode === 'area' ? 'area' : 'pin',
    scope: String(body.scope || '').slice(0, 120),
    considered: n('considered'), rejected_rule: n('rejected_rule'), rejected_judgment: n('rejected_judgment'),
    shown: n('shown'), searches: n('searches'), tokens_in: n('tokens_in'), tokens_out: n('tokens_out'),
    cost_usd: Math.max(0, +(Number(body.cost_usd) || 0).toFixed(4))
  };
  await appendJsonl(LOG_FILE, entry, 'Scout run: ' + entry.mode + ' ' + entry.scope);
  return { ok: true };
}

/* ------------------------------------ decide ------------------------------- */
async function decide(body) {
  const decision = String(body.decision || '');
  if (!['accepted', 'rejected', 'overruled'].includes(decision)) throw new Error('Bad decision');
  const entry = {
    at: new Date().toISOString(),
    mode: String(body.mode || 'pin'),
    scope: String(body.scope || '').slice(0, 120),
    name: String(body.name || '').slice(0, 200),
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    decision,
    reason: String(body.reason || '').slice(0, 80)
  };
  if (!entry.name) throw new Error('No name');
  await appendJsonl(LOG_FILE, entry, 'Scout decision: ' + decision + ' ' + entry.name);
  return { ok: true, entry };
}
