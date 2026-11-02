import fs from "fs";
const out = []; const say = (s) => { out.push(s); console.log(s); };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function get(u) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000); try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" }, signal: ac.signal, redirect: "follow" }); return { s: r.status, t: r.ok ? await r.text() : "", u: r.url }; } catch (e) { return { s: 0, t: "", e: String(e).slice(0, 80) }; } finally { clearTimeout(t); } }
const locs = (x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
function findRecipe(n) { if (!n || typeof n !== "object") return null; if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; } const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n; return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null; }
function ld(html) { const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { try { const r = findRecipe(JSON.parse(m[1].trim())); if (r) return r; } catch {} } return null; }
const D = [
 ["etchebest", "https://philippe-etchebest.com", ["/sitemap_index.xml", "/wp-sitemap.xml", "/sitemap.xml"], /\/(recette|recettes)?[a-z0-9-]{8,}\/?$/],
 ["chefsimon", "https://chefsimon.com", ["/sitemap.xml", "/sitemap_index.xml"], /\/gourmets\/|\/recettes\//],
 ["hervecuisine", "https://www.hervecuisine.com", ["/sitemap_index.xml", "/sitemap.xml", "/wp-sitemap.xml"], /\/recette\//],
 ["julieandrieu", "https://www.julieandrieu.com", ["/sitemap.xml", "/sitemap_index.xml"], /recette/],
 ["mariotte", "https://www.laurentmariotte.com", ["/sitemap.xml", "/sitemap_index.xml"], /recette/],
 ["750g", "https://www.750g.com", ["/sitemap.xml"], /\/[a-z0-9-]+-r\d+\.htm$/],
 ["michel-dumas", "https://chefmicheldumas.com", ["/sitemap_index.xml", "/sitemap.xml"], /recette|\/[a-z0-9-]{10,}\/?$/],
 ["lignac", "https://www.cyrillignac.com", ["/sitemap.xml"], /recette/],
 ["cuisineactuelle", "https://www.cuisineactuelle.fr", ["/sitemap.xml"], /\/recettes\//],
 ["ducasse", "https://www.ducasse-paris.com", ["/sitemap.xml"], /recette/],
 ["guydemarle", "https://www.guydemarle.com", ["/sitemap.xml"], /recettes\//],
 ["ricardo", "https://www.ricardocuisine.com", ["/sitemap.xml"], /\/recettes\/\d+/],
];
for (const [k, base, maps, re] of D) {
  const rb = await get(base + "/robots.txt");
  const lines = rb.t.split("\n").map((l) => l.trim()).filter((l) => /^(user-agent|disallow|sitemap|allow|crawl-delay)/i.test(l));
  say(`\n### ${k} robots ${rb.s} : ` + lines.filter((l) => !/^allow/i.test(l)).slice(0, 18).join(" | "));
  let urls = []; const sm = [...new Set([...maps.map((m) => base + m), ...lines.filter((l) => /^sitemap/i.test(l)).map((l) => l.split(/:\s*/).slice(1).join(":").trim())])];
  for (const m of sm.slice(0, 4)) { const r = await get(m); const L = locs(r.t); say(`  map ${r.s} ${m} → ${L.length} ${L.slice(0, 3).join(" ")}`);
    const subs = L.filter((u) => /\.xml/i.test(u) && /(recipe|recette|post|wprm|page)/i.test(u)).slice(0, 3);
    for (const s2 of subs) { const r2 = await get(s2); const L2 = locs(r2.t); say(`    sub ${r2.s} ${s2} → ${L2.length} ex ${L2.slice(0, 2).join(" ")}`); urls.push(...L2.filter((u) => !/\.xml/i.test(u))); }
    urls.push(...L.filter((u) => !/\.xml/i.test(u))); if (urls.length > 50) break; }
  const cand = urls.filter((u) => re.test(u)).slice(0, 60); say(`  urls ${urls.length} candidates ${cand.length}`);
  let shown = 0;
  for (const u of cand.sort(() => Math.random() - 0.5).slice(0, 6)) { const r = await get(u); const R = ld(r.t);
    if (R) { shown++; const n = R.nutrition || {}; say(`  OK ${r.s} ${u} | ${String(R.name).slice(0, 50)} | ing ${(R.recipeIngredient || []).length} ex "${(R.recipeIngredient || [])[0] || ""}" | yield ${JSON.stringify(R.recipeYield)} | nut ${n.calories || "-"} p ${n.proteinContent || "-"} | auteur ${JSON.stringify(R.author && (R.author.name || R.author)).slice(0, 40)} | note ${R.aggregateRating ? R.aggregateRating.ratingValue + "/" + (R.aggregateRating.ratingCount || R.aggregateRating.reviewCount) : "-"}`); if (shown >= 3) break; }
    else say(`  -- ${r.s} ${u} pas de Recipe JSON-LD`);
    await new Promise((z) => setTimeout(z, 400)); }
}
fs.writeFileSync("report.txt", out.join("\n"));
