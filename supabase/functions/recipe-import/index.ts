// Supabase Edge Function « recipe-import » pour Notre semaine
// - action "import" : lit une page (site de recettes, YouTube, Instagram, TikTok…) et renvoie
//   titre, photo, ingrédients, étapes, portions, temps et valeurs nutritionnelles quand la page les donne.
// - action "photo"  : range la photo d'une recette dans le stockage Supabase (dossier public « recettes »).
// - action "meal"   : analyse la photo d'un plateau (cantine, restaurant) et estime aliments, portions et nutriments.
//   Nécessite un secret GEMINI_API_KEY (clé gratuite Google AI Studio) ou ANTHROPIC_API_KEY.
// Réservée aux foyers existants : l'en-tête x-foyer doit correspondre à une ligne de la table planner.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-foyer, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SB = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const UA_WEB = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const UA_BOT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const SOCIAL = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|threads\.net|amzn\.to|amazon\.[a-z.]+|linktr\.ee|patreon\.com|spotify\.com)$/i;

type Out = {
  ok: boolean; kind: "recipe" | "text"; title: string; image: string; ingredients: string[]; steps: string[];
  yield: string; time: number | null; nutrition: Record<string, number> | null; text: string; video: string;
};
const blank = (): Out => ({ ok: true, kind: "text", title: "", image: "", ingredients: [], steps: [], yield: "", time: null, nutrition: null, text: "", video: "" });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
function decode(s: string) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function strip(html: string) {
  return decode(String(html).replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h\d|tr|section|article)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
}
function meta(html: string, key: string) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"));
  if (!m) return "";
  const c = m[0].match(/content="([^"]*)"|content='([^']*)'/i);
  return c ? decode(c[1] ?? c[2] ?? "").trim() : "";
}
function safeUrl(u: string) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return null;
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || /^[\d.]+$/.test(h) || h.includes(":") || /\.(local|internal|lan|home)$/.test(h) || !h.includes(".")) return null;
    return x;
  } catch { return null; }
}
async function getPage(url: string, ua: string, ms = 12000, max = 3_000_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const headers: Record<string, string> = { "User-Agent": ua, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6", Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" };
    if (/youtube\.com|youtu\.be/.test(url)) headers.Cookie = "CONSENT=YES+cb; SOCS=CAI";
    const r = await fetch(url, { headers, redirect: "follow", signal: ac.signal });
    const reader = r.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.length;
      chunks.push(value);
      if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } break; }
    }
    const buf = new Uint8Array(size);
    let o = 0;
    for (const c of chunks) { buf.set(c.subarray(0, Math.min(c.length, size - o)), o); o += c.length; if (o >= size) break; }
    return { status: r.status, url: r.url || url, text: new TextDecoder("utf-8").decode(buf) };
  } finally { clearTimeout(t); }
}
// ---------- fiches recettes (schema.org/Recipe en JSON-LD) ----------
// deno-lint-ignore no-explicit-any
function findRecipe(node: any): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = findRecipe(n); if (r) return r; } return null; }
  const t = node["@type"];
  if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return node;
  return findRecipe(node["@graph"]) || findRecipe(node.mainEntity) || null;
}
function ldRecipe(html: string) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    for (const src of [m[1].trim(), m[1].replace(/[\u0000-\u001f]+/g, " ").trim()]) {
      try { const r = findRecipe(JSON.parse(src)); if (r) return r; break; } catch { /* essai suivant */ }
    }
  }
  return null;
}
// deno-lint-ignore no-explicit-any
function stepsOf(ins: any): string[] {
  const out: string[] = [];
  // deno-lint-ignore no-explicit-any
  const walk = (x: any) => {
    if (!x) return;
    if (typeof x === "string") { x.split(/\n+/).forEach((s) => { s = strip(s); if (s) out.push(s); }); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.itemListElement) { walk(x.itemListElement); return; }
    if (x.text) walk(x.text); else if (x.name) walk(x.name);
  };
  walk(ins);
  return out.slice(0, 30);
}
function iso(d: unknown) {
  const m = String(d ?? "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return 0;
  return (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}
function num(v: unknown) {
  const m = String(v ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
// deno-lint-ignore no-explicit-any
function imgOf(i: any): string {
  if (!i) return "";
  if (typeof i === "string") return i;
  if (Array.isArray(i)) return imgOf(i[0]);
  return typeof i.url === "string" ? i.url : "";
}
// deno-lint-ignore no-explicit-any
function fromRecipe(r: any, out: Out) {
  out.kind = "recipe";
  out.title = strip(r.name || out.title || "");
  out.image = imgOf(r.image) || out.image;
  out.ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : []).map((s: unknown) => strip(String(s))).filter(Boolean).slice(0, 40);
  out.steps = stepsOf(r.recipeInstructions);
  const y = Array.isArray(r.recipeYield) ? r.recipeYield.find((x: unknown) => /\D/.test(String(x))) || r.recipeYield[0] : r.recipeYield;
  out.yield = y == null ? "" : String(y).slice(0, 40);
  const tt = iso(r.totalTime) || iso(r.prepTime) + iso(r.cookTime);
  out.time = tt || null;
  const n = r.nutrition;
  if (n && typeof n === "object") {
    let k = num(n.calories);
    if (k != null && /kj/i.test(String(n.calories)) && !/kcal/i.test(String(n.calories))) k = Math.round(k / 4.184);
    if (k) out.nutrition = { k, p: num(n.proteinContent) ?? 0, f: num(n.fatContent) ?? 0, c: num(n.carbohydrateContent) ?? 0, fi: num(n.fiberContent) ?? 0 };
  }
  // deno-lint-ignore no-explicit-any
  const v: any = Array.isArray(r.video) ? r.video[0] : r.video;
  if (v && typeof v === "object") out.video = String(v.embedUrl || v.contentUrl || "");
  return out;
}
function textOfPage(html: string) {
  const main = html.match(/<(article|main)[\s\S]*?<\/\1>/i);
  return strip(main ? main[0] : html.replace(/<(header|nav|footer|aside)[\s\S]*?<\/\1>/gi, " ")).slice(0, 12000);
}
// ---------- réseaux sociaux ----------
function ytId(u: string) {
  const m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}
async function youtube(url: string, id: string): Promise<Out> {
  const out = blank();
  out.video = `https://www.youtube.com/watch?v=${id}`;
  out.image = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const p = await getPage(`https://www.youtube.com/watch?v=${id}&hl=fr&gl=FR`, UA_WEB);
  const d = p.text.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  const t = p.text.match(/"title":"((?:[^"\\]|\\.)*)","lengthSeconds"/);
  try { out.text = d ? JSON.parse(`"${d[1]}"`) : meta(p.text, "og:description"); } catch { out.text = meta(p.text, "og:description"); }
  try { out.title = t ? JSON.parse(`"${t[1]}"`) : meta(p.text, "og:title"); } catch { out.title = meta(p.text, "og:title"); }
  if (!out.title) {
    try { const o = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`); if (o.ok) out.title = (await o.json()).title || ""; } catch { /* ignore */ }
  }
  // la recette complète est souvent sur un site lié dans la description
  const links = [...new Set((out.text.match(/https?:\/\/[^\s)"'<>]+/g) || []))].filter((l) => { const x = safeUrl(l); return x && !SOCIAL.test(x.hostname); }).slice(0, 2);
  for (const l of links) {
    try {
      const q = await getPage(l, UA_WEB, 8000);
      const r = ldRecipe(q.text);
      if (r) { const o2 = fromRecipe(r, blank()); o2.video = out.video; o2.text = out.text; if (!o2.image) o2.image = out.image; return o2; }
    } catch { /* lien suivant */ }
  }
  return out;
}
async function instagram(url: string): Promise<Out> {
  const out = blank();
  const m = url.match(/instagram\.com\/(?:[^/?#]+\/)?(p|reels?|tv)\/([A-Za-z0-9_-]+)/i);
  if (m) {
    try {
      const p = await getPage(`https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/embed/captioned/`, UA_WEB);
      const c = p.text.match(/class="Caption"[^>]*>([\s\S]*?)<div class="CaptionComments"/i);
      if (c) out.text = strip(c[1].replace(/<a[^>]*class="CaptionUsername"[^>]*>[\s\S]*?<\/a>/i, ""));
      const im = p.text.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i);
      if (im) out.image = decode(im[1]);
    } catch { /* essai suivant */ }
  }
  if (!out.text) {
    const p = await getPage(url, UA_BOT);
    const d = meta(p.text, "og:description") || meta(p.text, "description");
    const q = d.match(/:\s*[“"]([\s\S]+)[”"]\s*\.?$/);
    out.text = q ? q[1] : d;
    out.image = out.image || meta(p.text, "og:image");
    out.title = meta(p.text, "og:title");
  }
  if (!out.text && !out.image) throw Object.assign(new Error("Instagram n'a pas donné la publication (compte privé ou connexion demandée)"), { code: "blocked" });
  return out;
}
async function tiktok(url: string): Promise<Out> {
  const out = blank();
  const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { "User-Agent": UA_WEB } });
  if (r.ok) { const j = await r.json(); out.text = String(j.title || ""); out.image = String(j.thumbnail_url || ""); }
  if (!out.text) { const p = await getPage(url, UA_BOT); out.text = meta(p.text, "og:description") || meta(p.text, "description"); out.image = out.image || meta(p.text, "og:image"); }
  return out;
}
async function generic(url: string): Promise<Out> {
  const out = blank();
  let p = await getPage(url, UA_WEB);
  let r = p.status < 400 ? ldRecipe(p.text) : null;
  if (!r && (p.status >= 400 || p.text.length < 2000)) {
    const p2 = await getPage(url, UA_BOT);
    if (p2.status < 400) { p = p2; r = ldRecipe(p.text); }
  }
  if (p.status >= 400 && !r) throw Object.assign(new Error(`le site répond ${p.status}`), { code: "blocked" });
  out.title = meta(p.text, "og:title") || strip((p.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || ["", ""])[1]);
  out.image = meta(p.text, "og:image");
  if (r) return fromRecipe(r, out);
  out.text = [meta(p.text, "og:description") || meta(p.text, "description"), textOfPage(p.text)].filter(Boolean).join("\n");
  return out;
}
async function importUrl(u: URL): Promise<Out> {
  const url = u.toString(), h = u.hostname.toLowerCase();
  const yid = ytId(url);
  if (yid) return await youtube(url, yid);
  if (/(^|\.)instagram\.com$/.test(h)) return await instagram(url);
  if (/(^|\.)tiktok\.com$/.test(h)) return await tiktok(url);
  return await generic(url);
}
// ---------- photos ----------
async function sha16(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
async function photo(code: string, id: unknown, data: unknown) {
  if (!SR || !SB) return json({ error: "storage", message: "stockage indisponible" }, 500);
  const m = String(data || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return json({ error: "photo" }, 400);
  const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bin.length > 1_000_000) return json({ error: "photo", message: "photo trop lourde" }, 413);
  const auth = { apikey: SR, Authorization: `Bearer ${SR}` };
  await fetch(`${SB}/storage/v1/bucket`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id: "recettes", name: "recettes", public: true, file_size_limit: 1048576, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] }) }).catch(() => null);
  const path = `${await sha16(code)}/${String(id || "photo").replace(/[^a-z0-9_]/gi, "").slice(0, 40) || "photo"}-${Date.now().toString(36)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  const up = await fetch(`${SB}/storage/v1/object/recettes/${path}`, { method: "POST", headers: { ...auth, "Content-Type": `image/${m[1]}`, "x-upsert": "true", "cache-control": "max-age=31536000" }, body: bin });
  if (!up.ok) return json({ error: "storage", message: (await up.text()).slice(0, 200) }, 500);
  return json({ url: `${SB}/storage/v1/object/public/recettes/${path}` });
}
// ---------- analyse d'un plateau-repas en photo ----------
const MEAL_PROMPT = `Tu es diététicien. La photo montre un repas : plateau de cantine d'entreprise, assiette ou repas au restaurant, en France.
Identifie chaque aliment ou plat visible (entrée, plat, accompagnement, sauce, pain, laitage, dessert, boisson) et estime de façon réaliste la portion en grammes, puis ses valeurs nutritionnelles pour cette portion.
Réponds UNIQUEMENT avec ce JSON, sans texte autour :
{"items":[{"n":"Poulet rôti","g":150,"k":285,"p":38,"f":14,"c":0,"fi":0}],"note":"une phrase courte sur ce qui est incertain"}
n = nom court en français, g = grammes, k = kcal, p = protéines, f = lipides, c = glucides, fi = fibres (en grammes).
Si la photo ne montre pas de repas, renvoie {"items":[],"note":"…"}.`;
function parseJson(text: string) {
  const s = String(text || "").replace(/```json|```/g, "");
  const i = s.indexOf("{"), k = s.lastIndexOf("}");
  if (i < 0 || k < i) return null;
  try { return JSON.parse(s.slice(i, k + 1)); } catch { return null; }
}
async function meal(data: unknown) {
  const m = String(data || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return json({ error: "photo" }, 400);
  if (m[2].length > 3_000_000) return json({ error: "photo", message: "photo trop lourde" }, 413);
  const GK = Deno.env.get("GEMINI_API_KEY") ?? "", AK = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!GK && !AK) return json({ error: "noai" }, 501);
  let text = "", used = "", lastErr = "";
  if (GK) {
    for (const mo of [Deno.env.get("GEMINI_MODEL"), "gemini-flash-latest", "gemini-2.5-flash"].filter(Boolean) as string[]) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mo}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": GK },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: `image/${m[1]}`, data: m[2] } }, { text: MEAL_PROMPT }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
      });
      if (r.status === 404) continue;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { lastErr = j?.error?.message || `Gemini ${r.status}`; break; }
      // deno-lint-ignore no-explicit-any
      text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
      used = mo;
      break;
    }
  }
  if (!text && AK) {
    for (const mo of [Deno.env.get("ANTHROPIC_MODEL"), "claude-haiku-5-5", "claude-sonnet-5-5"].filter(Boolean) as string[]) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "x-api-key": AK, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: mo, max_tokens: 1200, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } }, { type: "text", text: MEAL_PROMPT }] }] }),
      });
      if (r.status === 404) continue;
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { lastErr = j?.error?.message || `Anthropic ${r.status}`; break; }
      // deno-lint-ignore no-explicit-any
      text = (j?.content || []).map((c: any) => c.text || "").join("");
      used = mo;
      break;
    }
  }
  if (!text) return json({ error: "ai", message: (lastErr || "aucune réponse du service d'analyse").slice(0, 160) }, 502);
  const o = parseJson(text) || {};
  const n = (v: unknown, max: number) => { const x = Number(v); return isFinite(x) && x >= 0 ? Math.min(max, Math.round(x * 10) / 10) : 0; };
  // deno-lint-ignore no-explicit-any
  const items = (Array.isArray(o.items) ? o.items : []).filter((x: any) => x && x.n).slice(0, 12).map((x: any) => ({ n: String(x.n).slice(0, 40), g: n(x.g, 2000), k: Math.round(n(x.k, 3000)), p: n(x.p, 300), f: n(x.f, 300), c: n(x.c, 500), fi: n(x.fi, 100) }));
  return json({ items, note: String(o.note || "").slice(0, 200), model: used });
}
// ---------- accès réservé aux foyers ----------
async function foyerOk(code: string, apikey: string) {
  if (!/^[a-f0-9]{24,64}$/.test(code) || !SB) return false;
  const key = SR || apikey || ANON;
  if (!key) return false;
  const r = await fetch(`${SB}/rest/v1/planner?id=eq.${code}&select=id`, { headers: { apikey: key, Authorization: `Bearer ${key}`, "x-foyer": code } });
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const code = (req.headers.get("x-foyer") || "").toLowerCase();
  if (!(await foyerOk(code, req.headers.get("apikey") || ""))) return json({ error: "foyer" }, 403);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "body" }, 400); }
  try {
    if (body.action === "photo") return await photo(code, body.id, body.data);
    if (body.action === "meal") return await meal(body.data);
    if (body.action === "import") {
      const u = safeUrl(String(body.url || "").trim());
      if (!u) return json({ error: "url" }, 400);
      return json(await importUrl(u));
    }
    return json({ error: "action" }, 400);
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const err = e as any;
    return json({ error: err?.code === "blocked" ? "blocked" : err?.name === "AbortError" ? "timeout" : "fetch", message: String(err?.message || err).slice(0, 160) }, 502);
  }
});
