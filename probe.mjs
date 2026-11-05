import fs from "fs";
const out = []; const say = (s) => { out.push(s); console.log(s); fs.writeFileSync("report.txt", out.join("\n")); };
process.on("uncaughtException", (e) => { fs.writeFileSync("report.txt", out.join("\n") + "\nERREUR " + (e && e.stack || e)); process.exit(0); });
process.on("unhandledRejection", (e) => { fs.writeFileSync("report.txt", out.join("\n") + "\nERREUR " + (e && e.stack || e)); process.exit(0); });
fs.writeFileSync("report.txt", "début");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function get(u) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000); try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR" }, signal: ac.signal }); return { s: r.status, t: r.ok ? await r.text() : "" }; } catch (e) { return { s: 0, t: "" }; } finally { clearTimeout(t); } }
const locs = (x) => [...x.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
function findRecipe(n) { if (!n || typeof n !== "object") return null; if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; } const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n; return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null; }
function ld(html) { const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { for (const src of [m[1].trim(), m[1].replace(/[\u0000-\u001f]+/g, " ").trim()]) { try { const r = findRecipe(JSON.parse(src)); if (r) return r; break; } catch {} } } return null; }
const nrm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const SNACK = /(cookie|sable|biscuit|tuile|gougere|cake-sale|chips|grissini|gressin|crackers?|galette-de-flocons|proteine|protein|skyr|fromage-blanc|cottage|energy-?ball|bouchee|muffin|pancake|barre|houmous|hummus|tzatziki|edamame|pois-chiches?-(grilles|rotis|croustillants)|oeufs?-(mimosa|durs?|cocotte|farcis)|collation|encas|snack|mug-?cake|porridge|overnight|trempette|verrine|gaufre|bowl-cake|apero|rillettes-de-(thon|saumon|sardine|maquereau))/;
const D = [
 ["cuisineaz", "https://www.cuisineaz.com", /\/recettes\/[a-z0-9-]+-\d+\.aspx$/],
 ["750g", "https://www.750g.com", /750g\.com\/[a-z0-9-]+-r\d+\.htm$/],
 ["ricardo", "https://www.ricardocuisine.com", /\/recettes\/\d+-/],
 ["foodspring", "https://www.foodspring.fr", /\/magazine\/|recette/],
 ["nutriandco", "https://nutriandco.com", /recette/],
 ["myprotein", "https://fr.myprotein.com", /recette/],
 ["cuisineactuelle", "https://www.cuisineactuelle.fr", /\/recettes\/[a-z0-9-]+-\d+$/],
 ["jdf", "https://cuisine.journaldesfemmes.fr", /\/recette\/\d+-/],
 ["fourchette", "https://www.fourchette-et-bikini.fr", /\/recettes\/[a-z0-9-]+-\d+\.html$/],
 ["chefsimon", "https://chefsimon.com", /\/gourmets\/.*\/recettes\/|\/recettes\//],
 ["jujufitcats", "https://www.jujufitcats.com", /\/[a-z0-9-]{10,}\/?$/],
 ["lacuisinedebernard", "https://www.lacuisinedebernard.com", /\/[a-z0-9-]{10,}\/?$/],
];
for (const [k, base, re] of D) {
  const rb = await get(base + "/robots.txt"); const lines = rb.t.split("\n").map((l) => l.trim());
  const sms = lines.filter((l) => /^sitemap/i.test(l)).map((l) => l.split(/:\s*/).slice(1).join(":").trim());
  const dis = lines.filter((l) => /^disallow/i.test(l)).slice(0, 6).join(" | ");
  say(`\n### ${k} robots ${rb.s} | ${dis} | sitemaps ${sms.slice(0, 4).join(" ")}`);
  const q = [...new Set([...sms, base + "/sitemap.xml", base + "/sitemap_index.xml"])]; const seen = new Set(); let urls = []; let nm = 0;
  while (q.length && nm < 25 && urls.length < 60000) { const m = q.shift(); if (seen.has(m)) continue; seen.add(m); nm++; const r = await get(m); const L = locs(r.t);
    const subs = L.filter((u) => /\.xml(\.gz)?(\?|$)/i.test(u)); const pages = L.filter((u) => !/\.xml(\.gz)?(\?|$)/i.test(u));
    say(`  plan ${r.s} ${m.slice(0, 100)} → ${pages.length} pages, ${subs.length} sous-plans ${subs.slice(0, 3).map((x) => x.slice(-50)).join(" ")}`);
    // sous-plans : ceux des recettes d'abord
    const pri = subs.filter((u) => /(recipe|recette|post|article)/i.test(u)); const rest = subs.filter((u) => !pri.includes(u));
    q.unshift(...pri.slice(0, 12)); q.push(...rest.slice(0, 4)); urls.push(...pages); }
  const cand = urls.filter((u) => re.test(u)); const sn = cand.filter((u) => SNACK.test(nrm(u)));
  say(`  urls ${urls.length} recettes ${cand.length} encas ${sn.length}`);
  let n = 0, nut = 0;
  for (const u of sn.sort(() => Math.random() - 0.5).slice(0, 6)) { const r = await get(u); const R = ld(r.t);
    if (R) { n++; const N = R.nutrition || {}; if (N.calories) nut++; const ar = R.aggregateRating || {};
      say(`  ${r.s} ${u.slice(0, 95)} | ${String(R.name).slice(0, 38)} | ing ${(R.recipeIngredient || []).length} | ${N.calories ? N.calories + "/" + N.proteinContent : "sans valeurs"} | note ${ar.ratingValue || "-"}/${ar.ratingCount || ar.reviewCount || "-"} | ${(R.recipeIngredient || []).slice(0, 2).join(" ; ").slice(0, 70)}`); }
    else say(`  -- ${r.s} ${u.slice(0, 95)} sans Recipe`); }
  say(`  => ${n} fiches, ${nut} avec valeurs`);
}
say("FIN");
