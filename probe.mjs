const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const out = []; const say = (s) => { out.push(s); console.log(s); };
async function get(url, json) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 25000);
  try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Accept: json ? "application/json" : "text/html,*/*" }, signal: ac.signal }); return { s: r.status, t: await r.text() }; } catch (e) { return { s: 0, t: "", e: String(e).slice(0, 80) }; } finally { clearTimeout(t); } }
// 1. Open Prices autour de Strasbourg
for (const q of ["location__osm_address_city=Strasbourg", "location__osm_address_postcode=67000", "location__osm_address_city=Schiltigheim", "location__osm_address_city=Illkirch-Graffenstaden"]) {
  const r = await get(`https://prices.openfoodfacts.org/api/v1/prices?${q}&size=100&order_by=-date`, 1); let j = {}; try { j = JSON.parse(r.t); } catch {}
  const it = j.items || []; const locs = {}; for (const p of it) { const L = p.location || {}; const k = (L.osm_name || "?") + " · " + (L.osm_address_city || ""); locs[k] = (locs[k] || 0) + 1; }
  say(`OP ${q} ${r.s} total=${j.total} page=${it.length} dates=${it.length ? it[it.length - 1].date + "→" + it[0].date : ""}`); say("   " + JSON.stringify(locs).slice(0, 400));
  say("   ex " + it.slice(0, 5).map((p) => `${(p.product && p.product.product_name) || p.category_tag} ${p.price}€/${p.price_per || ""}`).join(" | ").slice(0, 400)); }
// catégories (prix sans code-barres : fruits, légumes, viandes au kilo)
{ const r = await get("https://prices.openfoodfacts.org/api/v1/prices?location__osm_address_city=Strasbourg&product_code__isnull=true&size=50", 1); let j = {}; try { j = JSON.parse(r.t); } catch {} say(`OP sans code ${r.s} total=${j.total} ex ${(j.items || []).slice(0, 8).map((p) => p.category_tag + " " + p.price + "/" + p.price_per).join(" | ")}`); }
// 2. Monoprix
for (const u of ["https://courses.monoprix.fr/robots.txt", "https://courses.monoprix.fr/api/v5/products/search?term=blanc%20de%20poulet", "https://courses.monoprix.fr/api/webproductpagews/v5/products/search?term=poulet"]) {
  const r = await get(u, /api/.test(u)); say(`MPX ${r.s} ${u.slice(26, 90)} ${r.t.length}o :: ${r.t.replace(/\s+/g, " ").slice(0, 300)}`); }
{ const r = await get("https://courses.monoprix.fr/categories?q=poulet"); const m = r.t.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]{0,200})/); say("MPX state " + (m ? m[1].slice(0, 200) : "absent")); const P = [...r.t.matchAll(/"name":"([^"]{5,60})"[^{}]{0,400}?"amount":"?(\d+[.,]\d+)/g)].slice(0, 6).map((x) => x[1] + " " + x[2]); say("MPX produits " + JSON.stringify(P)); }
// 3. Aldi
{ const r = await get("https://www.aldi.fr/recherche.html?query=poulet"); const nd = r.t.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); say("ALDI next " + (nd ? nd[1].length : 0) + " prix? " + ((nd && nd[1].match(/"price[^"]*":\s*\{?"?[\d.]+/g)) || []).slice(0, 5).join(" | ")); }
{ const r = await get("https://www.aldi.fr/robots.txt"); say("ALDI robots " + r.s + " " + r.t.replace(/\s+/g, " ").slice(0, 300)); }
// 4. E.Leclerc
{ const r = await get("https://www.e.leclerc/robots.txt"); say("ELEC robots " + r.s + " " + r.t.replace(/\s+/g, " ").slice(0, 300)); }
{ const r = await get("https://www.e.leclerc/recherche?q=blanc+de+poulet"); const P = [...r.t.matchAll(/([A-ZÉ][^<>"]{8,70})<\/[^>]+>[\s\S]{0,300}?(\d+[,.]\d{2})\s?€/g)].slice(0, 6).map((x) => x[1].trim() + " " + x[2]); say("ELEC produits " + JSON.stringify(P)); }
import fs from "node:fs"; fs.writeFileSync("report.txt", out.join("\n") + "\n");
