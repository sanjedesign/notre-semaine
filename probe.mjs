import fs from "fs";
const out = []; const say = (s) => { out.push(s); console.log(s); };
const B = "https://prices.openfoodfacts.org/api/v1";
async function H(url) { try { const r = await fetch(url, { headers: { Accept: "application/json", Origin: "https://sanjedesign.github.io" } }); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {} return { s: r.status, acao: r.headers.get("access-control-allow-origin"), j }; } catch (e) { return { s: 0, e: String(e) }; } }
let r = await H(`${B}/locations?osm_address_city__like=Strasbourg&size=50&order_by=-price_count`);
say(`LOC status=${r.s} ACAO=${r.acao} total=${r.j && r.j.total}`);
r = await H(`${B}/locations?osm_address_city__like=strasb&size=5&order_by=-price_count`);
say(`LOC partial status=${r.s} total=${r.j && r.j.total}`);
r = await H(`${B}/locations?osm_address_city__like=%25strasb%25&size=5&order_by=-price_count`);
say(`LOC wildcard status=${r.s} total=${r.j && r.j.total}`);
r = await H(`${B}/prices?location_id=286&size=100&order_by=-date`);
say(`PRICES status=${r.s} ACAO=${r.acao} total=${r.j && r.j.total}`);
for (const it of ((r.j && r.j.items) || []).slice(0, 60)) {
  const p = it.product || {};
  say(` ${it.date} ${it.price} ${it.price_per || ""} type=${it.type} cat=${it.category_tag || ""} | ${p.product_name || ""} q=${p.product_quantity || ""}${p.product_quantity_unit || ""} cats=${(p.categories_tags || []).slice(-3).join(",")} keys=${Object.keys(p).length}`);
}
// preflight check
try { const o = await fetch(`${B}/locations?size=1`, { method: "OPTIONS", headers: { Origin: "https://sanjedesign.github.io", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "accept" } }); say(`OPTIONS ${o.status} ACAO=${o.headers.get("access-control-allow-origin")} ACAM=${o.headers.get("access-control-allow-methods")}`); } catch (e) { say("OPTIONS err " + e) }
fs.writeFileSync("report.txt", out.join("\n"));
