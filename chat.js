// "Ideas" chat: describe what you want (and attach sketches or photos), Claude
// returns a new concept plan. Works only inside a Claude artifact, where the page
// can ask Claude through the `sample` capability; elsewhere the button stays hidden.
import { ROOM_TYPES, FLOOR_MATERIALS, validatePlan } from "./layout.js";

const STORE = "fpw-chat-v1";
const MAX_TURNS = 12;

const RULES = `You are an architect's assistant inside a floor plan app for South African homes. The user describes ideas (in any language), sometimes with images, and you return a complete new concept floor plan as JSON that the app turns into a 3D model people can walk through.

PLAN FORMAT (single storey, metres):
- rooms: rectangles {id, name, type, x, y, w, d}. x grows to the east (right), y grows to the SOUTH (down on the plan). w = east-west size, d = north-south size. Use multiples of 0.1 m.
- type is one of: ${Object.entries(ROOM_TYPES).map(([k, v]) => `${k} (${v.label})`).join(", ")}.
- Rooms must NEVER overlap. Rooms that should connect must share a wall exactly: one room's edge coordinate equals the other's (e.g. a.x + a.w === b.x) over at least 0.9 m.
- Doors are automatic: a door appears between two touching rooms when at least one is a shared space (living, kitchen, dining, passage, entrance, patio). Bedroom-bedroom or bedroom-bathroom get no door unless you add it in "doors". A "patio" (stoep) has no outer walls and gets a sliding door to the room it touches. An "entrance" on an outside wall gets the front door. Windows are added automatically on outside walls.
- doors: optional overrides {"idA|idB": true|false} (ids sorted alphabetically), e.g. an en-suite: {"bathroom2|main": true}.
- Every room must be reachable from the entrance via doors. Keep circulation sensible: a passage or hall usually links bedrooms.
- Typical sizes: bedroom 9-12 m2 (min 2.7 m wide), main bedroom 12-18 m2, bathroom 4-7 m2, en-suite 3.5-5 m2, kitchen 8-15 m2, living 18-35 m2, passage 1.1-1.5 m wide, single garage 3.2 x 6 m. South African homes often have a stoep (patio) off the living area, a scullery next to the kitchen and an en-suite for the main bedroom.
- wallHeight: 2.4-3.2 (default 2.6).

STYLE (used by the realistic 3D view), all optional:
- walls: wall colour as "#rrggbb"
- floors: {roomType or room id: material}, materials: ${FLOOR_MATERIALS.join(", ")}
- light: "warm" | "neutral" | "cool"

IMAGES: an attached image may be a sketch, photo or drawing of a floor plan (then follow its layout and dimensions as closely as you can; if no dimensions are written, estimate scale from a 0.9 m door or typical room sizes), inspiration photos (use them for the style: floors, wall colour, light), or a site photo. Say briefly what you took from each image.

Start from the CURRENT PLAN and change only what the request asks, unless the user asks for something new. Keep room ids stable for rooms you keep.

REPLY with only one JSON object, no other text:
{"reply": "2-4 short sentences in the user's language: what you changed and why, plus at most one question if something important is unclear",
 "title": "concept name, 2-5 words",
 "plan": {"name": "...", "wallHeight": 2.6, "rooms": [...], "doors": {...}} or null when the user only asked a question,
 "style": {"walls": "#...", "floors": {...}, "light": "warm"}}`;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    else if (k === "text") e.textContent = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && c !== false && e.append(c));
  return e;
};
const ERRORS = {
  not_granted: "Claude isn't allowed on this page. Allow it in the artifact's permissions, then reload.",
  sampling_disabled: "Claude isn't available for this account.",
  rate_limited: "Too many requests right now. Wait a minute and send again.",
  session_expired: "You've been signed out of Claude. Sign in again and reload.",
  image_rejected: "One of the images couldn't be used. Try a JPG or PNG under 20 MB.",
  images_unavailable: "Images can't be sent from this view. Send the message without them.",
  refused: "Claude declined this request. Try rephrasing it.",
  invalid_json: "Claude's answer couldn't be read as a plan. Send it again.",
  prompt_too_large: "The conversation got too long. Start a new chat.",
  empty_completion: "Claude gave no answer. Try a shorter request.",
};

