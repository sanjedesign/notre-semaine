// Recettes à découvrir pour Sano — tourne trois fois par jour sur GitHub Actions.
// Lit les plans de site de HelloFresh, Jow, Marmiton, Betty Bossi, Fourchette & Bikini et de deux chefs (Julie Andrieu, Hervé Cuisine),
// plus des recherches Marmiton ciblées (plats à préparer à l'avance, poulet, poisson…), ouvre d'abord les fiches dont l'adresse
// annonce des protéines ou un plat qui se garde, ne garde que des plats complets (protéine, féculent, légumes, matière grasse),
// sans porc, et les range par pages de 10 plats variés dans la branche « data ».
// Les encas (salés comme les cookies au parmesan, ou protéinés) vont dans discover/encas.json, montrés dans l'onglet Encas.
// Les chefs ne publient pas de valeurs nutritionnelles : l'appli les calcule ingrédient par ingrédient (table Ciqual).
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
  .replace(/&quot;/g, '"').replace(/&(apos|#39);/g, "'").replace(/&[rl]squo;/g, "’").replace(/&[rl]dquo;/g, '"').replace(/&eacute;/g, "é").replace(/&egrave;/g, "è").replace(/&agrave;/g, "à").replace(/&ccedil;/g, "ç").replace(/&ecirc;/g, "ê").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
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
const MQ = ["batch cooking", "meal prep", "plat à préparer à l'avance", "plat complet", "mijoté de poulet", "curry de poulet", "chili con carne", "bolognaise",
  "dahl de lentilles", "tajine de poulet", "blanquette de dinde", "boulettes de boeuf", "hachis parmentier", "lasagnes légères", "gratin de pâtes au poulet",
  "poulet riz légumes", "bowl poulet quinoa", "salade de lentilles", "couscous poulet", "colombo de poulet", "riz sauté au poulet", "poêlée de dinde",
  "blanc de poulet", "escalope de dinde", "cabillaud", "saumon", "thon", "crevettes", "colin", "steak haché", "boeuf", "veau", "lentilles", "pois chiches", "tofu", "riche en protéines"];
const MQ_S = ["cookies au parmesan", "cookies salés", "sablés au parmesan", "crackers au parmesan", "tuiles de parmesan", "biscuits apéritifs au fromage", "gougères",
  "muffins salés", "cake salé léger", "chips de parmesan", "pois chiches grillés", "crackers aux graines", "roulés de jambon de dinde", "bouchées au thon", "oeufs mimosa",
  "rillettes de thon", "houmous", "energy balls protéinées", "muffins protéinés", "pancakes protéinés", "mug cake protéiné", "galettes salées flocons d'avoine", "verrines au thon", "edamame"];
const mqsUrls = (n) => shuffle([...MQ_S]).slice(0, n).map((q) => `https://www.marmiton.org/recettes/recherche.aspx?aqt=${encodeURIComponent(q)}`);
const mqUrls = (n) => shuffle([...MQ]).slice(0, n).map((q) => { const pg = 1 + Math.floor(Math.random() * 4); return `https://www.marmiton.org/recettes/recherche.aspx?aqt=${encodeURIComponent(q)}${pg > 1 ? "&page=" + pg : ""}`; });

// --- sources
// w : part des fiches lues ; sub : sous-plans à suivre dans un plan d'index
const SRC = {
  hellofresh: { name: "HelloFresh", maps: ["https://www.hellofresh.fr/sitemap_recipe_pages.xml"], re: /\/recipes\/[a-z0-9-]+-[0-9a-f]{24}$/, w: 3 },
  jow: { name: "Jow", maps: ["https://jow.fr/sitemap.xml"], re: /jow\.fr\/recipes\/[a-z0-9-]+$/, w: 2 },
  marmiton: { name: "Marmiton", maps: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `https://www.marmiton.org/wsitemap_recipes_${i}.xml`), lists: () => [...mqUrls(10), ...mqsUrls(8)], re: /\/recettes\/recette_[a-z0-9-]+_\d+\.aspx$/, w: 3 },
  bettybossi: { name: "Betty Bossi", maps: ["https://www.bettybossi.ch/sitemap.xml"], sub: /fr/i, re: /bettybossi\.ch\/fr\/recettes\/recette\/[a-z0-9-]+-\d+\/?$/, w: 3 },
  fourchette: { name: "Fourchette & Bikini", maps: ["https://www.fourchette-et-bikini.fr/xml/sitemap.xml"], sub: /recette/i, re: /fourchette-et-bikini\.fr\/recettes\/[a-z0-9-]+-(?:[2-9]\d{4}|\d{6,})\.html$/, w: 3 },
  // chefs : pas de valeurs nutritionnelles publiées (chef: true)
  julieandrieu: { name: "Julie Andrieu", maps: ["https://www.julieandrieu.com/recipe-sitemap.xml"], re: /julieandrieu\.com\/recettes\/[a-z0-9-]+\/?$/, w: 3, chef: true },
  hervecuisine: { name: "Hervé Cuisine", maps: ["https://www.hervecuisine.com/herve_recipe-sitemap.xml"], re: /hervecuisine\.com\/recette\/[a-z0-9-]+\/?$/, w: 2, chef: true },
};
// seuils protéines (les mêmes dans l'appli) : plat ≥ 28 g par portion et ≥ 24 % des calories ; encas ≥ 10 g et ≥ 25 %
const PRULE = { plat: { p: 28, r: 0.24 }, encas: { p: 10, r: 0.25 } };
// sources fiables : cuisines qui testent leurs recettes ; Marmiton seulement si la recette est notée ≥ 4,5 avec au moins 20 avis
const srcOk = (e) => e.src !== "Ptitchef" && (e.src !== "Marmiton" || (Array.isArray(e.r) && e.r[0] >= 4.5 && e.r[1] >= 20));
const protOk = (e) => { if (!e.n) return true; const R = e.k === "encas" && e.sv ? { p: 4, r: 0.14 } : PRULE[e.k === "encas" ? "encas" : "plat"]; const n = e.n; return n.k > 0 && n.p >= R.p && (n.p * 4) / n.k >= R.r; };
// pas de porc (« jambon de dinde », « lardons de volaille »… restent permis)
const PORK = /\b(porc|porcelet|cochon|jambonneau|jambons?|lardons?|lard|bacon|pancetta|guanciale|prosciutto|speck|coppa|lonzo|chorizo|saucissons?|saucisses?|chipolatas?|knacks?|cervelas|mortadelle|salami|pepperoni|rosette|andouillettes?|andouilles?|boudins?|rillettes?|chair a saucisse|filets? mignons?|echine|travers|poitrine (fumee|de porc|salee)|serrano|bayonne|parme|pata negra|jamon|nduja|morteau|montbeliard|toulouse)\b/;
const PORK_ALT = /\b(dinde|poulet|volaille|canard|boeuf|veau|vegetale?s?|vegan|veggie|soja|tofu|thon|saumon|sardines?|maquereaux?|truite)\b/;
const PORK_SURE = /\b(porc|porcelet|cochon|serrano|bayonne|parme|pata negra|jamon|nduja|morteau|montbeliard|toulouse|echine|travers|guanciale|pancetta|prosciutto|speck|coppa|lonzo|mortadelle|boudins?|andouilles?|andouillettes?)\b/;
const porkTxt = (t) => { const n = nrm(t).replace(/['’]/g, " "); return PORK.test(n) && (PORK_SURE.test(n) || !PORK_ALT.test(n)); };
const porkOf = (e) => porkTxt(e.t) || (e.ing || []).some(porkTxt);
// plat complet : une protéine, un féculent, des légumes et une matière grasse
const C_PROT = /\b(poulet|dinde|volaille|pintade|canard|caille|lapin|boeuf|veau|agneau|steak|bavette|hache|kefta|viande|saumon|cabillaud|colin|merlu|lieu|thon|truite|sardines?|maquereaux?|dorade|daurade|bar|poissons?|haddock|eglefin|merlan|sole|lotte|crevettes?|gambas|moules?|calamars?|encornets?|saint jacques|surimi|crabe|oeufs?|tofu|tempeh|seitan|lentilles?|pois chiches?|haricots? (rouges?|blancs?|noirs?|azuki|coco)|feves|edamame|skyr|fromage blanc|cottage|ricotta|halloumi|feta|paneer|quark)\b/;
const C_STARCH = /\b(riz|pates?|spaghettis?|tagliatelles?|linguines?|penne|fusilli|rigatoni|farfalle|macaroni|coquillettes|orzo|langues? d oiseau|nouilles|udon|soba|ramen|vermicelles?|lasagnes?|cannelloni|raviolis?|gnocchis?|semoule|couscous|boulgour|bulgur|quinoa|ble|epeautre|sarrasin|orge|polenta|pommes? de terre|grenailles|patates?( douces?)?|pain|baguette|tortillas?|wraps?|pitas?|naans?|galettes?|bagels?|muffins? anglais|lentilles?|pois chiches?|haricots? (rouges?|blancs?|noirs?|coco)|flageolets?|mais|chataignes?|panais|topinambours?|puree)\b/;
const C_VEG = /\b(courgettes?|poivrons?|brocolis?|broccolini|carottes?|epinards?|tomates?|champignons?|haricots? verts|choux?|kale|salades?|laitue|roquette|mache|mesclun|pousses|poireaux?|aubergines?|petits? pois|pois gourmands|asperges?|fenouils?|courges?|butternut|potimarron|potiron|concombres?|celeris?|betteraves?|avocats?|artichauts?|radis|navets?|endives?|cresson|blettes?|pak choi|bok choy|germes|legumes?|ratatouille|piperade|crudites|cebettes?|oignons? nouveaux)\b/;
const C_FAT = /\b(huiles?|beurre|cremes?|fromages?|parmesan|emmental|gruyere|comte|mozzarella|feta|chevre|ricotta|mascarpone|cheddar|avocats?|noix|amandes?|noisettes?|cajou|cacahuetes?|arachides?|pignons?|graines?|sesame|tahini|lait de coco|pesto|mayonnaise|olives?|saumon|maquereaux?|sardines?|oeufs?)\b/;
const completeOf = (e) => { const t = nrm(e.t + " | " + (e.ing || []).join(" | ")).replace(/['’]/g, " "); const n = e.n || {};
  return (C_PROT.test(t) || n.p >= 25) && (C_STARCH.test(t) || n.c >= 35) && (C_VEG.test(t) || n.fi >= 6) && (C_FAT.test(t) || n.f >= 8) && !(n.c < 20) && !(n.f < 5); };
const DESSERT = /(gateau|cake|tarte|flan|creme (brulee|anglaise|dessert|caramel)|mousse au|cookie|biscuit|crumble|clafoutis|brioche|compote|confiture|glace|sorbet|macaron|madeleine|financier|chocolat|caramel|pancake|crepe|gaufre|tiramisu|panna cotta|fondant|moelleux|entremets|buche|galette des rois|eclair|meringue|pavlova|muffin|sable|cheesecake|smoothie|cocktail|sirop|praline|nougat|truffe|bonbon|beignet|churros|donut|riz au lait|semoule au lait|yaourt|granola|porridge)/;
// plats qui se gardent (batch cooking) : lus en priorité
const BATCH_SLUG = /(mijot|curry|chili|bolognaise|ragout|tajine|blanquette|daube|bourguignon|goulash|dhal|dahl|gratin|lasagne|hachis|parmentier|boulette|kefta|one-pot|cocotte|colombo|massala|masala|tikka|korma|biryani|paella|couscous|farci|enchilada|moussaka|cannelloni|navarin|stroganoff|fricassee|basquaise|rougail|mafe|riz-saute|bowl|salade-de-(lentilles|quinoa|boulgour|pates|riz|pois-chiches)|taboule|meal-prep|batch)/;
// fiches visées en priorité : leur adresse annonce un aliment riche en protéines
const PROT_SLUG = /(proteine|protein|poulet|dinde|volaille|boeuf|steak|bavette|veau|escalope|agneau|canard|kefta|boulette|saumon|cabillaud|thon|merlu|colin|lieu|truite|sardine|maquereau|dorade|poisson|crevette|gambas|moule|calamar|encornet|saint-jacques|oeuf|omelette|frittata|tofu|tempeh|seitan|lentille|pois-chiche|haricot|edamame|skyr|fromage-blanc|cottage|ricotta|quark|halloumi)/;
// recettes écrites pour un robot de cuisine : étapes inutilisables sans l'appareil
const ROBOT = /thermomix|cookeo|monsieur[- ]cuisine|companion|i-cook|magimix|cook-?expert|multicuiseur/i;
const SNACK_SLUG = /(cookie|sable|biscuit|tuile|gougere|cake-sale|chips|grissini|gressin|crackers?-|galette-de-flocons|proteine|skyr|fromage-blanc|cottage|energy-?ball|bouchee|muffin|pancake|barre|houmous|hummus|tzatziki|tatziki|edamame|pois-chiches?-(grilles|rotis|croustillants)|oeufs?-(mimosa|durs?|cocotte|farcis)|roules?-de-(jambon|saumon|dinde)|collation|encas|snack|mug-?cake|cheesecake|porridge|overnight|yaourt|trempette|tartinade|verrine|smoothie|gaufre|crackers?|bol-|bowl-cake|oeufs?-brouilles|omelette-roulee|mini-|brochettes?-apero|tartare-de-saumon|rillettes-de-(thon|saumon|sardine|maquereau))/;
const BAD = /(frite|friture|beignet|burger|pizza|tartiflette|raclette|fondue|croque|nugget|cordon bleu|\bpanee?s?\b|chips|gratin dauphinois|aligot|confit|lardon|camembert|\bbrie\b|mont d.or|reblochon|tarte|quiche|feuillete|feuilletee|pate brisee|terrine|navets? sales|choucroute|cassoulet|carbonara|kebab|tacos? (frite|frites)|hot ?dog|grilled cheese|pepperoni|gateau|anniversaire)/;
const SNACK_T = /(sable|biscuit|tuile|gougere|cake sale|chips|grissini|gressin|muffin|pancake|energy|bouchee|barre|cookie|mug ?cake|cheesecake|porridge|overnight|mimosa|roule|verrine|mousse|bowl ?cake|tartine|houmous|hummus|tzatziki|trempette|\bdip\b|crackers?|smoothie|yaourt|skyr|fromage blanc|cottage|oeufs? (durs?|a la coque|coque|cocotte|mimosa|farcis?)|oeuf (dur|a la coque|cocotte|mimosa|farci)|collation|encas|snack|gaufre|madeleine|edamame|pois chiches? (grilles|rotis|croustillants))/;
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
  const chef = !!SRC[key].chef, hasN = !!(k && p != null && f != null && c != null);
  if (!hasN && !chef) return { why: "nutrition absente" };
  const t = clean(R.name).replace(/\s*:\s*la meilleure recette\s*$/i, "").replace(/\s*-\s*que du bon\b.*$/i, "").replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/^(la |ma |notre )?recettes? (facile |rapide )?(du |de la |des |de l['’]|d['’]|de )?/i, "").replace(/\s*:\s*recette (et )?vid[ée]o\s*$/i, "").replace(/\s{2,}/g, " ").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 110);
  if (ROBOT.test(t)) return { why: "robot de cuisine" };
  const ingSrc = Array.isArray(R.recipeIngredient) && R.recipeIngredient.length ? R.recipeIngredient : Array.isArray(R.ingredients) ? R.ingredients : [];
  const ing = ingSrc.map((s) => normIng(key, s)).filter(Boolean).slice(0, 30);
  if (!t || ing.length < 2) { if (DRY) say("   incomplète " + url + " clés=" + Object.keys(R).join(",")); return { why: "fiche incomplète" }; }
  const yTxt = Array.isArray(R.recipeYield) ? R.recipeYield.join(" ") : String(R.recipeYield ?? "");
  const y = Math.max(1, Math.min(24, Math.round(num(yTxt) || (key === "jow" ? 1 : 2))));
  const cat = nrm(Array.isArray(R.recipeCategory) ? R.recipeCategory.join(" ") : R.recipeCategory || "");
  const pr = hasN ? (p * 4) / k : 0;
  const o = { id: idOf(url), t, src: SRC[key].name, u: url, img: imgOf(R.image), min: iso(R.totalTime) || iso(R.prepTime) + iso(R.cookTime) || 0, y, ing };
  if (hasN) { o.n = { k: Math.round(k), p: +p.toFixed(1), f: +f.toFixed(1), c: +c.toFixed(1) }; if (fi != null) o.n.fi = +fi.toFixed(1); }
  const a = R.author && (Array.isArray(R.author) ? R.author[0] : R.author); const an = clean(a && (a.name || a));
  if (an && !/^(anonyme|jow|hellofresh|betty bossi|fourchette (et|&) bikini|redaction|rédaction)$/i.test(an)) o.a = an.slice(0, 50); else if (key === "marmiton") o.a = "Membre Marmiton";
  if (porkOf(o)) return { why: "porc" };
  if (DESSERT.test(nrm(t)) && !/(poulet|dinde|boeuf|saumon|thon|crevette|lentille|pois chiche|parmesan|fromage|comte|emmental|gruyere|chevre|feta|olive|tomate|herbes|pesto|graines|\bsale|\bsalee|apero)/.test(nrm(t))) return { why: "dessert" };
  const ar = R.aggregateRating; if (ar && num(ar.ratingValue) && num(ar.ratingCount || ar.reviewCount)) o.r = [Math.round(num(ar.ratingValue) * 10) / 10, Math.round(num(ar.ratingCount || ar.reviewCount))];
  const vid = R.video && (Array.isArray(R.video) ? R.video[0] : R.video); const yv = ytId(vid && (vid.embedUrl || vid.contentUrl)); if (yv) o.v = yv;
  if (!srcOk(o)) return { why: "note Marmiton insuffisante" };
  if (BAD.test(nrm(t)) && !/chips de (parmesan|pois chiches?|kale|chou|legumes?)/.test(nrm(t))) return { why: "plat trop riche (nom)" };
  if (/\b(langues?|ris de veau|rognons?|foies?|tripes?|cervelle|boudin|andouillettes?|gesiers?|coeurs? de (boeuf|volaille|poulet))\b/.test(nrm(t))) return { why: "abats" };
  if (/dessert|boisson|cocktail|sauce|confiserie/.test(cat) && !SNACK_T.test(nrm(t))) return { why: "catégorie " + cat };
  // encas sain et protéiné
  const tt = nrm(t);
  // piste d'encas (adresse de la fiche) ou titre / catégorie d'encas
  const snackLike = !MEAL_T.test(tt) && (SNACK_T.test(tt) || (hint && k <= 350) || /(petit[- ]dejeuner|brunch|gouter|collation|encas|snack|aperitif|amuse|en-cas)/.test(cat + " " + nrm(R.keywords || "")));
  // encas salé (cookies au parmesan, crackers, muffins salés…) ou encas protéiné ; les gâteaux sucrés non protéinés sont écartés
  const savory = /(parmesan|fromage|comte|emmental|gruyere|chevre|feta|mozzarella|ricotta|olive|tomate|thon|saumon|sardine|maquereau|dinde|poulet|oeuf|herbes|pesto|graines|sesame|curry|paprika|cumin|pois chiche|houmous|hummus|lentille|edamame|cracker|sale|salee|apero)/.test(tt + " " + nrm(ing.slice(0, 4).join(" "))) && !/(chocolat|cacao|sucre|miel|banane|pomme|fruits rouges|myrtille|framboise|fraise|vanille|caramel|confiture|datte|cannelle)/.test(tt);
  const sweetBake = !savory && /(cake|brownie|cookie|crepe|gaufre|madeleine|sable|biscuit)/.test(tt) && !/prot[eé]in/.test(tt);
  if (snackLike && !sweetBake && (!hasN || k <= 320)) {
    if (hasN && (savory ? (k < 30 || p < 4 || pr < 0.14 || f > 16) : (k < 50 || p < PRULE.encas.p || pr < PRULE.encas.r || f > 16 || (sug != null && sug > 18)))) return { why: "encas pas assez protéiné" };
    if (!hasN && !savory) return { why: "encas sucré sans valeurs" };
    if (savory) o.sv = 1;
    if (/(bacon|chorizo|saucisson|rillette|lardon|salami)/.test(tt)) return { why: "encas trop gras" };
    o.k = "encas"; const su = SNACK_UNIT.find(([re]) => re.test(nrm(t))); o.yU = su ? su[1] : y > 1 ? "portions" : "portion"; o.uS = su ? su[2] : "portion";
    o.emo = (SNACK_EMO.find(([re]) => re.test(nrm(t))) || [0, "🥚"])[1]; o.pt = "encas"; return { r: o };
  }
  if (snackLike && !hasN) return { why: "encas" };
  // plat complet, léger et riche en protéines (les valeurs des chefs sont vérifiées par l'appli)
  if (!completeOf(o)) return { why: "plat incomplet" };
  if (hasN) {
    if (k < 280 || k > 680) return { why: `kcal ${Math.round(k)}` };
    if (p < PRULE.plat.p || pr < PRULE.plat.r) return { why: `protéines ${p} g` };
    if (f > 30 || (f * 9) / k > 0.45) return { why: `lipides ${f} g` };
  }
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
  const aim = (A) => { const pri = A.filter((u) => P.has(u)), B = A.filter((u) => !P.has(u)); const good = (u) => BATCH_SLUG.test(nrm(u)) || PROT_SLUG.test(nrm(u)); const hit = B.filter(good), rest = B.filter((u) => !good(u)); const out = [...pri]; while (hit.length || rest.length) { for (let i = 0; i < 3 && hit.length; i++) out.push(hit.shift()); if (rest.length) out.push(rest.shift()); } return out; };
  per[key] = { snack: aim(L.filter((u) => SNACK_SLUG.test(nrm(u)))), main: aim(L.filter((u) => !SNACK_SLUG.test(nrm(u)))) };
}
// tirage pondéré entre les sources ; la moitié des fiches sont des pistes d'encas, et si une source ou un type manque, les autres complètent
function take(kind, n) { const out = []; let more = true;
  while (out.length < n && more) { more = false; for (const k of Object.keys(per)) for (let i = 0; i < SRC[k].w && out.length < n; i++) { const u = per[k][kind].shift(); if (u) { out.push([k, u]); more = true; } } }
  return out; }
const snacks = take("snack", process.env.SNACK_ONLY === "1" ? MAX : Math.round(MAX * 0.3));
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
for (const f of fs.readdirSync(path.join(DIR, "p"))) { const fp = path.join(DIR, "p", f); try { const L = JSON.parse(fs.readFileSync(fp, "utf8")); const K = L.filter((e) => protOk(e) && srcOk(e) && !porkOf(e)); if (K.length !== L.length) { pruned += L.length - K.length; fs.writeFileSync(fp, JSON.stringify(K)); } } catch { /* page illisible */ } }
{ const n0 = st.pending.length; st.pending = st.pending.filter((e) => protOk(e) && srcOk(e) && !porkOf(e)); pruned += n0 - st.pending.length; }
if (pruned) say(`retirées (sous les seuils de protéines, source non fiable ou porc) : ${pruned}`);
// --- encas : liste à part (discover/encas.json), les 400 plus récents ; au premier passage, on reprend ceux des pages déjà publiées
st.snacks = st.snacks || [];
if (!st.snkSeeded) { for (const f of fs.readdirSync(path.join(DIR, "p"))) { try { for (const e of JSON.parse(fs.readFileSync(path.join(DIR, "p", f), "utf8"))) if (e.k === "encas") st.snacks.push(e); } catch { /* page illisible */ } } st.snkSeeded = 1; }
st.snacks.push(...st.pending.filter((e) => e.k === "encas")); st.pending = st.pending.filter((e) => e.k !== "encas");
{ const seen = new Set(); st.snacks = st.snacks.reverse().filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return protOk(e) && srcOk(e) && !porkOf(e); }).slice(0, 400).reverse(); }
fs.writeFileSync(path.join(DIR, "encas.json"), JSON.stringify({ updated: new Date().toISOString(), items: st.snacks.slice().reverse() }));
say(`encas : ${st.snacks.length} (dont salés ${st.snacks.filter((e) => e.sv).length})`);
// --- pages de 10 plats (une catégorie à tour de rôle)
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
fs.writeFileSync(IX, JSON.stringify({ v: 1, gen: RULES, updated: new Date().toISOString(), pages: st.pages, total: st.total, snacks: st.snacks.length, sources: Object.values(SRC).map((s) => s.name) }));
say(`pages créées : ${made} · total ${st.pages} pages, ${st.total} recettes · en attente ${st.pending.length}`);
fs.writeFileSync(path.join(DIR, "log.txt"), log.join("\n") + "\n");
