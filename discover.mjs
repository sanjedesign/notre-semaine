// Recettes à découvrir pour Sano — tourne trois fois par jour sur GitHub Actions.
// Lit les plans de site de HelloFresh, Jow, Marmiton, Betty Bossi, Ptitchef et Fourchette & Bikini, plus des recherches Marmiton ciblées
// (poulet, dinde, poisson, skyr, cottage…), ouvre d'abord les fiches dont l'adresse annonce des protéines,
// garde les recettes saines et riches en protéines (valeurs nutritionnelles publiées par le site)
// et les range par pages de 10 (5 plats variés : viandes, poissons, œufs, végé + 5 encas protéinés) dans la branche « data ».
// DRY_RUN=1 : lit quelques fiches et affiche le résultat sans rien écrire (SOURCES=bettybossi,fourchette pour en choisir).
// L'appli lit ces pages une par une avec le bouton « Actualiser ».
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DATA_DIR || "data/discover";
const MAX = +(process.env.MAX_FETCH || 160);
const DRY = process.env.DRY_RUN === "1";
const ONLY = (process.env.SOURCES || "").split(",").map((x) => x.trim()).filter(Boolean);
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

// --- recherches Marmiton ciblées sur les protéines (pages de résultats au hasard à chaque passage)
const MQ = ["blanc de poulet", "filet de poulet", "escalope de dinde", "dinde", "poulet léger", "cabillaud", "saumon", "thon", "crevettes", "colin", "merlu", "lieu noir",
  "steak haché", "boeuf", "filet mignon de porc", "veau", "lentilles", "pois chiches", "tofu", "oeufs", "riche en protéines", "protéiné", "high protein",
  "skyr", "fromage blanc", "cottage cheese", "pancakes protéinés", "muffins protéinés", "barre protéinée", "energy balls protéinées", "mug cake protéiné",
  "porridge protéiné", "overnight oats protéiné", "rillettes de thon", "houmous", "edamame", "oeufs mimosa", "jambon de dinde", "quark", "whey"];
const mqUrls = (n) => shuffle([...MQ]).slice(0, n).map((q) => { const pg = 1 + Math.floor(Math.random() * 4); return `https://www.marmiton.org/recettes/recherche.aspx?aqt=${encodeURIComponent(q)}${pg > 1 ? "&page=" + pg : ""}`; });

