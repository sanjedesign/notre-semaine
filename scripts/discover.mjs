// Recettes à découvrir pour Sano — tourne trois fois par jour sur GitHub Actions.
// Lit les plans de site de HelloFresh, Jow, Marmiton, Betty Bossi, Fourchette & Bikini, du Journal des Femmes (recettes en vidéo),
// de sites anglais traduits en français (BBC Good Food, Pinch of Nom, Jamie Oliver, Skinnytaste, RecipeTin Eats, Olive),
// de CuisineAZ (encas seulement) et de deux chefs (Julie Andrieu, Hervé Cuisine),
// plus des recherches Marmiton ciblées (plats à préparer à l'avance, poulet, poisson…), ouvre d'abord les fiches dont l'adresse
// annonce des protéines ou un plat qui se garde, ne garde que des plats complets (protéine, féculent, légumes, matière grasse),
// sans porc, et les range par pages de 10 plats variés dans la branche « data ».
// Les encas (salés comme les cookies au parmesan, ou protéinés) vont dans discover/encas.json, montrés dans l'onglet Encas :
// mis en réserve puis publiés au fil des jours (12 par jour), pour qu'il y ait de nouvelles idées chaque jour.
// Les plats avec une vidéo (YouTube d'Hervé Cuisine, vidéos de Jow sur leur site) vont aussi dans discover/videos.json, montrés en priorité dans le swipe.
// Les chefs ne publient pas de valeurs nutritionnelles : l'appli les calcule ingrédient par ingrédient (table Ciqual).
// DRY_RUN=1 : lit quelques fiches et affiche le résultat sans rien écrire (SOURCES=bettybossi,fourchette pour en choisir).
// L'appli lit ces pages une par une avec le bouton « Actualiser ».
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = process.env.DATA_DIR || "data/discover";
// budget de temps : la lecture s'arrête avant la limite de l'action (55 min) pour toujours publier ce qui a été trouvé
const T0 = Date.now(), LEFT = () => (+(process.env.TIME_BUDGET_MIN || 40)) * 60e3 - (Date.now() - T0);
let TR_UNTIL = 0; // fin du budget de traduction de ce passage
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
const ytId = (u) => { const m = String(u || "").match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ""; };
// vidéo de la recette : identifiant YouTube (lue dans l'appli), ou « page » quand la vidéo se regarde sur le site d'origine (Jow)
// (pas de lien direct vers les fichiers vidéo des sites : on renvoie vers leur page)
function videoOf(R, html, key) {
  const vo = R && R.video && (Array.isArray(R.video) ? R.video[0] : R.video);
  const vu = vo && (vo.embedUrl || vo.contentUrl || vo.url); const y = ytId(vu); if (y) return y;
  if (vu && /^https?:\/\//.test(String(vu))) return "page";
  const h = String(html || "");
  const m = h.match(/youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/) || (key === "hervecuisine" && (h.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) || h.match(/youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/)));
  if (m) return m[1];
  if (key === "jow" && /static\.jow\.fr\/recipes\/[^"'\s]+\.mp4/.test(h)) return "page";
  return "";
}

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
  jow: { name: "Jow", maps: ["https://jow.fr/sitemap.xml"], re: /jow\.fr\/recipes\/[a-z0-9-]+$/, w: 4 },
  marmiton: { name: "Marmiton", maps: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `https://www.marmiton.org/wsitemap_recipes_${i}.xml`), lists: () => [...mqUrls(10), ...mqsUrls(8)], re: /\/recettes\/recette_[a-z0-9-]+_\d+\.aspx$/, w: 3 },
  bettybossi: { name: "Betty Bossi", maps: ["https://www.bettybossi.ch/sitemap.xml"], sub: /fr/i, re: /bettybossi\.ch\/fr\/recettes\/recette\/[a-z0-9-]+-\d+\/?$/, w: 3 },
  fourchette: { name: "Fourchette & Bikini", maps: ["https://www.fourchette-et-bikini.fr/xml/sitemap.xml"], sub: /recette/i, re: /fourchette-et-bikini\.fr\/recettes\/[a-z0-9-]+-(?:[2-9]\d{4}|\d{6,})\.html$/, w: 3 },
  // chefs : pas de valeurs nutritionnelles publiées (chef: true)
  julieandrieu: { name: "Julie Andrieu", maps: ["https://www.julieandrieu.com/recipe-sitemap.xml"], re: /julieandrieu\.com\/recettes\/[a-z0-9-]+\/?$/, w: 3, chef: true },
  hervecuisine: { name: "Hervé Cuisine", maps: ["https://www.hervecuisine.com/herve_recipe-sitemap.xml"], re: /hervecuisine\.com\/recette\/[a-z0-9-]+\/?$/, w: 4, chef: true },
  // encas uniquement, recettes bien notées ; pas de valeurs publiées : l'appli les calcule ingrédient par ingrédient (calc: true)
  // (robots.txt de CuisineAZ : pas d'adresses avec « -- », « ' » ou commençant par « recette-chiffre »)
  cuisineaz: { name: "CuisineAZ", maps: ["https://www.cuisineaz.com/xml/sitemap.xml"], sub: /recette/i, re: /cuisineaz\.com\/recettes\/(?!recette-\d)[a-z0-9]+(?:-[a-z0-9]+)*-\d+\.aspx$/, w: 3, calc: true, snackOnly: true, minR: [4.5, 5] },
  // recettes en vidéo du Journal des Femmes (calories seules publiées : le reste est calculé par l'appli)
  // recettes en anglais (valeurs nutritionnelles publiées), traduites en français par scripts/translate_en.py
  bbc: { name: "BBC Good Food", lang: "en", maps: ["https://www.bbcgoodfood.com/sitemap.xml"], sub: /recipe/i, re: /bbcgoodfood\.com\/recipes\/(?!collection|category)[a-z0-9-]+$/, w: 4 },
  pinchofnom: { name: "Pinch of Nom", lang: "en", maps: ["https://pinchofnom.com/sitemap.xml", "https://pinchofnom.com/sitemap_index.xml"], sub: /./, re: /pinchofnom\.com\/recipes\/[a-z0-9-]+\/?$/, w: 4 },
  jamieoliver: { name: "Jamie Oliver", lang: "en", maps: ["https://www.jamieoliver.com/sitemap.xml"], sub: /recipe/i, re: /jamieoliver\.com\/recipes\/(?!books|category|collections?)[a-z0-9-]+\/[a-z0-9-]+\/?$/, w: 3 },
  skinnytaste: { name: "Skinnytaste", lang: "en", maps: ["https://www.skinnytaste.com/sitemap_index.xml"], sub: /post-sitemap/i, re: /skinnytaste\.com\/(?!category|tag|page|about|contact|privacy)[a-z0-9-]{6,}\/?$/, w: 2 },
  recipetineats: { name: "RecipeTin Eats", lang: "en", maps: ["https://www.recipetineats.com/sitemap_index.xml"], sub: /post-sitemap/i, re: /recipetineats\.com\/(?!category|tag|page|about|contact|privacy)[a-z0-9-]{6,}\/?$/, w: 2 },
  olive: { name: "Olive", lang: "en", maps: ["https://www.olivemagazine.com/sitemap.xml"], sub: /recipe/i, re: /olivemagazine\.com\/recipes\/(?!collection)[a-z0-9-]+\/[a-z0-9-]+\/?$/, w: 2 },
  jdf: { name: "Journal des Femmes", maps: ["https://cuisine.journaldesfemmes.fr/sitemap/video-recipe/"], re: /cuisine\.journaldesfemmes\.fr\/recette\/\d+-[a-z0-9-]+$/, w: 2, calc: true, minR: [4.4, 10] },
};
// seuils protéines (les mêmes dans l'appli) : plat ≥ 28 g par portion et ≥ 24 % des calories ; encas ≥ 10 g et ≥ 25 %
const PRULE = { plat: { p: 28, r: 0.24 }, encas: { p: 10, r: 0.25 } };
// sources fiables : cuisines qui testent leurs recettes ; Marmiton seulement si la recette est notée ≥ 4,5 avec au moins 20 avis
// sources sans valeurs publiées (CuisineAZ, Journal des Femmes) : seulement des recettes bien notées
const MIN_R = { "Marmiton": [4.5, 20], "CuisineAZ": [4.5, 5], "Journal des Femmes": [4.4, 10], "Pinch of Nom": [4.0, 3], "Skinnytaste": [4.5, 3], "RecipeTin Eats": [4.5, 5] };
const srcOk = (e) => e.src !== "Ptitchef" && (!MIN_R[e.src] || (Array.isArray(e.r) && e.r[0] >= MIN_R[e.src][0] && e.r[1] >= MIN_R[e.src][1]));
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
// ingrédients riches en protéines (encas sans valeurs publiées)
const PROT_ING = /\b(parmesan|parmigiano|grana|comte|emmental|gruyere|feta|chevre|mozzarella|ricotta|cottage|fromage blanc|faisselle|skyr|yaourt grec|yaourt a la grecque|quark|oeufs?|thon|saumon|sardines?|maquereaux?|crevettes?|surimi|jambon de (dinde|poulet|volaille)|blancs? de (poulet|dinde)|poulet|dinde|pois chiches?|lentilles?|edamame|tofu|haricots? (rouges?|blancs?)|whey|proteines?|houmous|hummus)\b/;
// recettes écrites pour un robot de cuisine : étapes inutilisables sans l'appareil
const ROBOT = /thermomix|cookeo|monsieur[- ]cuisine|companion|i-cook|magimix|cook-?expert|multicuiseur/i;
const SNACK_SLUG = /(cookie|sable|biscuit|tuile|gougere|cake-sale|chips|grissini|gressin|crackers?-|galette-de-flocons|proteine|skyr|fromage-blanc|cottage|energy-?ball|bouchee|muffin|pancake|barre|houmous|hummus|tzatziki|tatziki|edamame|pois-chiches?-(grilles|rotis|croustillants)|oeufs?-(mimosa|durs?|cocotte|farcis)|roules?-de-(jambon|saumon|dinde)|collation|encas|snack|mug-?cake|cheesecake|porridge|overnight|yaourt|trempette|tartinade|verrine|smoothie|gaufre|crackers?|bol-|bowl-cake|oeufs?-brouilles|omelette-roulee|mini-|brochettes?-apero|tartare-de-saumon|rillettes-de-(thon|saumon|sardine|maquereau))/;
const BAD = /(frite|friture|beignet|burger|pizza|tartiflette|raclette|fondue|croque|nugget|cordon bleu|\bpanee?s?\b|chips|gratin dauphinois|aligot|confit|lardon|camembert|\bbrie\b|mont d.or|reblochon|tarte|quiche|feuillete|feuilletee|pate brisee|terrine|navets? sales|choucroute|cassoulet|carbonara|kebab|tacos? (frite|frites)|hot ?dog|grilled cheese|pepperoni|gateau|anniversaire)/;
const SNACK_T = /(sable|biscuit|tuile|gougere|cake sale|chips|grissini|gressin|muffin|pancake|energy|bouchee|barre|cookie|mug ?cake|cheesecake|porridge|overnight|mimosa|roule|verrine|\bmousses?\b|bowl ?cake|tartine|houmous|hummus|tzatziki|trempette|\bdip\b|crackers?|smoothie|yaourt|skyr|fromage blanc|cottage|oeufs? (durs?|a la coque|coque|cocotte|mimosa|farcis?)|oeuf (dur|a la coque|cocotte|mimosa|farci)|collation|encas|snack|gaufre|madeleine|edamame|pois chiches? (grilles|rotis|croustillants))/;
const MEAL_T = /(puree|\briz\b|pates|spaghetti|semoule|quinoa|boulgour|nouilles|gratin|curry|mijote|roti|poelee|risotto|wok|bowl(?! ?cake)|tajine|blanquette|pot-au-feu|bourguignon|parmentier|saute|ragout|chili|lasagne|burger|sandwich|\bwrap|tacos|quiche|pizza|hachis|cocotte|steak|escalope|filets? de|paves? de|soupe|veloute|potage|couscous|omelette|frittata|shakshuka|chakchouka|galettes? de (sarrasin|ble noir)|plat |salade (composee|de pates|de riz|de quinoa|de lentilles|cesar)|brochettes de (poulet|boeuf|dinde))/;
// catégorie de protéine (pour varier chaque page)
const PT = [["crevettes", /crevette|gambas|fruits? de mer|\bmoules?\b|calamar|encornet|saint-jacques|noix de st|surimi|crabe/], ["poisson", /saumon|cabillaud|thon|merlu|\blieu\b|colin|truite|sardine|maquereau|dorade|\bbar\b|poisson|haddock|eglefin|merlan|sole|lotte/],
  ["dinde", /dinde/], ["poulet", /poulet|volaille|pintade|canard|caille/], ["boeuf", /boeuf|veau|steak|bavette|hache|kefta|bolognaise|viande|boulette|agneau|paleron|tagliata/], ["porc", /porc|jambon|filet mignon|echine|chorizo|saucisse/],
  ["oeufs", /\boeufs?\b|omelette|frittata|shakshuka|chakchouka/], ["vege", /tofu|tempeh|seitan|lentille|pois chiche|haricot|feve|quinoa|falafel/]];
