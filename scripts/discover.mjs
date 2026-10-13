// Recettes à découvrir pour Sano — tourne chaque nuit sur GitHub Actions.
// Lit les plans de site de HelloFresh, Jow et Marmiton, ouvre des fiches au hasard, garde les recettes
// saines et riches en protéines (valeurs nutritionnelles publiées par le site) et les range par pages de 10
// (variées : plusieurs viandes, poissons, œufs, végé + 2 encas protéinés) dans la branche « data ».
// L'appli lit ces pages une par une avec le bouton « Actualiser ».
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DATA_DIR || "data/discover";
const MAX = +(process.env.MAX_FETCH || 160);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const say = (s) => { log.push(s); console.log(s); };

async function get(url, ms = 20000) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" }, signal: ac.signal });
    return { status: r.status, text: r.ok ? await r.text() : "" };
  } catch (e) { return { status: 0, text: "" }; } finally { clearTimeout(t); }
}
const locs = (x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
function h32(s, seed) { let h = seed >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }
const idOf = (u) => "x" + h32(u, 2166136261) + h32(u, 5381).slice(0, 4);
const decode = (s) => String(s ?? "").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const clean = (s) => decode(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const nrm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/œ/g, "oe");

function findRecipe(n) {
  if (!n || typeof n !== "object") return null;
  if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; }
  const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n;
  return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null;
}
function ld(html) {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { for (const src of [m[1].trim(), m[1].replace(/[\u0000-\u001f]+/g, " ").trim()]) { try { const r = findRecipe(JSON.parse(src)); if (r) return r; break; } catch { /* suivant */ } } }
  return null;
}
const num = (v) => { const m = String(v ?? "").replace(",", ".").match(/\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const iso = (d) => { const m = String(d ?? "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i); return m ? (+(m[1] || 0)) * 1440 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0; };
const imgOf = (i) => !i ? "" : typeof i === "string" ? i : Array.isArray(i) ? imgOf(i.find((x) => /1024x768/.test(String(x?.url || x))) || i[0]) : typeof i.url === "string" ? i.url : "";
const ytId = (u) => { const m = String(u || "").match(/(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ""; };

// --- sources
const SRC = {
  hellofresh: { name: "HelloFresh", maps: ["https://www.hellofresh.fr/sitemap_recipe_pages.xml"], re: /\/recipes\/[a-z0-9-]+-[0-9a-f]{24}$/, w: 4 },
  jow: { name: "Jow", maps: ["https://jow.fr/sitemap.xml"], re: /jow\.fr\/recipes\/[a-z0-9-]+$/, w: 3.5 },
  marmiton: { name: "Marmiton", maps: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `https://www.marmiton.org/wsitemap_recipes_${i}.xml`), re: /\/recettes\/recette_[a-z0-9-]+_\d+\.aspx$/, w: 2.5 },
};
const SNACK_SLUG = /(proteine|skyr|fromage-blanc|cottage|energy-ball|bouchee|muffin|pancake|barre|houmous|hummus|tzatziki|edamame|pois-chiches?-(grilles|rotis|croustillants)|oeufs?-(mimosa|durs?|cocotte|farcis)|roules?-de-jambon|collation|encas|snack|mug-cake|cheesecake|porridge|overnight|yaourt)/;
const BAD = /(frite|friture|beignet|burger|pizza|tartiflette|raclette|fondue|croque|nugget|cordon bleu|pane|panee|chips|gratin dauphinois|aligot|confit|lardon)/;
// catégorie de protéine (pour varier chaque page)
const PT = [["crevettes", /crevette|gambas|fruits? de mer|moules?|calamar|encornet|saint-jacques|noix de st/], ["poisson", /saumon|cabillaud|thon|merlu|\blieu\b|colin|truite|sardine|maquereau|dorade|\bbar\b|poisson|haddock|eglefin|merlan|sole|lotte/],
  ["dinde", /dinde/], ["poulet", /poulet|volaille|pintade/], ["boeuf", /boeuf|veau|steak|bavette|hache|kefta|bolognaise/], ["porc", /porc|jambon|filet mignon|echine|chorizo|saucisse/],
  ["oeufs", /\boeufs?\b|omelette|frittata|shakshuka|chakchouka/], ["vege", /tofu|tempeh|seitan|lentille|pois chiche|haricot|feve|quinoa|falafel/]];
const ptOf = (txt) => { const t = nrm(txt); for (const [p, re] of PT) if (re.test(t)) return p; return "vege"; };

function normIng(src, s) {
  let x = clean(s).replace(/\((?:s|x|es)\)/g, "").replace(/\s{2,}/g, " ").trim();
  if (src === "jow") x = x.replace(/\btran\.?(?=\s)/i, "tranche").replace(/\bc[àa]s\b/gi, "cs").replace(/\bc[àa]c\b/gi, "cc").replace(/\bgr\b/gi, "g");
  return x.slice(0, 140);
}
const SNACK_UNIT = [[/muffin/, "muffins", "muffin"], [/pancake/, "pancakes", "pancake"], [/bouch[ée]e|ball|boule/, "bouchées", "bouchée"], [/barre/, "barres", "barre"], [/cookie|biscuit/, "cookies", "cookie"], [/verrine/, "verrines", "verrine"], [/(oeuf|œuf)s? (mimosa|farci)/, "demi-œufs", "demi-œuf"]];
const SNACK_EMO = [[/chocolat|cacao|brownie/, "🍫"], [/myrtille|fruits rouges|fraise|framboise/, "🍓"], [/banane/, "🍌"], [/pomme/, "🍎"], [/oeuf|œuf|omelette/, "🥚"], [/muffin|cake|pancake/, "🧁"], [/fromage|skyr|yaourt|cottage/, "🧀"], [/cacahu|amande|noisette|noix/, "🥜"], [/houmous|pois chiche|edamame/, "🥕"]];

function toRecipe(key, url, R) {
  const n = R.nutrition || {};
  let k = num(n.calories); if (k != null && /kj/i.test(String(n.calories)) && !/kcal|calor/i.test(String(n.calories))) k = Math.round(k / 4.184);
  const p = num(n.proteinContent), f = num(n.fatContent), c = num(n.carbohydrateContent), fi = num(n.fiberContent), sug = num(n.sugarContent);
  if (!k || p == null || f == null || c == null) return { why: "nutrition absente" };
  const t = clean(R.name).replace(/\s*:\s*la meilleure recette\s*$/i, "").slice(0, 110);
  const ing = (Array.isArray(R.recipeIngredient) ? R.recipeIngredient : []).map((s) => normIng(key, s)).filter(Boolean).slice(0, 30);
  if (!t || ing.length < 2) return { why: "fiche incomplète" };
  const yTxt = Array.isArray(R.recipeYield) ? R.recipeYield.join(" ") : String(R.recipeYield ?? "");
  const y = Math.max(1, Math.min(24, Math.round(num(yTxt) || (key === "jow" ? 1 : 2))));
  const txt = nrm(t + " " + ing.join(" ") + " " + (R.recipeCategory || "") + " " + (R.keywords || ""));
  const cat = nrm(Array.isArray(R.recipeCategory) ? R.recipeCategory.join(" ") : R.recipeCategory || "");
  const slugSnack = SNACK_SLUG.test(nrm(url));
  const pr = (p * 4) / k;
  const o = { id: idOf(url), t, src: SRC[key].name, u: url, img: imgOf(R.image), min: iso(R.totalTime) || iso(R.prepTime) + iso(R.cookTime) || 0, y, ing, n: { k: Math.round(k), p: +p.toFixed(1), f: +f.toFixed(1), c: +c.toFixed(1) } };
  if (fi != null) o.n.fi = +fi.toFixed(1);
  const a = R.author && (Array.isArray(R.author) ? R.author[0] : R.author); const an = clean(a && (a.name || a));
  if (an && !/^(anonyme|jow|hellofresh)$/i.test(an)) o.a = an.slice(0, 50); else if (key === "marmiton") o.a = "Membre Marmiton";
  const ar = R.aggregateRating; if (ar && num(ar.ratingValue) && num(ar.ratingCount || ar.reviewCount)) o.r = [Math.round(num(ar.ratingValue) * 10) / 10, Math.round(num(ar.ratingCount || ar.reviewCount))];
  const vid = R.video && (Array.isArray(R.video) ? R.video[0] : R.video); const yv = ytId(vid && (vid.embedUrl || vid.contentUrl)); if (yv) o.v = yv;
  if (BAD.test(nrm(t))) return { why: "plat trop riche (nom)" };
  if (/dessert|boisson|cocktail|sauce|confiserie/.test(cat) && !slugSnack) return { why: "catégorie " + cat };
  // encas sain et protéiné
  const snackLike = slugSnack || /(petit[- ]dejeuner|brunch|gouter|collation|encas|snack|amuse)/.test(cat + " " + nrm(R.keywords || ""));
  if (snackLike && k <= 300) {
    if (k < 50 || p < 7 || pr < 0.2 || f > 16 || (sug != null && sug > 18)) return { why: "encas pas assez protéiné" };
    o.k = "encas"; const su = SNACK_UNIT.find(([re]) => re.test(nrm(t))); o.yU = su ? su[1] : y > 1 ? "portions" : "portion"; o.uS = su ? su[2] : "portion";
    o.emo = (SNACK_EMO.find(([re]) => re.test(nrm(t))) || [0, "🥚"])[1]; o.pt = "encas"; return { r: o };
  }
  // plat : léger et riche en protéines
  if (k < 280 || k > 720) return { why: `kcal ${Math.round(k)}` };
  if (p < 24 || pr < 0.17) return { why: `protéines ${p} g` };
  if (f > 34) return { why: `lipides ${f} g` };
  o.pt = ptOf(txt); return { r: o };
}

// --- état (dans la branche data)
fs.mkdirSync(path.join(DIR, "p"), { recursive: true });
const SP = path.join(DIR, "state.json");
const st = fs.existsSync(SP) ? JSON.parse(fs.readFileSync(SP, "utf8")) : { seen: {}, pending: [], titles: {}, pages: 0, total: 0, runs: 0 };
const IX = path.join(DIR, "index.json");

async function urlsOf(key) {
  const S = SRC[key]; const all = [];
  for (const m of S.maps) { const r = await get(m); const L = locs(r.text).filter((u) => S.re.test(u)); all.push(...L); say(`plan ${key} ${r.status} ${m} → ${L.length}`); await sleep(400); }
  return all;
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const cand = { main: [], snack: [] };
for (const key of Object.keys(SRC)) {
  const L = shuffle((await urlsOf(key)).filter((u) => !st.seen[idOf(u)]));
  const snack = L.filter((u) => SNACK_SLUG.test(nrm(u))), main = L.filter((u) => !SNACK_SLUG.test(nrm(u)));
  const wSum = Object.values(SRC).reduce((a, s) => a + s.w, 0), share = SRC[key].w / wSum;
  cand.main.push(...main.slice(0, Math.round(MAX * 0.7 * share)).map((u) => [key, u]));
  cand.snack.push(...snack.slice(0, Math.round(MAX * 0.3 * share) + 4).map((u) => [key, u]));
}
const queue = shuffle([...cand.main, ...cand.snack]).slice(0, MAX);
say(`à lire : ${queue.length} fiches (${cand.snack.length} pistes d'encas)`);
const why = {}; let ok = 0;
for (const [key, url] of queue) {
  const r = await get(url); st.seen[idOf(url)] = 1;
  if (r.status !== 200) { why["http " + r.status] = (why["http " + r.status] || 0) + 1; await sleep(500); continue; }
  const R = ld(r.text); if (!R) { why["pas de fiche"] = (why["pas de fiche"] || 0) + 1; await sleep(300); continue; }
  const x = toRecipe(key, url, R);
  if (x.r) { const tk = nrm(x.r.t).replace(/[^a-z0-9]+/g, " ").trim(); if (st.titles[tk]) { why["doublon"] = (why["doublon"] || 0) + 1; } else { st.titles[tk] = 1; st.pending.push(x.r); ok++; } }
  else { const w = x.why.replace(/\d+(\.\d+)?/g, "#"); why[w] = (why[w] || 0) + 1; }
  await sleep(350);
}
say(`gardées : ${ok} · écartées : ${JSON.stringify(why)}`);

// --- pages de 10 : une recette par catégorie à tour de rôle + 2 encas
function takePage(force) {
  const P = st.pending; const sn = P.filter((r) => r.k === "encas"), mains = P.filter((r) => r.k !== "encas");
  if (!force && (mains.length < 8 || P.length < 10)) return null;
  const G = {}; for (const r of mains) (G[r.pt] = G[r.pt] || []).push(r);
  const cats = shuffle(Object.keys(G)); const out = []; const nM = Math.min(10 - Math.min(2, sn.length), mains.length);
  for (let i = 0; out.length < nM; i++) { let any = false; for (const c of cats) { if (G[c][i] && out.length < nM) { out.push(G[c][i]); any = true; } } if (!any) break; }
  sn.slice(0, 10 - out.length).forEach((r, k) => out.splice(Math.min(out.length, 3 + k * 4), 0, r));
  const ids = new Set(out.map((r) => r.id)); st.pending = P.filter((r) => !ids.has(r.id)); return out;
}
let made = 0, pg;
while ((pg = takePage(false))) { st.pages++; st.total += pg.length; fs.writeFileSync(path.join(DIR, "p", `${st.pages}.json`), JSON.stringify(pg)); made++; }
st.runs++;
fs.writeFileSync(SP, JSON.stringify(st));
fs.writeFileSync(IX, JSON.stringify({ v: 1, updated: new Date().toISOString(), pages: st.pages, total: st.total, sources: Object.values(SRC).map((s) => s.name) }));
say(`pages créées : ${made} · total ${st.pages} pages, ${st.total} recettes · en attente ${st.pending.length}`);
fs.writeFileSync(path.join(DIR, "log.txt"), log.join("\n") + "\n");