export async function initChat({ getPlan, setPlan, toast }) {
  if (!window.claude?.use) return;
  const sample = await window.claude.use("sample").catch(() => null);
  if (!sample) return;
  const limits = await sample.limits().catch(() => null);
  const imgLimits = limits?.images || null;

  let state = load();
  let attachments = []; // {file, url}
  let busy = null; // AbortController while waiting
  const $ = (id) => document.getElementById(id);
  const panel = $("chat"), list = $("chat-list"), input = $("chat-input"), sendBtn = $("chat-send"), files = $("chat-files"), thumbs = $("chat-thumbs");

  $("btn-chat").hidden = false;
  $("btn-chat").onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { render(); input.focus(); } };
  $("chat-close").onclick = () => { panel.hidden = true; };
  $("chat-new").onclick = () => { state = { turns: [], concepts: [] }; persist(); render(); toast("Started a new chat. Your current plan stays."); };
  if (imgLimits) {
    files.accept = imgLimits.mediaTypes.join(",");
    $("chat-attach").hidden = false;
    $("chat-attach").onclick = () => files.click();
    files.onchange = () => { addFiles([...files.files]); files.value = ""; };
    input.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith("image/")); if (f.length) { e.preventDefault(); addFiles(f); } });
    panel.addEventListener("dragover", (e) => { e.preventDefault(); panel.classList.add("drop"); });
    panel.addEventListener("dragleave", () => panel.classList.remove("drop"));
    panel.addEventListener("drop", (e) => { e.preventDefault(); panel.classList.remove("drop"); addFiles([...e.dataTransfer.files]); });
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  sendBtn.onclick = () => (busy ? busy.abort() : send());
  render();

  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE)); if (s && Array.isArray(s.turns)) return s; } catch { /* storage unavailable */ }
    return { turns: [], concepts: [] };
  }
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage full or unavailable */ } }

  function addFiles(list) {
    const max = imgLimits?.maxCount || 4;
    for (const f of list) {
      if (!imgLimits.mediaTypes.includes(f.type)) { toast(`${f.name}: use a JPG, PNG, WebP or GIF.`); continue; }
      if (f.size > imgLimits.maxInputBytes) { toast(`${f.name} is too large.`); continue; }
      if (attachments.length >= max) { toast(`At most ${max} images per message.`); break; }
      attachments.push({ file: f, url: URL.createObjectURL(f) });
    }
    renderThumbs();
  }
  function renderThumbs() {
    thumbs.replaceChildren(...attachments.map((a, i) => el("div", { class: "thumb" }, el("img", { src: a.url, alt: a.file.name }),
      el("button", { type: "button", "aria-label": "Remove image", text: "✕", on: { click: () => { URL.revokeObjectURL(a.url); attachments.splice(i, 1); renderThumbs(); } } }))));
    thumbs.hidden = !attachments.length;
  }

  function render() {
    const items = [];
    if (!state.turns.length) {
      items.push(el("div", { class: "msg hint" },
        el("p", { text: "Describe what you'd like and Claude draws a new concept. For example:" }),
        el("ul", {}, ["Make the living room bigger and open it up to the kitchen", "Add a double garage next to the entrance", "Light oak floors and white walls, Scandinavian feel"]
          .map((t) => el("li", {}, el("button", { type: "button", class: "linklike", text: t, on: { click: () => { input.value = t; input.focus(); } } })))),
        imgLimits ? el("p", { class: "muted", text: "You can attach a photo of a sketch or floor plan, or inspiration pictures." }) : null));
    }
    for (const t of state.turns) {
      const c = t.concept != null ? state.concepts.find((x) => x.n === t.concept) : null;
      items.push(el("div", { class: "msg " + t.role },
        t.images ? el("div", { class: "muted small", text: `📎 ${t.images} image${t.images > 1 ? "s" : ""}` }) : null,
        el("p", { text: t.text }),
        t.warnings?.length ? el("ul", { class: "warn" }, t.warnings.map((w) => el("li", { text: w }))) : null,
        t.errors?.length ? el("div", { class: "warn" }, el("p", { text: "This concept couldn't be built:" }), el("ul", {}, t.errors.map((w) => el("li", { text: w }))),
          el("button", { type: "button", text: "Ask Claude to fix it", on: { click: () => send(`Your last plan had these problems, please fix them: ${t.errors.join("; ")}`) } })) : null,
        c ? el("div", { class: "concept" }, el("span", { text: `Concept ${c.n}: ${c.title}` }),
          el("button", { type: "button", text: "Show", on: { click: () => { setPlan(structuredClone(c.plan)); toast(`Showing concept ${c.n}`); } } })) : null));
    }
    if (busy) items.push(el("div", { class: "msg assistant pending" }, el("p", { id: "chat-status", text: "Designing… this can take up to a minute." })));
    list.replaceChildren(...items);
    list.scrollTop = list.scrollHeight;
    sendBtn.textContent = busy ? "Stop" : "Send";
    sendBtn.classList.toggle("primary", !busy);
  }

  async function send(preset) {
    const text = (preset ?? input.value).trim();
    if (!text && !attachments.length) return;
    if (!state.concepts.length) state.concepts.push({ n: 0, title: "Starting plan", plan: structuredClone(getPlan()) });
    const imgs = preset ? [] : attachments.map((a) => a.file);
    state.turns.push({ role: "user", text: text || "(see the attached images)", images: imgs.length || undefined });
    if (!preset) { input.value = ""; attachments.forEach((a) => URL.revokeObjectURL(a.url)); attachments = []; renderThumbs(); }
    persist();
    busy = new AbortController();
    render();
    const started = Date.now();
    const tick = setInterval(() => { const s = document.getElementById("chat-status"); if (s) s.textContent = `Designing… ${Math.round((Date.now() - started) / 1000)} s`; }, 1000);

    // Claude remembers nothing: send the rules, recent turns, and the current plan every time.
    const recent = state.turns.slice(-MAX_TURNS);
    const turns = [{ role: "user", content: RULES }];
    for (const [i, t] of recent.entries()) {
      const last = i === recent.length - 1;
      const content = last
        ? `CURRENT PLAN:\n${JSON.stringify(getPlan())}\n\nREQUEST: ${t.text}${imgs.length ? `\n\n(${imgs.length} image${imgs.length > 1 ? "s" : ""} attached)` : ""}`
        : t.role === "user" ? t.text + (t.images ? ` (with ${t.images} image(s), not shown again)` : "") : t.text;
      turns.push({ role: t.role, content });
    }
    try {
      const res = await sample.json(turns, { signal: busy.signal, images: imgs.length ? imgs : undefined, modelTier: "complex", cache: false });
      const reply = String(res?.reply || "Here's a new concept.");
      if (!res?.plan) {
        state.turns.push({ role: "assistant", text: reply });
      } else {
        const { plan, errors, warnings } = validatePlan({ ...res.plan, style: res.style || getPlan().style });
        if (errors.length) {
          state.turns.push({ role: "assistant", text: reply, errors });
        } else {
          const n = state.concepts.length;
          state.concepts.push({ n, title: String(res.title || `Concept ${n}`).slice(0, 60), plan });
          state.turns.push({ role: "assistant", text: reply, concept: n, warnings });
          setPlan(structuredClone(plan));
        }
      }
    } catch (e) {
      if (e?.code !== "cancelled") state.turns.push({ role: "assistant", text: ERRORS[e?.code] || "Something went wrong reaching Claude. Send it again." });
      else state.turns.push({ role: "assistant", text: "Stopped." });
    } finally {
      clearInterval(tick);
      busy = null;
      // keep the stored chat small: concepts are the bulky part
      if (state.concepts.length > 15) state.concepts.splice(1, state.concepts.length - 15);
      persist();
      render();
    }
  }
}
