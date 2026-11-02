const out = []; const say = (s) => { out.push(s); console.log(s); };
async function J(url) { try { const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Sano-meal-planner/1.0 (contact via github sanjedesign)" } }); const t = await r.text(); try { return { s: r.status, j: JSON.parse(t) }; } catch { return { s: r.status, j: null, t: t.slice(0, 200) }; } } catch (e) { return { s: 0, e: String(e) }; } }
const B = "https://prices.openfoodfacts.org/api/v1";
for (const q of ["osm_address_postcode__like=670", "osm_address_city__like=Strasbourg", "osm_address_postcode__like=67", "osm_address_city__like=strasbourg&price_count__gte=5"]) {
  const r = await J(`${B}/locations?${q}&size=100&order_by=-price_count`); const it = (r.j && r.j.items) || [];
  say(`LOC ${q} ${r.s} total=${r.j && r.j.total} ${r.t || ""}`);
  for (const L of it.slice(0, 25)) say(`   #${L.id} ${L.osm_name} · ${L.osm_address_postcode} ${L.osm_address_city} · prix=${L.price_count} · produits=${L.product_count || ""} · ${L.osm_lat},${L.osm_lon} · maj ${String(L.updated || "").slice(0, 10)}`);
}
const r = await J(`${B}/locations?osm_address_postcode__like=67&size=100&order_by=-price_count`); const top = ((r.j && r.j.items) || []).slice(0, 6);
for (const L of top) { const p = await J(`${B}/prices?location_id=${L.id}&size=5&order_by=-date`); const it = (p.j && p.j.items) || [];
  say(`PRIX @${L.osm_name} ${L.osm_address_city}: total=${p.j && p.j.total} récents=${it.map((x) => x.date).join(",")} ex=${it.map((x) => ((x.product && x.product.product_name) || x.category_tag) + " " + x.price + (x.price_per ? "/" + x.price_per : "")).join(" | ").slice(0, 300)}`); }
// catégories brutes (fruits, légumes, viandes) en France
const c = await J(`${B}/prices?category_tag=en:chicken-breasts&size=10&order_by=-date&location__osm_address_country=France`); say(`CAT poulet ${c.s} total=${c.j && c.j.total} ${((c.j && c.j.items) || []).map((x) => x.price + "/" + x.price_per + " @" + ((x.location && x.location.osm_name) || "")).join(" | ")}`);
import fs from "node:fs"; fs.writeFileSync("report.txt", out.join("\n") + "\n");