// --- sources
// w : part des fiches lues ; sub : sous-plans à suivre dans un plan d'index
const SRC = {
  hellofresh: { name: "HelloFresh", maps: ["https://www.hellofresh.fr/sitemap_recipe_pages.xml"], re: /\/recipes\/[a-z0-9-]+-[0-9a-f]{24}$/, w: 3 },
  jow: { name: "Jow", maps: ["https://jow.fr/sitemap.xml"], re: /jow\.fr\/recipes\/[a-z0-9-]+$/, w: 2 },
  marmiton: { name: "Marmiton", maps: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `https://www.marmiton.org/wsitemap_recipes_${i}.xml`), lists: () => mqUrls(14), re: /\/recettes\/recette_[a-z0-9-]+_\d+\.aspx$/, w: 3 },
  bettybossi: { name: "Betty Bossi", maps: ["https://www.bettybossi.ch/sitemap.xml"], sub: /fr/i, re: /bettybossi\.ch\/fr\/recettes\/recette\/[a-z0-9-]+-\d+\/?$/, w: 3 },
  ptitchef: { name: "Ptitchef", maps: ["https://www.ptitchef.com/upload_data/sitemaps/recipe-fr-1.xml", "https://www.ptitchef.com/upload_data/sitemaps/recipe-fr-2.xml"], re: /ptitchef\.com\/recettes\/(plat|entree|aperitif|brunch|petit-dejeuner|accompagnement|autre)\/[a-z0-9-]+-fid-\d+$/, w: 1 },
  fourchette: { name: "Fourchette & Bikini", maps: ["https://www.fourchette-et-bikini.fr/xml/sitemap.xml"], sub: /recette/i, re: /fourchette-et-bikini\.fr\/recettes\/[a-z0-9-]+-(?:[2-9]\d{4}|\d{6,})\.html$/, w: 3 },
};
// seuils protéines (les mêmes dans l'appli) : plat ≥ 28 g par portion et ≥ 24 % des calories ; encas ≥ 10 g et ≥ 25 %
const PRULE = { plat: { p: 28, r: 0.24 }, encas: { p: 10, r: 0.25 } };
const protOk = (e) => { const R = PRULE[e.k === "encas" ? "encas" : "plat"]; const n = e.n || {}; return n.k > 0 && n.p >= R.p && (n.p * 4) / n.k >= R.r; };
// fiches visées en priorité : leur adresse annonce un aliment riche en protéines
const PROT_SLUG = /(proteine|protein|poulet|dinde|volaille|boeuf|steak|bavette|veau|porc|filet-mignon|escalope|agneau|canard|kefta|boulette|saumon|cabillaud|thon|merlu|colin|lieu|truite|sardine|maquereau|dorade|poisson|crevette|gambas|moule|calamar|encornet|saint-jacques|oeuf|omelette|frittata|shakshuka|tofu|tempeh|seitan|lentille|pois-chiche|haricot|edamame|skyr|fromage-blanc|cottage|ricotta|quark|halloumi|jambon|whey)/;
// recettes écrites pour un robot de cuisine : étapes inutilisables sans l'appareil
const ROBOT = /thermomix|cookeo|monsieur[- ]cuisine|companion|i-cook|magimix|cook-?expert|multicuiseur/i;
const SNACK_SLUG = /(proteine|skyr|fromage-blanc|cottage|energy-?ball|bouchee|muffin|pancake|barre|houmous|hummus|tzatziki|tatziki|edamame|pois-chiches?-(grilles|rotis|croustillants)|oeufs?-(mimosa|durs?|cocotte|farcis)|roules?-de-(jambon|saumon|dinde)|collation|encas|snack|mug-?cake|cheesecake|porridge|overnight|yaourt|trempette|tartinade|verrine|smoothie|gaufre|crackers?|bol-|bowl-cake|oeufs?-brouilles|omelette-roulee|mini-|brochettes?-apero|tartare-de-saumon|rillettes-de-(thon|saumon|sardine|maquereau))/;
const BAD = /(frite|friture|beignet|burger|pizza|tartiflette|raclette|fondue|croque|nugget|cordon bleu|\bpanee?s?\b|chips|gratin dauphinois|aligot|confit|lardon|camembert|\bbrie\b|mont d.or|reblochon|tarte|quiche|feuillete|feuilletee|pate brisee|terrine|navets? sales|choucroute|cassoulet|carbonara|kebab|tacos? (frite|frites)|hot ?dog|grilled cheese|pepperoni|gateau|anniversaire)/;
const SNACK_T = /(muffin|pancake|energy|bouchee|barre|cookie|mug ?cake|cheesecake|porridge|overnight|mimosa|roule|verrine|mousse|bowl ?cake|tartine|houmous|hummus|tzatziki|trempette|\bdip\b|crackers?|smoothie|yaourt|skyr|fromage blanc|cottage|oeufs? (durs?|a la coque|coque|cocotte|mimosa|farcis?)|oeuf (dur|a la coque|cocotte|mimosa|farci)|collation|encas|snack|gaufre|madeleine|edamame|pois chiches? (grilles|rotis|croustillants))/;
const MEAL_T = /(puree|\briz\b|pates|spaghetti|semoule|quinoa|boulgour|nouilles|gratin|curry|mijote|roti|poelee|risotto|wok|bowl(?! ?cake)|tajine|blanquette|pot-au-feu)/;
// catégorie de protéine (pour varier chaque page)
const PT = [["crevettes", /crevette|gambas|fruits? de mer|\bmoules?\b|calamar|encornet|saint-jacques|noix de st|surimi|crabe/], ["poisson", /saumon|cabillaud|thon|merlu|\blieu\b|colin|truite|sardine|maquereau|dorade|\bbar\b|poisson|haddock|eglefin|merlan|sole|lotte/],
  ["dinde", /dinde/], ["poulet", /poulet|volaille|pintade|canard|caille/], ["boeuf", /boeuf|veau|steak|bavette|hache|kefta|bolognaise|viande|boulette|agneau|paleron|tagliata/], ["porc", /porc|jambon|filet mignon|echine|chorizo|saucisse/],
  ["oeufs", /\boeufs?\b|omelette|frittata|shakshuka|chakchouka/], ["vege", /tofu|tempeh|seitan|lentille|pois chiche|haricot|feve|quinoa|falafel/]];
