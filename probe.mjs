import fs from "fs";
const out = []; const say = (s) => { out.push(s); console.log(s); fs.writeFileSync("report.txt", out.join("\n")); };
process.on("uncaughtException", (e) => { fs.writeFileSync("report.txt", out.join("\n") + "\nERREUR " + (e && e.stack || e)); process.exit(0); });
process.on("unhandledRejection", (e) => { fs.writeFileSync("report.txt", out.join("\n") + "\nERREUR " + (e && e.stack || e)); process.exit(0); });
fs.writeFileSync("report.txt", "début");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function get(u) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000); try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" }, signal: ac.signal }); return { s: r.status, t: r.ok ? await r.text() : "" }; } catch (e) { return { s: 0, t: "" }; } finally { clearTimeout(t); } }
const locs = (x) => [...x.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
function findRecipe(n) { if (!n || typeof n !== "object") return null; if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; } const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n; return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null; }
function ld(html) { const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { for (const src of [m[1].trim(), m[1].replace(/[\u0000-\u001f]+/g, " ").trim()]) { try { const r = findRecipe(JSON.parse(src)); if (r) return r; break; } catch {} } } return null; }
const steps = (R) => { const o = []; const walk = (x) => { if (!x) return; if (typeof x === "string") { o.push(x); return; } if (Array.isArray(x)) { x.forEach(walk); return; } if (x.itemListElement) walk(x.itemListElement); else if (x.text) o.push(x.text); }; walk(R.recipeInstructions); return o.map((s) => String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean); };
const D = [
 ["bbcgoodfood", "https://www.bbcgoodfood.com", /\/recipes\/[a-z0-9-]+$/],
 ["olive", "https://www.olivemagazine.com", /\/recipes\/[a-z0-9-]+\/[a-z0-9-]+\/?$/],
 ["jamieoliver", "https://www.jamieoliver.com", /\/recipes\/[a-z0-9-]+\/[a-z0-9-]+\/?$/],
 ["recipetineats", "https://www.recipetineats.com", /recipetineats\.com\/[a-z0-9-]{6,}\/?$/],
 ["tesco", "https://realfood.tesco.com", /\/recipes\/[a-z0-9-]+\.html$/],
 ["delicious", "https://www.deliciousmagazine.co.uk", /\/recipes\/[a-z0-9-]+\/?$/],
 ["skinnytaste", "https://www.skinnytaste.com", /skinnytaste\.com\/[a-z0-9-]{6,}\/?$/],
 ["eatingwell", "https://www.eatingwell.com", /\/recipe\/\d+\/[a-z0-9-]+\/?$/],
 ["pinchofnom", "https://pinchofnom.com", /\/recipes\/[a-z0-9-]+\/?$/],
 ["nigella", "https://www.nigella.com", /\/recipes\/[a-z0-9-]+\/?$/],
 ["gordonramsay", "https://www.gordonramsay.com", /\/gr\/recipes\/[a-z0-9-]+\/?$/],
];
const samples = [];
for (const [k, base, re] of D) {
  const rb = await get(base + "/robots.txt"); const lines = rb.t.split("\n").map((l) => l.trim());
  const sms = lines.filter((l) => /^sitemap/i.test(l)).map((l) => l.split(/:\s*/).slice(1).join(":").trim());
  const ua = rb.t.match(/User-agent:\s*\*[\s\S]*?(?=User-agent:|$)/i); const dis = ua ? ua[0].split("\n").filter((l) => /^disallow/i.test(l.trim())).slice(0, 8).map((l) => l.trim().replace(/^disallow:\s*/i, "")).join(" ") : "";
  say(`\n### ${k} robots ${rb.s} | * : ${dis.slice(0, 200)} | sitemaps ${sms.slice(0, 3).join(" ")}`);
  const q = [...new Set([...sms, base + "/sitemap.xml", base + "/sitemap_index.xml"])]; const seen = new Set(); let urls = []; let nm = 0;
  while (q.length && nm < 20 && urls.length < 40000) { const m = q.shift(); if (seen.has(m)) continue; seen.add(m); nm++; const r = await get(m); const L = locs(r.t);
    const subs = L.filter((u) => /\.xml(\.gz)?(\?|$)|sitemap/i.test(u) && !re.test(u)); const pages = L.filter((u) => !subs.includes(u));
    if (nm <= 6) say(`  plan ${r.s} ${m.slice(0, 90)} → ${pages.length} pages, ${subs.length} sous-plans ${subs.slice(0, 2).map((x) => x.slice(-45)).join(" ")}`);
    const pri = subs.filter((u) => /(recipe|recette|post)/i.test(u)); const rest = subs.filter((u) => !pri.includes(u));
    q.unshift(...pri.slice(0, 10)); q.push(...rest.slice(0, 3)); urls.push(...pages); }
  const cand = [...new Set(urls.filter((u) => re.test(u)))];
  say(`  urls ${urls.length} recettes ${cand.length}`);
  let n = 0, nut = 0, prot = 0;
  for (const u of cand.sort(() => Math.random() - 0.5).slice(0, 6)) { const r = await get(u); const R = ld(r.t);
    if (R) { n++; const N = R.nutrition || {}; if (N.calories) nut++; if (N.proteinContent) prot++; const ar = R.aggregateRating || {}; const ing = R.recipeIngredient || []; const st = steps(R);
      say(`  ${r.s} ${u.slice(0, 80)} | ${String(R.name).slice(0, 34)} | y ${String(R.recipeYield).slice(0, 12)} | ing ${ing.length} st ${st.length} | ${N.calories || "-"}/${N.proteinContent || "-"} | note ${ar.ratingValue || "-"}/${ar.ratingCount || ar.reviewCount || "-"} | ${ing.slice(0, 3).join(" ; ").slice(0, 110)}`);
      if (samples.filter((s) => s.src === k).length < 2 && ing.length && st.length) samples.push({ src: k, t: R.name, ing: ing.slice(0, 14), st: st.slice(0, 8) }); }
    else say(`  -- ${r.s} ${u.slice(0, 90)} sans Recipe`); }
  say(`  => ${n} fiches, ${nut} kcal, ${prot} protéines`);
}
fs.writeFileSync("samples.json", JSON.stringify(samples));
say("FIN SOURCES");
