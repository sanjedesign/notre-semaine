import fs from "fs";
const out = []; const say = (s) => { out.push(s); console.log(s); };
process.on("uncaughtException", (e) => { fs.writeFileSync("report.txt", out.join("\n") + "\nERREUR " + (e && e.stack || e)); process.exit(0); });
process.on("unhandledRejection", (e) => { fs.writeFileSync("report.txt", out.join("\n") + "\nERREUR " + (e && e.stack || e)); process.exit(0); });
fs.writeFileSync("report.txt", "début");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function get(u) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000); try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR" }, signal: ac.signal }); return { s: r.status, t: r.ok ? await r.text() : "" }; } catch (e) { return { s: 0, t: "" }; } finally { clearTimeout(t); } }
const locs = (x) => [...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
function findRecipe(n) { if (!n || typeof n !== "object") return null; if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; } const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n; return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null; }
function ld(html) { const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { try { const r = findRecipe(JSON.parse(m[1].trim())); if (r) return r; } catch {} } return null; }
const yt = (h) => [...new Set([...h.matchAll(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/g)].map((m) => m[1]))];
const D = [["amandinecooking", "https://www.amandinecooking.com", /recette|\/[a-z0-9-]{12,}\/?$/], ["jujufitcats", "https://www.jujufitcats.com", /recette|\/[a-z0-9-]{12,}\/?$/],
 ["chefclub", "https://www.chefclub.tv", /\/recettes\/recette\//], ["cuisineaz", "https://www.cuisineaz.com", /\/recettes\/.*\.aspx$/], ["lerizjaune", "https://www.lerizjaune.com", /recette|\/[a-z0-9-]{12,}\/?$/],
 ["mercotte", "https://www.mercotte.fr", /\/20\d\d\/\d\d\//], ["regal", "https://www.regal.fr", /\/recettes\//], ["cuisineactuelle-sitemap", "https://www.cuisineactuelle.fr", /\/recettes\//],
 ["ptitchef", "https://www.ptitchef.com", /\/recettes\//], ["hervecuisine", "https://www.hervecuisine.com", /\/recette\//]];
for (const [k, base, re] of D) {
  const rb = await get(base + "/robots.txt"); const lines = rb.t.split("\n").map((l) => l.trim());
  const dis = lines.filter((l) => /^disallow/i.test(l)).slice(0, 8).join(" | "); const sms = lines.filter((l) => /^sitemap/i.test(l)).map((l) => l.split(/:\s*/).slice(1).join(":").trim());
  const ai = lines.filter((l) => /^user-agent:\s*(\*|claudebot|gptbot)/i.test(l)).join(",");
  say(`\n### ${k} robots ${rb.s} | ${dis} | sitemaps ${sms.slice(0, 3).join(" ")}`);
  let urls = [];
  for (const m of [...sms.slice(0, 2), base + "/sitemap.xml", base + "/sitemap_index.xml"]) { if (urls.length > 40) break; const r = await get(m); const L = locs(r.t);
    const sub = L.filter((u) => /\.xml/.test(u) && /(recipe|recette|post)/i.test(u)).slice(0, 2); for (const s2 of sub) { const r2 = await get(s2); urls.push(...locs(r2.t).filter((u) => !/\.xml/.test(u))); }
    urls.push(...L.filter((u) => !/\.xml/.test(u))); }
  const cand = urls.filter((u) => re.test(u)); say(`  urls ${urls.length} candidates ${cand.length}`);
  let n = 0, wv = 0;
  for (const u of cand.sort(() => Math.random() - 0.5).slice(0, 6)) { const r = await get(u); const R = ld(r.t); const v = R && R.video; const y = yt(r.t);
    if (R) { n++; const vv = Array.isArray(v) ? v[0] : v; const hasV = !!(vv && (vv.embedUrl || vv.contentUrl)) || y.length > 0; if (hasV) wv++;
      say(`  ${r.s} ${u.slice(0, 90)} | ${String(R.name).slice(0, 40)} | ing ${(R.recipeIngredient || []).length} | nut ${R.nutrition && R.nutrition.calories ? "oui" : "-"} | video ${vv ? (vv.embedUrl || vv.contentUrl || "").slice(0, 60) : "-"} | yt ${y.slice(0, 2).join(",")}`); }
    else say(`  -- ${r.s} ${u.slice(0, 90)} sans Recipe`); }
  say(`  => ${n} fiches, ${wv} avec vidéo`);
}
fs.writeFileSync("report.txt", out.join("\n"));