// d'abord le titre (« Œufs cocotte aux asperges » = œufs), puis les premiers ingrédients
const VEG = /\bv[eé]g[eé]|vegetari|vegan|tofu|tempeh|seitan|falafel|halloumi|paneer/;
const ptOf = (title, ing) => { const t = nrm(title); if (VEG.test(t)) return "vege"; for (const [p, re] of PT) if (re.test(t)) return p;
  const i = nrm(ing.slice(0, 6).join(" | ")); for (const [p, re] of PT) if (re.test(i)) return p; return "vege"; };

function normIng(src, s) {
  let x = clean(s).replace(/\((?:s|x|es)\)/g, "").replace(/\s{2,}/g, " ").trim();
  if (src === "jow") x = x.replace(/\btran\.?(?=\s)/i, "tranche").replace(/\bc[àa]s\b/gi, "cs").replace(/\bc[àa]c\b/gi, "cc").replace(/\bgr\b/gi, "g");
  return x.slice(0, 140);
}
const SNACK_UNIT = [[/muffin/, "muffins", "muffin"], [/pancake/, "pancakes", "pancake"], [/bouch[ée]e|ball|boule/, "bouchées", "bouchée"], [/barre/, "barres", "barre"], [/cookie|biscuit/, "cookies", "cookie"], [/verrine/, "verrines", "verrine"], [/(oeuf|œuf)s? (mimosa|farci)/, "demi-œufs", "demi-œuf"]];
const SNACK_EMO = [[/chocolat|cacao|brownie/, "🍫"], [/myrtille|fruits rouges|fraise|framboise/, "🍓"], [/banane/, "🍌"], [/pomme/, "🍎"], [/oeuf|œuf|omelette/, "🥚"], [/muffin|cake|pancake/, "🧁"], [/fromage|skyr|yaourt|cottage/, "🧀"], [/cacahu|amande|noisette|noix/, "🥜"], [/houmous|pois chiche|edamame/, "🥕"]];

