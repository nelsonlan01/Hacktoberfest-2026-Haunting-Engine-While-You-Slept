// ===== CONFIG: edit before using real devices / a real LLM =====
const CONFIG = {
  HA_URL: "http://homeassistant.local:8123", // TODO: your Home Assistant address
  HA_TOKEN: "",                               // TODO: long-lived access token (HA profile page)
  HA_ENTITY: "",                              // TODO: optional single entity_id to filter, e.g. "binary_sensor.living_room_motion"
  HA_HOURS: 8,                                // TODO: how many hours back count as "the night"
  LLM_URL: "http://localhost:11434/v1/chat/completions", // TODO: any OpenAI-compatible endpoint (Ollama, LM Studio, OpenAI...)
  LLM_KEY: "",                                // TODO: API key, leave empty for local models
  LLM_MODEL: "llama3.1"                       // TODO: model name. Note: Anthropic's API caps temperature at 1.0
};
// Home Assistant needs your page's origin in http: cors_allowed_origins (file:// pages may need a tiny local server: python -m http.server)

const SYSTEM_PROMPT = "You are a ghost story narrator. You get one night of smart-home sensor log lines (time | device | event | note). Write a creepy second-person tale of 5-8 short paragraphs in which every entry is evidence of a haunting. Misread mundane glitches as supernatural; for example, a camera that detects a pet's face is a ghost's face. Keep timestamps and device names accurate, invent atmosphere but never new sensor data, and end on an unsettling note. Plain text, no headings.";

const SAMPLE_LOG = `# time | device | event | note (optional)
22:58:12 | front_door_lock | locked via keypad
23:30:05 | thermostat | temperature 21.5C
00:12:33 | living_room_motion | motion detected | nobody home but you, asleep
00:12:35 | living_room_cam | face detected, confidence 0.61 | no known person matched
00:12:41 | living_room_motion | motion cleared
01:03:19 | thermostat | temperature 17.8C | dropped 3.7C in 12 minutes
01:47:52 | hallway_light | turned on | no one pressed the switch
01:47:58 | hallway_light | flickered 4 times
02:26:30 | smart_speaker | heard a sound | transcription: whisper, 3 words
03:07:14 | fridge_door | opened for 41 seconds
03:33:00 | tv_plug | power on 0.8A | no remote signal
03:41:22 | bedroom_motion | motion detected | you, asleep
03:41:50 | bedroom_door | contact opened
04:44:04 | cat_flap | no activity logged all night
05:59:59 | front_door_lock | still locked`;

function parseLog(txt) {
  return txt.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(l => {
    const [t, d, e, ...n] = l.split("|").map(s => s.trim());
    return { t: t || "??:??", d: (d || "unknown device").replace(/_/g, " "), e: e || "signal", n: n.join(" | ") };
  });
}

const OMENS = /face|whisper|heard|nobody|no one|unknown|no remote|dropped|flicker|no known|opened|still|no activity|asleep/gi;
const haunt = ev => Math.min(3, (`${ev.d} ${ev.e} ${ev.n}`.match(OMENS) || []).length);

