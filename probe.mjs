// sonde : quels catalogues de magasins donnent des prix lisibles depuis un serveur, et lesquels filtrent par lieu
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const out = []; const say = (s) => { out.push(s); console.log(s); };
async function get(url, h = {}) { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
  try { const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Accept: h.json ? "application/json" : "text/html,application/json;q=0.9,*/*;q=0.8", ...(h.headers || {}) }, signal: ac.signal, redirect: "follow" });
    const txt = await r.text(); return { s: r.status, u: r.url, t: txt }; } catch (e) { return { s: 0, t: "", e: String(e).slice(0, 100) }; } finally { clearTimeout(t); } }
const T = [
  ["openprices-locations", "https://prices.openfoodfacts.org/api/v1/locations?osm_address_city=Strasbourg&size=50"],
  ["openprices-prices-city", "https://prices.openfoodfacts.org/api/v1/prices?location__osm_address_city=Strasbourg&size=20&order_by=-date"],
  ["openprices-stats", "https://prices.openfoodfacts.org/api/v1/prices?size=1&location__osm_address_postcode=67000"],
  ["carrefour-search", "https://www.carrefour.fr/s?q=blanc+de+poulet"],
  ["auchan-search", "https://www.auchan.fr/recherche?text=blanc+de+poulet"],
  ["intermarche-search", "https://www.intermarche.com/recherche/blanc%20de%20poulet"],
  ["leclercdrive-home", "https://www.leclercdrive.fr/"],
  ["eleclerc-search", "https://www.e.leclerc/recherche?q=blanc+de+poulet"],
  ["lidl-api", "https://www.lidl.fr/q/api/search?assortment=FR&locale=fr_FR&version=v2.0.0&q=poulet"],
  ["aldi-search", "https://www.aldi.fr/recherche.html?query=poulet"],
  ["monoprix-search", "https://courses.monoprix.fr/categories?q=poulet"],
  ["coursesu-search", "https://www.coursesu.com/recherche?q=poulet"],
  ["qelmc-home", "https://www.quiestlemoinscher.com/"],
  ["qelmc-search", "https://www.quiestlemoinscher.com/recherche?q=blanc%20de%20poulet"],
  ["grandfrais", "https://www.grandfrais.com/"],
];
for (const [k, u] of T) { const r = await get(u, { json: /api/.test(u) });
  const t = r.t || ""; const prices = (t.match(/\d+[,.]\d{2}\s?(€|&euro;|\\u20ac)/g) || []).length; const bot = /datadome|captcha|cf-chl|challenge-platform|access denied|Request unsuccessful|Incapsula|px-captcha|perimeterx/i.test(t);
  say(`${k} ${r.s} ${t.length}o prix=${prices} antibot=${bot} ${r.e || ""} ${r.u && r.u !== u ? "→ " + r.u.slice(0, 90) : ""}`);
  say("   " + t.replace(/\s+/g, " ").slice(0, 260));
}
import fs from "node:fs"; fs.writeFileSync("report.txt", out.join("\n") + "\n");