function toRecipe(key, url, R, hint) {
  const n = R.nutrition || {};
  let k = num(n.calories); if (k != null && /kj/i.test(String(n.calories)) && !/kcal|calor/i.test(String(n.calories))) k = Math.round(k / 4.184);
  const p = num(n.proteinContent), f = num(n.fatContent), c = num(n.carbohydrateContent), fi = num(n.fiberContent), sug = num(n.sugarContent);
  if (!k || p == null || f == null || c == null) return { why: "nutrition absente" };
  const t = clean(R.name).replace(/\s*:\s*la meilleure recette\s*$/i, "").replace(/\s*-\s*que du bon\b.*$/i, "").replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/\s{2,}/g, " ").trim().slice(0, 110);
  if (ROBOT.test(t)) return { why: "robot de cuisine" };
  const ingSrc = Array.isArray(R.recipeIngredient) && R.recipeIngredient.length ? R.recipeIngredient : Array.isArray(R.ingredients) ? R.ingredients : [];
  const ing = ingSrc.map((s) => normIng(key, s)).filter(Boolean).slice(0, 30);
  if (!t || ing.length < 2) { if (DRY) say("   incomplète " + url + " clés=" + Object.keys(R).join(",")); return { why: "fiche incomplète" }; }
  const yTxt = Array.isArray(R.recipeYield) ? R.recipeYield.join(" ") : String(R.recipeYield ?? "");
  const y = Math.max(1, Math.min(24, Math.round(num(yTxt) || (key === "jow" ? 1 : 2))));
  const cat = nrm(Array.isArray(R.recipeCategory) ? R.recipeCategory.join(" ") : R.recipeCategory || "");
  const pr = (p * 4) / k;
  const o = { id: idOf(url), t, src: SRC[key].name, u: url, img: imgOf(R.image), min: iso(R.totalTime) || iso(R.prepTime) + iso(R.cookTime) || 0, y, ing, n: { k: Math.round(k), p: +p.toFixed(1), f: +f.toFixed(1), c: +c.toFixed(1) } };
  if (fi != null) o.n.fi = +fi.toFixed(1);
  const a = R.author && (Array.isArray(R.author) ? R.author[0] : R.author); const an = clean(a && (a.name || a));
  if (an && !/^(anonyme|jow|hellofresh|betty bossi|fourchette (et|&) bikini|redaction|rédaction)$/i.test(an)) o.a = an.slice(0, 50); else if (key === "marmiton") o.a = "Membre Marmiton";
  const ar = R.aggregateRating; if (ar && num(ar.ratingValue) && num(ar.ratingCount || ar.reviewCount)) o.r = [Math.round(num(ar.ratingValue) * 10) / 10, Math.round(num(ar.ratingCount || ar.reviewCount))];
  const vid = R.video && (Array.isArray(R.video) ? R.video[0] : R.video); const yv = ytId(vid && (vid.embedUrl || vid.contentUrl)); if (yv) o.v = yv;
  if (BAD.test(nrm(t))) return { why: "plat trop riche (nom)" };
  if (/\b(langues?|ris de veau|rognons?|foies?|tripes?|cervelle|boudin|andouillettes?|gesiers?|coeurs? de (boeuf|volaille|poulet))\b/.test(nrm(t))) return { why: "abats" };
  if (/\/recipe-type\//.test(o.img)) o.img = "";
  if (key === "ptitchef" && !o.img) return { why: "sans photo" };
  if (/dessert|boisson|cocktail|sauce|confiserie/.test(cat) && !SNACK_T.test(nrm(t))) return { why: "catégorie " + cat };
  // encas sain et protéiné
  const tt = nrm(t);
  // piste d'encas (adresse de la fiche) ou titre / catégorie d'encas
  const snackLike = !MEAL_T.test(tt) && (SNACK_T.test(tt) || (hint && k <= 350) || /(petit[- ]dejeuner|brunch|gouter|collation|encas|snack|aperitif|amuse|en-cas)/.test(cat + " " + nrm(R.keywords || "")));
  if (snackLike && k <= 320 && !(/(cake|brownie|cookie|crepe|gaufre|madeleine)/.test(tt) && !/prot[eé]in/.test(tt))) {
    if (k < 50 || p < PRULE.encas.p || pr < PRULE.encas.r || f > 16 || (sug != null && sug > 18)) return { why: "encas pas assez protéiné" };
    if (/(bacon|chorizo|saucisson|rillette|lardon|salami)/.test(tt)) return { why: "encas trop gras" };
    o.k = "encas"; const su = SNACK_UNIT.find(([re]) => re.test(nrm(t))); o.yU = su ? su[1] : y > 1 ? "portions" : "portion"; o.uS = su ? su[2] : "portion";
    o.emo = (SNACK_EMO.find(([re]) => re.test(nrm(t))) || [0, "🥚"])[1]; o.pt = "encas"; return { r: o };
  }
  // plat : léger et riche en protéines
  if (k < 280 || k > 680) return { why: `kcal ${Math.round(k)}` };
  if (p < PRULE.plat.p || pr < PRULE.plat.r) return { why: `protéines ${p} g` };
  if (f > 30 || (f * 9) / k > 0.45) return { why: `lipides ${f} g` };
  o.pt = ptOf(t, ing); return { r: o };
}

// --- état (dans la branche data)
if (!DRY) fs.mkdirSync(path.join(DIR, "p"), { recursive: true });
const SP = path.join(DIR, "state.json");
const RULES = 3;
let st = !DRY && fs.existsSync(SP) ? JSON.parse(fs.readFileSync(SP, "utf8")) : null;
if (DRY) st = { rules: RULES, seen: {}, pending: [], titles: {}, pages: 0, total: 0, runs: 0 };
else if (!st || st.rules !== RULES) { if (st) say(`nouvelles règles (v${RULES}) : collecte reprise de zéro`); st = { rules: RULES, seen: {}, pending: [], titles: {}, pages: 0, total: 0, runs: 0 };
  for (const f of fs.readdirSync(path.join(DIR, "p"))) fs.unlinkSync(path.join(DIR, "p", f)); }