async function pullHomeAssistant() {
  const since = new Date(Date.now() - CONFIG.HA_HOURS * 3600e3).toISOString();
  const url = `${CONFIG.HA_URL}/api/logbook/${since}` + (CONFIG.HA_ENTITY ? `?entity=${CONFIG.HA_ENTITY}` : "");
  const r = await fetch(url, { headers: { Authorization: "Bearer " + CONFIG.HA_TOKEN } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const rows = await r.json();
  if (!rows.length) throw new Error("no events in that window");
  return rows.map(x => `${new Date(x.when).toTimeString().slice(0, 8)} | ${x.entity_id || x.name} | ${x.message || x.state || "changed"}`).join("\n");
}

// ----- Offline "haunt engine": variants run mild to wild; higher temperature skews toward wild -----
const TPL = [
[/cam/, ["At {t} the {d} framed a face: {e}. You were asleep. The face was not.", "{t}. The {d} studied the empty room and filed this: {e}. The room was not empty.", "The {d} logged a face at {t} ({e}). Pale, patient, and looking straight into the lens, as if it knew the lens was how you would find out."]],
[/motion/, ["At {t} the {d} stirred: {e}. Nothing in the house had legs at that hour.", "{t}: {e}. The {d} is built to detect warm bodies. It detected something only pretending to be one.", "The {d} tripped at {t}. Something crossed the room slowly, the way you walk through a house that used to be yours."]],
[/therm|temp|heat/, ["At {t} the house inhaled and the {d} reported: {e}. Cold does not fall like that unless something is standing in it.", "{t}. {e}. Had you been awake, your breath would have hung in the air like a held word."]],
[/light|lamp/, ["At {t} the {d} woke itself: {e}. The switch had not been touched.", "{t}: {e}. The {d} blinked in what you will later swear was a pattern."]],
[/speaker|mic|voice|alexa/, ["At {t} the {d} listened: {e}. It does not transcribe what it cannot understand. It understood this.", "The {d} heard something at {t} ({e}). Three words, maybe four. One of them was your name."]],
[/fridge|kitchen/, ["At {t} the {d} opened: {e}. Something stood in that cold light for a long time, deciding what it missed eating.", "{t}: {e}. The fridge hummed the way a throat clears before speaking."]],
[/tv|plug|power/, ["At {t} the {d} switched itself on: {e}. Static is just someone else's channel.", "{t}. {e}. Something wanted to watch. Or wanted to be watched."]],
[/bed/, ["At {t}, the {d}: {e}. This is the closest the night came to you. The log does not say how close.", "{t}: {e}. By now the house had stopped pretending the thing was elsewhere."]],
[/door|lock/, ["At {t} the {d} reported: {e}. Whoever came in did not use the door. Whoever stayed did not need to.", "{t}. {e}. A lock keeps out the living. Nobody asked it about the others."]],
[/cat|flap|litter/, ["At {t} the {d}: {e}. Your cat has a perfectly good explanation. Your cat is not talking.", "{t}: {e}. The house has one more resident than the lease says."]],
[/./, ["At {t} the {d} noted: {e}. Small, unremarkable. That is how these things begin.", "{t}: {d}, {e}. The house made a note of it, and so did something else."]]
];
const OPEN = ["The first entry is {t}. You were already asleep.", "The app summary said it was a quiet night. The house lies.", "Nothing happened last night, according to the summary. Here is the log, read the way it should be read."];
const SHIVER = ["Somewhere in the walls, something exhaled.", "The dark waited, politely, for you to look away.", "You would like to blame the wind. The windows were closed.", "None of this is strange, if you refuse to count."];
const CLOSE = ["At {t} the log goes quiet, the way a room goes quiet when someone stops pretending to be gone.", "The sensors reset with the sun, as if the night could be cleared. Whatever watched you sleep has learned your routine.", "Check the footage if you must. The face in it is already looking at you."];

function offlineStory(evs, temp) {
  const pick = a => a[Math.floor(Math.pow(Math.random(), 1 / (0.3 + temp)) * a.length)];
  const fill = (s, e) => s.replace(/\{t\}/g, e.t.slice(0, 5)).replace(/\{d\}/g, e.d).replace(/\{e\}/g, e.e);
  const out = [fill(pick(OPEN), evs[0])];
  evs.forEach(e => {
    let p = fill(pick(TPL.find(x => x[0].test(e.d + " " + e.e))[1]), e);
    if (e.n && Math.random() < 0.7) p += ` The log adds only this: “${e.n}.”`;
    out.push(p);
    if (Math.random() < temp / 2.2) out.push(SHIVER[Math.floor(Math.random() * SHIVER.length)]);
  });
  out.push(fill(pick(CLOSE), evs[evs.length - 1]));
  return out.join("\n\n");
}

// ----- LLM storyteller: any OpenAI-compatible chat endpoint, temperature passed straight through -----
async function llmStory(evs, temp) {
  const log = evs.map(e => `${e.t} | ${e.d} | ${e.e}${e.n ? " | " + e.n : ""}`).join("\n");
  const r = await fetch(CONFIG.LLM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(CONFIG.LLM_KEY ? { Authorization: "Bearer " + CONFIG.LLM_KEY } : {}) },
    body: JSON.stringify({ model: CONFIG.LLM_MODEL, temperature: temp, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: log }] })
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).choices[0].message.content;
}

async function makeStory(evs, temp, mode) {
  if (mode === "llm") {
    try { return { text: await llmStory(evs, temp), src: `LLM, temperature ${temp}` }; }
    catch (e) { return { text: offlineStory(evs, temp), src: `Offline engine (LLM failed: ${e.message}), temperature ${temp}` }; }
  }
  return { text: offlineStory(evs, temp), src: `Offline engine, temperature ${temp}` };
}