// d'abord le titre (« Œufs cocotte aux asperges » = œufs), puis les premiers ingrédients
const VEG = /\bv[eé]g[eé]|vegetari|vegan|tofu|tempeh|seitan|falafel|halloumi|paneer/;
const ptOf = (title, ing) => { const t = nrm(title); if (VEG.test(t)) return "vege"; for (const [p, re] of PT) if (re.test(t)) return p;
  const i = nrm(ing.slice(0, 6).join(" | ")); for (const [p, re] of PT) if (re.test(i)) return p; return "vege"; };

const CNT = /^(oeufs?|œufs?|blancs?|jaunes?|echalotes?|échalotes?|echalottes?|oignons?|gousses?|tetes?|têtes?|citrons?|bananes?|pommes?|poires?|tranches?|feuilles?|branches?|brins?|pincees?|pincées?|filets?|escalopes?|paves?|pavés?|steaks?|tortillas?|wraps?|galettes?|avocats?|tomates?|carottes?|courgettes?|poivrons?|pains?|muffins?|cookies?|biscuits?|speculoos|spéculoos|dattes?|sachets?|boites?|boîtes?|pots?|cubes?|petits?|gros|grosses?|belles?|kiwis?|oranges?|mangues?|figues?|abricots?|peches?|pêches?|clementines?|clémentines?|concombres?|aubergines?|navets?|radis|endives?|crevettes?|gambas|noix|amandes?|noisettes?|olives?|cornichons?|champignons?|saint|fraises?|framboises?|myrtilles?|cerises?|cuill\w*|c\.|cs|cc|bou\.?|botte|bottes)$/i;
const fixUnitless = (line) => { const m = String(line || "").match(/^\s*(\d+(?:[.,]\d+)?)\s+([A-ZÀ-ÝŒ][^\s]*)(.*)$/); if (!m) return line; const q = parseFloat(m[1].replace(",", ".")); if (!(q >= 5)) return line;
  const w = m[2].replace(/[’']/g, " ").split(" ")[0]; return CNT.test(w) ? line : `${m[1]} g ${m[2]}${m[3]}`; };
function normIng(src, s) {
  let x = clean(s).replace(/\((?:s|x|es)\)/g, "").replace(/\s{2,}/g, " ").trim();
  if (src === "fourchette") x = fixUnitless(x);
  if (src === "cuisineaz") x = x.replace(/^(\d+(?:[.,]\d+)?)\s+grammes?\b/i, "$1 g").replace(/^(\d+(?:[.,]\d+)?)\s+(?:verres?)\s+/i, "$1 verre ");
  if (src === "jdf") x = x.replace(/\bc\.?\s?(?:à|a)\s?s\.?(?=\s)/gi, "cs").replace(/\bc\.?\s?(?:à|a)\s?c\.?(?=\s)/gi, "cc").replace(/^(\d+(?:[.,]\d+)?)\s+unit[ée]s?\s+/i, "$1 ");
  if (src === "jow") x = x.replace(/\btran\.?(?=\s)/i, "tranche").replace(/\bc[àa]s\b/gi, "cs").replace(/\bc[àa]c\b/gi, "cc").replace(/\bgr\b/gi, "g");
  return x.slice(0, 140);
}
const SNACK_UNIT = [[/muffin/, "muffins", "muffin"], [/pancake/, "pancakes", "pancake"], [/bouch[ée]e|ball|boule/, "bouchées", "bouchée"], [/barre/, "barres", "barre"], [/cookie|biscuit/, "cookies", "cookie"], [/verrine/, "verrines", "verrine"], [/(oeuf|œuf)s? (mimosa|farci)/, "demi-œufs", "demi-œuf"]];
const SNACK_EMO = [[/chocolat|cacao|brownie/, "🍫"], [/myrtille|fruits rouges|fraise|framboise/, "🍓"], [/banane/, "🍌"], [/pomme/, "🍎"], [/oeuf|œuf|omelette/, "🥚"], [/muffin|cake|pancake/, "🧁"], [/fromage|skyr|yaourt|cottage/, "🧀"], [/cacahu|amande|noisette|noix/, "🥜"], [/houmous|pois chiche|edamame/, "🥕"]];

function toRecipe(key, url, R, hint, html) {
  const n = R.nutrition || {};
  let k = num(n.calories); if (k != null && /kj/i.test(String(n.calories)) && !/kcal|calor/i.test(String(n.calories))) k = Math.round(k / 4.184);
  const p = num(n.proteinContent), f = num(n.fatContent), c = num(n.carbohydrateContent), fi = num(n.fiberContent), sug = num(n.sugarContent);
  const chef = !!(SRC[key].chef || SRC[key].calc), hasN = !!(k && p != null && f != null && c != null);
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
  const a = R.author && (Array.isArray(R.author) ? R.author[0] : R.author); const an = clean(typeof a === "string" ? a : a && typeof a.name === "string" ? a.name : "");
  if (an && !/^(anonyme|jow|hellofresh|betty bossi|fourchette (et|&) bikini|redaction|rédaction|cuisineaz|cuisine az|journal des femmes|la redaction.*|journal des femmes cuisine|pinch of nom|bbc good food|good food team|olive magazine|olive|recipetin eats|skinnytaste)$/i.test(an)) o.a = an.slice(0, 50); else if (key === "marmiton") o.a = "Membre Marmiton";
  if (porkOf(o)) return { why: "porc" };
  if (DESSERT.test(nrm(t)) && !/(poulet|dinde|boeuf|saumon|thon|crevette|lentille|pois chiche|parmesan|fromage|comte|emmental|gruyere|chevre|feta|olive|tomate|herbes|pesto|graines|\bsale|\bsalee|apero|protein|skyr)/.test(nrm(t))) return { why: "dessert" };
  const ar = R.aggregateRating; if (ar && num(ar.ratingValue) && num(ar.ratingCount || ar.reviewCount)) o.r = [Math.round(num(ar.ratingValue) * 10) / 10, Math.round(num(ar.ratingCount || ar.reviewCount))];
  const vv = videoOf(R, html, key); if (vv) o.v = vv;
  if (!srcOk(o)) return { why: "note insuffisante" };
  if (BAD.test(nrm(t)) && !/chips de (parmesan|pois chiches?|kale|chou|legumes?)/.test(nrm(t))) return { why: "plat trop riche (nom)" };
  if (/\b(langues?|ris de veau|rognons?|foies?|tripes?|cervelle|boudin|andouillettes?|gesiers?|coeurs? de (boeuf|volaille|poulet))\b/.test(nrm(t))) return { why: "abats" };
  if (/dessert|boisson|cocktail|sauce|confiserie/.test(cat) && !SNACK_T.test(nrm(t))) return { why: "catégorie " + cat };
  // encas sain et protéiné
  const tt = nrm(t);
  // piste d'encas (adresse de la fiche) ou titre / catégorie d'encas
  const snackLike = !MEAL_T.test(tt) && (SNACK_T.test(tt) || (hint && hasN && k <= 250 && !(p > 28)) || /(petit[- ]dejeuner|brunch|gouter|collation|encas|snack|aperitif|amuse|en-cas)/.test(cat + " " + nrm(R.keywords || "")));
  // encas salé (cookies au parmesan, crackers, muffins salés…) ou encas protéiné ; les gâteaux sucrés non protéinés sont écartés
  const savory = /(parmesan|fromage(?! blanc| frais sucre)|comte|emmental|gruyere|chevre|feta|mozzarella|ricotta|olive|tomate|thon|saumon|sardine|maquereau|dinde|poulet|oeuf|herbes|pesto|graines|sesame|curry|paprika|cumin|pois chiche|houmous|hummus|lentille|edamame|cracker|sale|salee|apero)/.test(tt + " " + nrm(ing.slice(0, 4).join(" "))) && !/(chocolat|cacao|sucre|miel|banane|pomme|poire|fruits rouges|myrtille|framboise|fraise|vanille|caramel|confiture|datte|cannelle|marron|speculoos|praline|nutella|sirop|erable|agave|compote|coco)/.test(tt + " " + nrm(ing.join(" ")));
  const sweetBake = !savory && /(cake|brownie|cookie|crepe|gaufre|madeleine|sable|biscuit)/.test(tt) && !/prot[eé]in/.test(tt);
  if (snackLike && !sweetBake && (!hasN || k <= 320)) {
    if (hasN && (savory ? (k < 30 || p < 4 || pr < 0.14 || f > 16) : (k < 50 || p < PRULE.encas.p || pr < PRULE.encas.r || f > 16 || (sug != null && sug > 18)))) return { why: "encas pas assez protéiné" };
    if (!hasN && !savory && !/prot[eé]in|skyr|fromage blanc|cottage|whey/.test(tt)) return { why: "encas sucré sans valeurs" };
    // sans valeurs publiées : il faut au moins un ingrédient riche en protéines (l'appli vérifie ensuite par le calcul)
    if (!hasN && !PROT_ING.test(nrm(ing.join(" | ")).replace(/['’]/g, " "))) return { why: "encas sans ingrédient protéiné" };
    if (savory) o.sv = 1;
    if (/(bacon|chorizo|saucisson|rillette|lardon|salami)/.test(tt)) return { why: "encas trop gras" };
    o.k = "encas"; const su = SNACK_UNIT.find(([re]) => re.test(nrm(t))); o.yU = su ? su[1] : y > 1 ? "portions" : "portion"; o.uS = su ? su[2] : "portion";
    o.emo = (SNACK_EMO.find(([re]) => re.test(nrm(t))) || [0, "🥚"])[1]; o.pt = "encas"; return { r: o };
  }
  if (snackLike && !hasN) return { why: "encas" };
  if (SRC[key].snackOnly) return { why: "plat (source d'encas)" };
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
  // recettes anglaises : des plats seulement (les mots-clés d'encas sont en français), lus au hasard
  per[key] = SRC[key].lang === "en" ? { snack: [], main: shuffle(L.slice()) } : { snack: aim(L.filter((u) => SNACK_SLUG.test(nrm(u)))), main: SRC[key].snackOnly ? [] : aim(L.filter((u) => !SNACK_SLUG.test(nrm(u)))) };
}
// tirage pondéré entre les sources ; la moitié des fiches sont des pistes d'encas, et si une source ou un type manque, les autres complètent
// recettes anglaises : EN_MAX fiches par passage au plus (la traduction prend du temps)
const EN_MAX = +(process.env.EN_MAX || 80); let enN = 0;
const TR_ON = !!process.env.GEMINI_API_KEY || process.env.TRANSLATE_FALLBACK === "argos";
const ENQ_MAX = 400; st.enq = st.enq || [];
function take(kind, n) { const out = []; let more = true;
  while (out.length < n && more) { more = false; for (const k of Object.keys(per)) for (let i = 0; i < SRC[k].w && out.length < n; i++) { if (SRC[k].lang === "en" && (enN >= EN_MAX || (!TR_ON && (st.enq || []).length >= ENQ_MAX))) break; const u = per[k][kind].shift(); if (u) { out.push([k, u]); more = true; if (SRC[k].lang === "en") enN++; } } }
  return out; }
// encas : tant que la réserve est petite, 30 % des fiches lues sont des pistes d'encas ; ensuite 40 par passage (les sites ne sont pas surchargés)
const RES_N = (st.snkRes || []).length;
const snacks = take("snack", process.env.SNACK_ONLY === "1" ? MAX : RES_N > 150 ? 40 : Math.round(MAX * 0.3));
const queue = shuffle([...snacks, ...(process.env.SNACK_ONLY === "1" ? [] : take("main", MAX - snacks.length))]);
say(`à lire : ${queue.length} fiches (${snacks.length} pistes d'encas)`);
// --- traduction des recettes anglaises : un seul processus Python pour tout le passage
const TR_PY = path.join(path.dirname(fileURLToPath(import.meta.url)), "translate_en.py");
let TRP = null; const trWait = new Map(); let trBuf = "", trN = 0, trFail = 0; const trEng = {};
function trStart() {
  if (TRP !== null) return TRP;
  try { const p = spawn(process.env.PYTHON || "python3", [TR_PY], { stdio: ["pipe", "pipe", "inherit"] });
    p.on("error", () => { TRP = false; for (const [, r] of trWait) r(null); trWait.clear(); });
    p.on("exit", () => { TRP = false; for (const [, r] of trWait) r(null); trWait.clear(); });
    p.stdout.on("data", (d) => { trBuf += d; let i; while ((i = trBuf.indexOf("\n")) >= 0) { const l = trBuf.slice(0, i); trBuf = trBuf.slice(i + 1); try { const j = JSON.parse(l); const r = trWait.get(j.id); if (r) { trWait.delete(j.id); r(j.error ? null : j); } } catch { /* ligne illisible */ } } });
    TRP = p; } catch { TRP = false; }
  return TRP;
}
function translate(rec) { if (TR_UNTIL && Date.now() > TR_UNTIL) return Promise.resolve(null); const p = trStart(); if (!p) return Promise.resolve(null); const id = "t" + (++trN);
  return new Promise((res) => { trWait.set(id, res); try { p.stdin.write(JSON.stringify({ id, ...rec }) + "\n"); } catch { trWait.delete(id); res(null); }
    setTimeout(() => { if (trWait.has(id)) { trWait.delete(id); res(null); } }, 150000); }); }
const stepsOf = (R) => { const o = []; const walk = (x) => { if (!x) return; if (typeof x === "string") { o.push(...x.split(/\n+/)); return; } if (Array.isArray(x)) { x.forEach(walk); return; } if (x.itemListElement) walk(x.itemListElement); else if (x.text) o.push(x.text); else if (x.name) o.push(x.name); }; walk(R.recipeInstructions); return o.map((s) => clean(String(s).replace(/<[^>]+>/g, " "))).filter((s) => s.length > 3).slice(0, 25); };
// avant de traduire : pas de porc, pas de dessert peu protéiné, assez de protéines quand les valeurs sont publiées
const PORK_EN = /\b(pork|bacon|ham|hams|gammon|prosciutto|pancetta|chorizo|salami|pepperoni|lardons?|nduja|'nduja|guanciale|serrano|parma ham|black pudding|pigs? in blankets|spare ?ribs|pulled pork|hot ?dogs?|frankfurters?|sausages?|sausagemeat|sausage meat|bratwurst|kielbasa|mortadella|speck|coppa|lard)\b/i;
const PORK_EN_OK = /\b(chicken|turkey|veggie|vegetarian|vegan|plant[- ]based|quorn|beef|lamb|meat-free|meatless|halal) (sausages?|bacon|ham|hot ?dogs?|frankfurters?)\b|\bturkey (rashers|bacon)\b/gi;
const DESSERT_EN = /\b(cakes?|cookies?|brownies?|blondies?|cupcakes?|muffins?|cheesecakes?|puddings?|crumbles?|tarts?|tartlets?|pies?|ice ?cream|fudge|truffles?|biscuits?|scones?|doughnuts?|donuts?|pancakes?|waffles?|smoothies?|cocktails?|mocktails?|gin|vodka|rum|punch|sangria|lemonade|jam|marmalade|chutney|dressing|gravy|stuffing|frosting|icing|meringues?|pavlova|trifle|mousse|sorbet|granola|flapjacks?|bars?|bread|buns?|loaf|cordial|syrup|custard|caramel|toffee|chocolate)\b/i;
const EN_SAVOURY = /\b(chicken|turkey|beef|lamb|salmon|cod|tuna|prawns?|fish|egg|feta|halloumi|cheese|savou?ry|pot pie|cottage pie|shepherd|fish pie|chicken pie|steak pie)\b/i;
// Les recettes retenues attendent leur traduction dans st.enq (file d'attente). Elles sont traduites
//  - pendant le passage par Gemini (secret GEMINI_API_KEY du dépôt), 40 au plus ;
//  - ou depuis un fichier discover/en-tr.json déposé dans la branche data ({ id, title, ing, steps, cat } par recette).
const enLite = (key, url, R, html) => { const a = R.author && (Array.isArray(R.author) ? R.author[0] : R.author);
  return { id: idOf(url), key, u: url, at: Date.now(), v: videoOf(R, html, key),
    R: { name: clean(R.name), recipeIngredient: [].concat(R.recipeIngredient || []).map((x) => clean(String(x))).slice(0, 40), steps: stepsOf(R), recipeCategory: [].concat(R.recipeCategory || []).join(", "),
      nutrition: R.nutrition || null, image: imgOf(R.image) || "", totalTime: R.totalTime || "", prepTime: R.prepTime || "", cookTime: R.cookTime || "", recipeYield: R.recipeYield ?? "",
      aggregateRating: R.aggregateRating || null, author: typeof a === "string" ? a : a && typeof a.name === "string" ? a.name : "" } }; };
function finishEn(q, tr) {
  const x = toRecipe(q.key, q.u, { ...q.R, name: tr.title, recipeIngredient: tr.ing, recipeCategory: tr.cat || "", keywords: "" }, false, "");
  if (x.r) { if (x.r.k === "encas") return { why: "encas (recette anglaise)" }; x.r.lg = "en"; x.r.to = q.R.name.slice(0, 120); x.r.tr = tr.engine === "argos" ? 1 : 2; if (q.v && !x.r.v) x.r.v = q.v;
    if (Array.isArray(tr.steps) && tr.steps.length) x.r.st = tr.steps.slice(0, 20).map((s) => String(s).slice(0, 700)); }
  return x; }
async function readEn(key, url, R, html) {
  const ingEn = [].concat(R.recipeIngredient || []).map(String); const name = clean(R.name);
  const txt = name + " | " + ingEn.join(" | "); const N = R.nutrition || {}; const k = num(N.calories), p = num(N.proteinContent);
  if (PORK_EN.test(txt.replace(PORK_EN_OK, ""))) return { why: "porc" };
  const pr = k && p != null ? (p * 4) / k : null;
  if (!(k && p != null)) return { why: "nutrition absente" };
  if (pr < 0.16) return { why: "pas assez protéiné" };
  if (DESSERT_EN.test(name) && !EN_SAVOURY.test(name) && !(pr >= 0.25)) return { why: "dessert" };
  if (ingEn.length < 3) return { why: "fiche incomplète" };
  const q = enLite(key, url, R, html);
  if (!TR_ON) { if (!st.enq.some((x) => x.id === q.id)) st.enq.push(q); return { why: "en attente de traduction", queued: true }; }
  const tr = await translate({ title: q.R.name, ing: q.R.recipeIngredient, steps: q.R.steps, cat: q.R.recipeCategory });
  if (!tr || !tr.title || !Array.isArray(tr.ing) || tr.ing.length < 3) { trFail++; if (!st.enq.some((x) => x.id === q.id)) st.enq.push(q); return { why: "en attente de traduction", queued: true }; }
  trEng[tr.engine] = (trEng[tr.engine] || 0) + 1;
  return finishEn(q, tr);
}
// recettes de la file d'attente : traductions déposées (en-tr.json), puis Gemini
const keepEn = (x, where) => { if (x.r) { const tk = nrm(x.r.t).replace(/[^a-z0-9]+/g, " ").trim(); if (!st.titles[tk]) { st.titles[tk] = 1; st.pending.push(x.r); return 1; } } else if (x.why) where[x.why] = (where[x.why] || 0) + 1; return 0; };
{ const FP = path.join(DIR, "en-tr.json"); let T = []; try { T = JSON.parse(fs.readFileSync(FP, "utf8")); } catch { T = []; }
  if (Array.isArray(T) && T.length) { const W = {}; let n = 0, kept = 0; const done = new Set();
    for (const t of T) { const q = st.enq.find((x) => x.id === t.id || x.u === t.u); if (!q || !t.title || !Array.isArray(t.ing) || t.ing.length < 3) continue;
      n++; done.add(q.id); kept += keepEn(finishEn(q, { title: String(t.title), ing: t.ing.map(String), steps: Array.isArray(t.steps) ? t.steps.map(String) : [], cat: String(t.cat || ""), engine: "claude" }), W); }
    st.enq = st.enq.filter((x) => !done.has(x.id)); try { fs.unlinkSync(FP); } catch { /* déjà retiré */ }
    say(`traductions déposées : ${n} lues, ${kept} gardées ${JSON.stringify(W)}`); } }
// traduction : 15 minutes au plus par passage (file d'attente et nouvelles fiches)
TR_UNTIL = Date.now() + (+(process.env.TR_BUDGET_MIN || 15)) * 60e3;
if (TR_ON && st.enq.length) { const W = {}; let n = 0, kept = 0; const done = new Set();
  for (const q of st.enq.slice(0, +(process.env.EN_TR_MAX || 40))) { if (Date.now() > TR_UNTIL) break; const tr = await translate({ title: q.R.name, ing: q.R.recipeIngredient, steps: q.R.steps, cat: q.R.recipeCategory });
    if (!tr || !tr.title || !Array.isArray(tr.ing) || tr.ing.length < 3) { trFail++; continue; } trEng[tr.engine] = (trEng[tr.engine] || 0) + 1; n++; done.add(q.id); kept += keepEn(finishEn(q, tr), W); }
  st.enq = st.enq.filter((x) => !done.has(x.id)); if (n) say(`file d'attente anglaise : ${n} traduites, ${kept} gardées ${JSON.stringify(W)}`); }
st.enq = st.enq.slice(-ENQ_MAX);
const why = {}; let ok = 0; const bySrc = {};
for (const [key, url] of queue) {
  if (LEFT() < 0) { say("temps limite atteint : la lecture s'arrête ici, la suite au prochain passage"); break; }
  const r = await get(url); st.seen[idOf(url)] = 1;
  if (r.status !== 200) { why["http " + r.status] = (why["http " + r.status] || 0) + 1; await sleep(500); continue; }
  const R = ld(r.text); if (!R) { why["pas de fiche"] = (why["pas de fiche"] || 0) + 1; await sleep(300); continue; }
  const x = SRC[key].lang === "en" ? await readEn(key, url, R, r.text) : toRecipe(key, url, R, SNACK_SLUG.test(nrm(url)), r.text);
  const B = bySrc[key] || (bySrc[key] = { lu: 0, plats: 0, encas: 0, why: {} }); B.lu++;
  if (x.r) { const tk = nrm(x.r.t).replace(/[^a-z0-9]+/g, " ").trim(); if (st.titles[tk]) { why["doublon"] = (why["doublon"] || 0) + 1; } else { st.titles[tk] = 1; st.pending.push(x.r); ok++; B[x.r.k === "encas" ? "encas" : "plats"]++; if (DRY) say("OK " + JSON.stringify(x.r).slice(0, 600)); } }
  else { const w = x.why.replace(/\d+(\.\d+)?/g, "#"); why[w] = (why[w] || 0) + 1; B.why[w] = (B.why[w] || 0) + 1; }
  await sleep(350);
}
say(`gardées : ${ok} · écartées : ${JSON.stringify(why)}`);
if (trN) say(`traductions : ${JSON.stringify(trEng)}${trFail ? `, échecs ${trFail}` : ""}`);
const trStop = () => { if (TRP) { try { TRP.stdin.end(); } catch { /* déjà fermé */ } const p = TRP; setTimeout(() => { try { p.kill(); } catch { /* fini */ } }, 5000).unref(); } };
if (DRY) trStop();
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
// --- vidéos : les fiches déjà publiées sont relues une seule fois pour repérer leur vidéo (Jow et Hervé Cuisine d'abord)
st.vchk = st.vchk || {};
{ const VSRC = { "Jow": "jow", "Hervé Cuisine": "hervecuisine", "Marmiton": "marmiton", "Betty Bossi": "bettybossi", "Julie Andrieu": "julieandrieu" }; const PRIO = ["Jow", "Hervé Cuisine"];
  const VMAX = +(process.env.VIDEO_CHECK || 450); const files = {}, todo = [];
  for (const f of fs.readdirSync(path.join(DIR, "p"))) { try { const L = JSON.parse(fs.readFileSync(path.join(DIR, "p", f), "utf8")); files[f] = L; for (const e of L) if (!e.v && VSRC[e.src] && !st.vchk[e.id]) todo.push([f, e]); } catch { /* page illisible */ } }
  todo.sort((x, y) => (PRIO.includes(y[1].src) ? 1 : 0) - (PRIO.includes(x[1].src) ? 1 : 0));
  const ch = new Set(); let n = 0, found = 0;
  for (const [f, e] of todo.slice(0, VMAX)) { n++; const r = await get(e.u); if (r.status === 200 || r.status === 404 || r.status === 410) st.vchk[e.id] = 1;
    if (r.status === 200) { const v = videoOf(ld(r.text), r.text, VSRC[e.src]); if (v) { e.v = v; ch.add(f); found++; } } await sleep(350); }
  for (const f of ch) fs.writeFileSync(path.join(DIR, "p", f), JSON.stringify(files[f]));
  if (n) say(`vidéos : ${n} fiches publiées relues, ${found} avec vidéo (reste ${Math.max(0, todo.length - n)})`); }
const SNACK_W = /\b(cookies?|sables?|biscuits?|crackers?|tuiles?|gougeres?|muffins?|cakes? sales?|chips|gressins?|grissini|pancakes?|energy|bouchees?|barres?|mug ?cake|cheesecake|porridge|overnight|mimosa|roules?|verrines?|mousses?|bowl ?cake|tartines?|houmous|hummus|tzatziki|trempette|dip|smoothie|yaourts?|skyr|fromage blanc|cottage|oeufs? (durs?|cocotte|mimosa|farcis?)|collation|encas|snack|gaufres?|madeleines?|edamame|pois chiches? (grilles|rotis|croustillants)|rillettes?|amuse|aperitif|apero|toasts?|galettes? de (pois chiches|flocons)|falafels?|mini|brochettes? apero)\b/;
const SNACK_MAIN = /\b(cabillaud|lotte|brochet|colin|merlu|lieu|dorade|daurade|truite|sole|bar|poulet|dinde|boeuf|veau|agneau|canard|lapin|steak|escalope|filets?|paves?|saint jacques|riz|pates|quinoa|semoule|boulgour|pommes? de terre)\b/;
const snackOk = (e) => { const t = nrm(e.t).replace(/['’]/g, " "); return SNACK_W.test(t) || (!!e.n && e.n.k <= 320 && e.n.p <= 28 && !SNACK_MAIN.test(t)); };
// --- encas : liste à part (discover/encas.json), les 400 plus récents ; au premier passage, on reprend ceux des pages déjà publiées
st.snacks = st.snacks || [];
if (!st.snkSeeded) { for (const f of fs.readdirSync(path.join(DIR, "p"))) { try { for (const e of JSON.parse(fs.readFileSync(path.join(DIR, "p", f), "utf8"))) if (e.k === "encas") st.snacks.push(e); } catch { /* page illisible */ } } st.snkSeeded = 1; }
// nouveaux encas : mis en réserve, puis publiés au fil des jours (SNK_DAY par jour, avec leur date d'ajout « ad ») pour avoir des idées neuves chaque jour
const snkGood = (e) => protOk(e) && srcOk(e) && !porkOf(e) && !MEAL_T.test(nrm(e.t)) && !(e.n && e.n.p > 28) && snackOk(e);
st.snkRes = st.snkRes || [];
{ const have = new Set([...st.snacks, ...st.snkRes].map((e) => e.id)); for (const e of st.pending.filter((e) => e.k === "encas")) if (!have.has(e.id) && snkGood(e)) { st.snkRes.push(e); have.add(e.id); } }
st.pending = st.pending.filter((e) => e.k !== "encas");
{ const SNK_DAY = +(process.env.SNACK_PER_DAY || 12); const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }).replace(/-/g, "");
  if (!st.snkDay || st.snkDay.d !== today) st.snkDay = { d: today, n: 0 };
  // un salé, un sucré, à tour de rôle
  const sv = st.snkRes.filter((e) => e.sv), su = st.snkRes.filter((e) => !e.sv); const out = [];
  while (st.snkDay.n + out.length < SNK_DAY && (sv.length || su.length)) { const e = (out.length % 2 === 0 ? sv.shift() || su.shift() : su.shift() || sv.shift()); out.push(e); }
  const ids = new Set(out.map((e) => e.id)); st.snkRes = st.snkRes.filter((e) => !ids.has(e.id));
  for (const e of out) { e.ad = today; st.snacks.push(e); } st.snkDay.n += out.length;
  say(`encas publiés aujourd'hui : ${st.snkDay.n} (dont ${out.length} à ce passage) · en réserve : ${st.snkRes.length}`); }
{ const seen = new Set(); st.snacks = st.snacks.reverse().filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return snkGood(e); }).slice(0, 600).reverse(); }
for (const e of st.snacks) if (e.src === "Fourchette & Bikini") e.ing = e.ing.map(fixUnitless);
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
// --- recettes anglaises traduites hors ligne (Argos) : refaites avec un modèle de langage quand il est disponible
if (process.env.GEMINI_API_KEY || process.env.GITHUB_TOKEN) { const RMAX = +(process.env.RETRANSLATE || 40); let n = 0, done = 0;
  for (const f of fs.readdirSync(path.join(DIR, "p"))) { if (n >= RMAX) break; const fp = path.join(DIR, "p", f); let L; try { L = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; } let ch = false;
    for (const e of L) { if (n >= RMAX) break; if (e.lg !== "en" || e.tr !== 1) continue; n++; const key = Object.keys(SRC).find((k) => SRC[k].name === e.src); const r = await get(e.u);
      const R = r.status === 200 ? ld(r.text) : null; if (key && R) { const tr = await translate({ title: clean(R.name), ing: [].concat(R.recipeIngredient || []).map(String), steps: stepsOf(R), cat: [].concat(R.recipeCategory || []).join(", "), engine: "llm" });
        if (tr && tr.engine !== "argos" && Array.isArray(tr.ing) && tr.ing.length >= 3) { e.t = String(tr.title).replace(/^./, (c) => c.toUpperCase()).slice(0, 110); e.ing = tr.ing.map((x) => normIng(key, x)).filter(Boolean).slice(0, 30); if (Array.isArray(tr.steps) && tr.steps.length) e.st = tr.steps.slice(0, 20).map((x) => String(x).slice(0, 700)); e.tr = 2; ch = true; done++; } }
      await sleep(350); }
    if (ch) fs.writeFileSync(fp, JSON.stringify(L)); }
  if (n) say(`traductions refaites : ${done} sur ${n}`); }
trStop();
// --- plats avec vidéo : liste à part (discover/videos.json) que l'appli montre en priorité dans le swipe
// une même vidéo YouTube sur 3 fiches ou plus est une vidéo de la chaîne, pas celle de la recette : retirée
let nVid = 0;
{ const files = fs.readdirSync(path.join(DIR, "p")).filter((f) => /^\d+\.json$/.test(f)).sort((a, b) => parseInt(b) - parseInt(a)); const pages = files.map((f) => { try { return [f, JSON.parse(fs.readFileSync(path.join(DIR, "p", f), "utf8"))]; } catch { return [f, []]; } });
  const cnt = {}; for (const [, L] of pages) for (const e of L) if (e.v && e.v !== "page") cnt[e.v] = (cnt[e.v] || 0) + 1;
  const V = [];
  for (const [f, L] of pages) { let ch = false; for (const e of L) { if (e.v && e.v !== "page" && cnt[e.v] >= 3) { delete e.v; ch = true; } if (e.v && e.k !== "encas") V.push(e); } if (ch) fs.writeFileSync(path.join(DIR, "p", f), JSON.stringify(L)); }
  nVid = V.length; fs.writeFileSync(path.join(DIR, "videos.json"), JSON.stringify({ updated: new Date().toISOString(), items: V.slice(0, 600) }));
  say(`plats avec vidéo : ${V.length} (YouTube ${V.filter((e) => e.v !== "page").length}, sur le site ${V.filter((e) => e.v === "page").length})`); }
st.runs++;
fs.writeFileSync(SP, JSON.stringify(st));
fs.writeFileSync(IX, JSON.stringify({ v: 1, gen: RULES, updated: new Date().toISOString(), pages: st.pages, total: st.total, snacks: st.snacks.length, videos: nVid, sources: Object.values(SRC).map((s) => s.name) }));
say(`pages créées : ${made} · total ${st.pages} pages, ${st.total} recettes · en attente ${st.pending.length}`);
fs.writeFileSync(path.join(DIR, "log.txt"), log.join("\n") + "\n");
