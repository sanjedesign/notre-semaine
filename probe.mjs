// sonde : pour chaque source candidate, liens de recettes trouvés et présence des valeurs nutritionnelles (JSON-LD)
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, ms = 20000) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" }, signal: ac.signal, redirect: "follow" }); return { status: r.status, url: r.url, text: r.ok ? await r.text() : "" }; } catch (e) { return { status: 0, text: "", err: String(e).slice(0, 80) }; } finally { clearTimeout(t); } }
const locs = (x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
function findRecipe(n) { if (!n || typeof n !== "object") return null; if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; }
  const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n; return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null; }
function ld(html) { const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { for (const src of [m[1].trim(), m[1].replace(/[\u0000-\u001f]+/g, " ").trim()]) { try { const r = findRecipe(JSON.parse(src)); if (r) return r; break; } catch { } } } return null; }
const out = [];
const say = (s) => { out.push(s); console.log(s); };
// sources à sitemap
const MAPS = {
  ricardo: { maps: ["https://www.ricardocuisine.com/sitemap.xml", "https://www.ricardocuisine.com/sitemap-recettes.xml"], re: /ricardocuisine\.com\/recettes\/\d+/ },
  kitchenstories: { maps: ["https://www.kitchenstories.com/sitemap.xml", "https://www.kitchenstories.com/fr/sitemap.xml"], re: /kitchenstories\.com\/fr\/recettes\/[a-z0-9-]+$/ },
  quitoque: { maps: ["https://www.quitoque.fr/sitemap.xml"], re: /quitoque\.fr\/recette[s]?\/[a-z0-9-]+/ },
  lidl: { maps: ["https://www.lidl-recettes.fr/sitemap.xml"], re: /lidl-recettes\.fr\/recettes\/[a-z0-9-]+/ },
  kilosolution: { maps: ["https://www.kilosolution.com/sitemap.xml", "https://kilosolution.com/sitemap_index.xml"], re: /kilosolution\.com\/recettes?\/[a-z0-9-]+/ },
  croqkilos: { maps: ["https://www.croq-kilos.com/sitemap.xml", "https://www.croq-kilos.com/sitemap_index.xml"], re: /croq-kilos\.com\/recettes?\/[a-z0-9-]+/ },
  cuisinefutee: { maps: ["https://cuisinefuteeparentspresses.telequebec.tv/sitemap.xml"], re: /cuisinefuteeparentspresses\.telequebec\.tv\/recettes\/\d+/ },
  coupdepouce: { maps: ["https://www.coupdepouce.com/sitemap.xml"], re: /coupdepouce\.com\/cuisine\/recettes\/[a-z0-9-]+/ },
  foodspring: { maps: ["https://www.foodspring.fr/sitemap.xml"], re: /foodspring\.fr\/magazine\/[a-z0-9-]+/ },
  g750: { maps: ["https://www.750g.com/sitemap.xml"], re: /750g\.com\/[a-z0-9-]+-r\d+\.htm/ },
  journaldesfemmes: { maps: ["https://cuisine.journaldesfemmes.fr/sitemap.xml"], re: /cuisine\.journaldesfemmes\.fr\/recette\/\d+/ },
  cuisineaz: { maps: ["https://www.cuisineaz.com/sitemap.xml"], re: /cuisineaz\.com\/recettes\/[a-z0-9-]+-\d+\.aspx/ },
  myprotein: { maps: ["https://fr.myprotein.com/thezone/sitemap_index.xml", "https://fr.myprotein.com/thezone/sitemap.xml"], re: /myprotein\.com\/thezone\/recettes?\/[a-z0-9-]+/ },
  nutrimuscle: { maps: ["https://www.nutrimuscle.com/sitemap.xml"], re: /nutrimuscle\.com\/blogs\/[a-z0-9-]+\/[a-z0-9-]*(recette|proteine)[a-z0-9-]*/ },
  hfhub: { maps: [], lists: ["https://www.hellofresh.fr/recipes/recettes-riches-en-proteines", "https://www.hellofresh.fr/recipes/recettes-proteinees", "https://www.hellofresh.fr/recipes/high-protein-recipes", "https://www.hellofresh.fr/recipes/recettes-saines"], re: /hellofresh\.fr\/recipes\/[a-z0-9-]+-[0-9a-f]{24}/ },
  marmitonq: { maps: [], lists: ["proteine", "prot%C3%A9in%C3%A9", "skyr", "fromage+blanc", "cottage+cheese", "riche+en+prot%C3%A9ines", "blanc+de+poulet", "dinde", "cabillaud", "thon"].map((q) => `https://www.marmiton.org/recettes/recherche.aspx?aqt=${q}`), re: /marmiton\.org\/recettes\/recette_[a-z0-9-]+_\d+\.aspx/ },
  fbtags: { maps: [], lists: ["https://www.fourchette-et-bikini.fr/recettes/recettes-proteinees", "https://www.fourchette-et-bikini.fr/recettes/recettes-riches-en-proteines", "https://www.fourchette-et-bikini.fr/recettes/collations", "https://www.fourchette-et-bikini.fr/recettes"], re: /fourchette-et-bikini\.fr\/recettes\/[a-z0-9-]+-\d+\.html/ },
  jowsearch: { maps: [], lists: ["https://jow.fr/recipes?tags=high-protein", "https://jow.fr/fr/recipes"], re: /jow\.fr\/recipes\/[a-z0-9-]+/ },
};
for (const [k, S] of Object.entries(MAPS)) {
  const urls = new Set(); const q = [...S.maps]; const done = new Set(); let n = 0;
  while (q.length && n < 14) { const m = q.shift(); if (done.has(m)) continue; done.add(m); n++; const r = await get(m); const L = locs(r.text);
    const subs = L.filter((u) => /\.xml/i.test(u)); const hit = L.filter((u) => S.re.test(u)); hit.forEach((u) => urls.add(u));
    say(`${k} plan ${r.status} ${m} → ${L.length} liens, ${hit.length} recettes, ${subs.length} sous-plans ${r.err || ""}`);
    if (!hit.length) for (const u of subs.filter((u) => /recet|recipe|post|article|cuisine|magazine/i.test(u)).slice(0, 6)) q.push(u);
    if (!hit.length && L.length) say("   ex " + L.slice(0, 5).join(" | "));
    await sleep(300); }
  for (const l of S.lists || []) { const r = await get(l); const hits = [...new Set([...r.text.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&"), l).href).filter((u) => S.re.test(u)))];
    hits.forEach((u) => urls.add(u)); say(`${k} liste ${r.status} ${l} → ${hits.length}`); await sleep(400); }
  const U = [...urls]; say(`${k} : ${U.length} recettes trouvées`);
  const sample = U.sort(() => Math.random() - 0.5).slice(0, 6); let rec = 0, nut = 0, prot = 0; const ex = [];
  for (const u of sample) { const r = await get(u); const R = ld(r.text); if (R) { rec++; const N = R.nutrition || {}; if (N.calories) nut++; if (N.proteinContent != null) { prot++; ex.push(`${String(R.name).slice(0, 40)} ${N.calories} P${N.proteinContent} y=${JSON.stringify(R.recipeYield)}`); } else if (!N.calories) ex.push(`${String(R.name).slice(0, 40)} (sans nutrition, clés ${Object.keys(R).slice(0, 12).join(",")})`) } else ex.push(`${r.status} pas de JSON-LD ${u.slice(0, 80)}`); await sleep(400); }
  say(`${k} ÉCHANTILLON ${sample.length} : recette ${rec}, calories ${nut}, protéines ${prot}`); ex.forEach((x) => say("   " + x)); say("");
}
import fs from "node:fs"; fs.writeFileSync("report.txt", out.join("\n") + "\n");