const IX = path.join(DIR, "index.json");

async function urlsOf(key) {
  const S = SRC[key]; const all = [], pri = []; const q = [...S.maps]; const done = new Set(); let n = 0;
  // pages de résultats de recherche : les liens de recettes passent en premier
  for (const l of S.lists ? S.lists() : []) { const r = await get(l); const hits = [...new Set([...r.text.matchAll(/href="([^"]+)"/g)].map((m) => { try { return new URL(m[1].replace(/&amp;/g, "&"), l).href.split("#")[0]; } catch { return ""; } }).filter((u) => S.re.test(u) && !ROBOT.test(u)))];
    pri.push(...hits); say(`recherche ${key} ${r.status} ${decodeURIComponent(l.split("aqt=")[1] || l)} → ${hits.length}`); await sleep(400); }
  while (q.length && n < 30) {
    const m = q.shift(); if (done.has(m)) continue; done.add(m); n++;
    const r = await get(m); const L = locs(r.text);
    const subs = L.filter((u) => /\.xml(\.gz)?(\?|$)/i.test(u)); if (S.sub) for (const u of subs) if (S.sub.test(u) && !done.has(u)) q.push(u);
    const R = L.filter((u) => S.re.test(u) && !ROBOT.test(u)); all.push(...R); say(`plan ${key} ${r.status} ${m} → ${R.length}`);
    if (DRY && !R.length && L.length) say("   ex. " + L.filter((u) => !/\.xml/i.test(u)).slice(0, 4).join(" | ")); await sleep(400);
  }
  return { pri: [...new Set(pri)], all: [...new Set(all)] };
}
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const per = {};
for (const key of Object.keys(SRC).filter((k) => !ONLY.length || ONLY.includes(k))) {
  const U = await urlsOf(key); const P = new Set(shuffle(U.pri.filter((u) => !st.seen[idOf(u)])));
  const L = [...P, ...shuffle(U.all.filter((u) => !st.seen[idOf(u)] && !P.has(u)))];
  const aim = (A) => { const pri = A.filter((u) => P.has(u)), B = A.filter((u) => !P.has(u)); const hit = B.filter((u) => PROT_SLUG.test(nrm(u))), rest = B.filter((u) => !PROT_SLUG.test(nrm(u))); const out = [...pri]; while (hit.length || rest.length) { for (let i = 0; i < 3 && hit.length; i++) out.push(hit.shift()); if (rest.length) out.push(rest.shift()); } return out; };
  per[key] = { snack: aim(L.filter((u) => SNACK_SLUG.test(nrm(u)))), main: aim(L.filter((u) => !SNACK_SLUG.test(nrm(u)))) };
}
// tirage pondéré entre les sources ; la moitié des fiches sont des pistes d'encas, et si une source ou un type manque, les autres complètent
function take(kind, n) { const out = []; let more = true;
  while (out.length < n && more) { more = false; for (const k of Object.keys(per)) for (let i = 0; i < SRC[k].w && out.length < n; i++) { const u = per[k][kind].shift(); if (u) { out.push([k, u]); more = true; } } }
  return out; }
const snacks = take("snack", process.env.SNACK_ONLY === "1" ? MAX : Math.round(MAX * 0.5));
const queue = shuffle([...snacks, ...(process.env.SNACK_ONLY === "1" ? [] : take("main", MAX - snacks.length))]);
say(`à lire : ${queue.length} fiches (${snacks.length} pistes d'encas)`);
const why = {}; let ok = 0; const bySrc = {};
for (const [key, url] of queue) {
  const r = await get(url); st.seen[idOf(url)] = 1;
  if (r.status !== 200) { why["http " + r.status] = (why["http " + r.status] || 0) + 1; await sleep(500); continue; }
  const R = ld(r.text); if (!R) { why["pas de fiche"] = (why["pas de fiche"] || 0) + 1; await sleep(300); continue; }
  const x = toRecipe(key, url, R, SNACK_SLUG.test(nrm(url)));
  const B = bySrc[key] || (bySrc[key] = { lu: 0, plats: 0, encas: 0, why: {} }); B.lu++;
  if (x.r) { const tk = nrm(x.r.t).replace(/[^a-z0-9]+/g, " ").trim(); if (st.titles[tk]) { why["doublon"] = (why["doublon"] || 0) + 1; } else { st.titles[tk] = 1; st.pending.push(x.r); ok++; B[x.r.k === "encas" ? "encas" : "plats"]++; if (DRY) say("OK " + JSON.stringify(x.r).slice(0, 600)); } }
  else { const w = x.why.replace(/\d+(\.\d+)?/g, "#"); why[w] = (why[w] || 0) + 1; B.why[w] = (B.why[w] || 0) + 1; }
  await sleep(350);
}
say(`gardées : ${ok} · écartées : ${JSON.stringify(why)}`);
say(`par source : ${JSON.stringify(bySrc)}`);
if (DRY) process.exit(0);

// les catégories des pages déjà publiées suivent les règles actuelles
for (const f of fs.readdirSync(path.join(DIR, "p"))) { const fp = path.join(DIR, "p", f); try { const L = JSON.parse(fs.readFileSync(fp, "utf8")); let ch = false;
  for (const e of L) { if (e.k === "encas") continue; const pt = ptOf(e.t, e.ing); if (pt !== e.pt) { e.pt = pt; ch = true; } } if (ch) fs.writeFileSync(fp, JSON.stringify(L)); } catch { /* page illisible */ } }
for (const e of st.pending) if (e.k !== "encas") e.pt = ptOf(e.t, e.ing);
let pruned = 0;
for (const f of fs.readdirSync(path.join(DIR, "p"))) { const fp = path.join(DIR, "p", f); try { const L = JSON.parse(fs.readFileSync(fp, "utf8")); const K = L.filter(protOk); if (K.length !== L.length) { pruned += L.length - K.length; fs.writeFileSync(fp, JSON.stringify(K)); } } catch { /* page illisible */ } }
{ const n0 = st.pending.length; st.pending = st.pending.filter(protOk); pruned += n0 - st.pending.length; }
if (pruned) say(`retirées (sous les seuils de protéines) : ${pruned}`);
// --- pages de 10 : 5 plats (une catégorie à tour de rôle) et 5 encas, en alternance
function takePage(force) {
  const P = st.pending; const sn = P.filter((r) => r.k === "encas"), mains = P.filter((r) => r.k !== "encas");
  if (!force && (mains.length < 5 || P.length < 10)) return null;
  const G = {}; for (const r of mains) (G[r.pt] = G[r.pt] || []).push(r);
  const cats = shuffle(Object.keys(G)); const out = []; const nM = Math.min(10 - Math.min(5, sn.length), mains.length);
  for (let i = 0; out.length < nM; i++) { let any = false; for (const c of cats) { if (G[c][i] && out.length < nM) { out.push(G[c][i]); any = true; } } if (!any) break; }
  sn.slice(0, 10 - out.length).forEach((r, k) => out.splice(Math.min(out.length, 1 + k * 2), 0, r));
  const ids = new Set(out.map((r) => r.id)); st.pending = P.filter((r) => !ids.has(r.id)); return out;
}
let made = 0, pg;
while ((pg = takePage(false))) { st.pages++; st.total += pg.length; fs.writeFileSync(path.join(DIR, "p", `${st.pages}.json`), JSON.stringify(pg)); made++; }
st.runs++;
fs.writeFileSync(SP, JSON.stringify(st));
fs.writeFileSync(IX, JSON.stringify({ v: 1, gen: RULES, updated: new Date().toISOString(), pages: st.pages, total: st.total, sources: Object.values(SRC).map((s) => s.name) }));
say(`pages créées : ${made} · total ${st.pages} pages, ${st.total} recettes · en attente ${st.pending.length}`);
fs.writeFileSync(path.join(DIR, "log.txt"), log.join("\n") + "\n");
