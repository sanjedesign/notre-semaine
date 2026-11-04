import fs from "fs";
const out = []; const say = (s) => { out.push(s); console.log(s); };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function get(u) { try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR" } }); return { s: r.status, t: r.ok ? await r.text() : "" }; } catch (e) { return { s: 0, t: "" }; } }
function findRecipe(n) { if (!n || typeof n !== "object") return null; if (Array.isArray(n)) { for (const x of n) { const r = findRecipe(x); if (r) return r; } return null; } const t = n["@type"]; if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) return n; return findRecipe(n["@graph"]) || findRecipe(n.mainEntity) || null; }
function ld(html) { const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m; while ((m = re.exec(html))) { try { const r = findRecipe(JSON.parse(m[1].trim())); if (r) return r; } catch {} } return null; }
const U = [
 "https://jow.fr/recipes/pates-au-thon-tomates-cerises-et-feta-95sh769101ht0jnm0kps",
 "https://jow.fr/recipes/poulet-a-la-grecque-au-air-fryer-91uriuq34d2o03jr0x51",
 "https://jow.fr/recipes/cabillaud-mousseline-de-carotte-et-salade-8vchduxzhyhc03wu0i8k",
 "https://www.marmiton.org/recettes/recette_poulet-curry-et-oignons-facile_31542.aspx",
 "https://www.marmiton.org/recettes/recette_chili-con-carne_11695.aspx",
 "https://www.julieandrieu.com/recettes/curry-de-cabillaud-aux-petits-pois",
 "https://www.hellofresh.fr/recipes/poulet-label-rouge-and-riz-saute-aux-legumes-66b1f3c1b3f4f6a0d6e4a1b2",
 "https://www.fourchette-et-bikini.fr/recettes/mousse-au-chocolat-noir-proteinee-40287.html",
];
for (const u of U) { const r = await get(u); const R = ld(r.t); const v = R && R.video;
  const vids = [...new Set([...r.t.matchAll(/(https?:[^"'\s<>]+\.(?:mp4|m3u8)[^"'\s<>]*)/g)].map((m) => m[1]))].slice(0, 3);
  const yt = [...new Set([...r.t.matchAll(/(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/g)].map((m) => m[1]))].slice(0, 3);
  const dm = [...new Set([...r.t.matchAll(/dailymotion\.com\/(?:embed\/)?video\/([a-z0-9]+)/gi)].map((m) => m[1]))].slice(0, 3);
  say(`\n${r.s} ${u}\n  ld.video=${JSON.stringify(v).slice(0, 500)}\n  mp4/m3u8 dans la page=${vids.join(" | ")}\n  youtube=${yt.join(",")} dailymotion=${dm.join(",")}`); }
fs.writeFileSync("report.txt", out.join("\n"));
