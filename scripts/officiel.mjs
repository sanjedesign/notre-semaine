// Données officielles pour Sano — lues une fois par mois sur GitHub Actions et rangées dans la branche « data ».
// Agribalyse (ADEME) : impact climat de chaque aliment (kg CO2e par kg), par l'API ouverte data.ademe.fr.
// Les noms d'aliments sont ceux de la table Ciqual (Anses), ce qui permet de relier les deux tables dans l'appli.
import fs from "node:fs";
import path from "node:path";

const OUT = process.env.OUT_DIR || "data/official";
const API = "https://data.ademe.fr/data-fair/api/v1";
const say = (s) => console.log(s);
async function getJ(url) { const r = await fetch(url, { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error(r.status + " " + url); return r.json(); }
const nrm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// 1. le jeu de données « Agribalyse … synthèse » le plus récent
const cat = await getJ(`${API}/datasets?q=agribalyse&size=100&select=id,title,updatedAt`);
const sets = (cat.results || []).filter((d) => /agribalyse/i.test(d.title) && /synth/i.test(nrm(d.title)));
say("jeux trouvés : " + sets.map((d) => `${d.id} « ${d.title} »`).join(" | "));
const ver = (d) => { const m = String(d.title).match(/(\d+)[.,](\d+)/); return m ? +m[1] * 100 + +m[2] : 0; };
sets.sort((a, b) => ver(b) - ver(a) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
const ds = sets[0]; if (!ds) throw new Error("jeu Agribalyse introuvable");
const meta = await getJ(`${API}/datasets/${ds.id}`);
const cols = (meta.schema || []).map((c) => ({ key: c.key, name: nrm(c["x-originalName"] || c.title || c.key) }));
say("colonnes : " + cols.map((c) => c.key).join(", "));
const find = (re, not) => (cols.find((c) => re.test(c.name) && !(not && not.test(c.name))) || {}).key;
const kName = find(/nom.*produit.*fran|nom.*fran/), kCode = find(/code.*ciqual/), kCo2 = find(/changement.*climatique/, /detail|biogenique|fossile|affectation|sols|usage/), kGrp = find(/groupe.*aliment/, /sous/), kScore = find(/score unique ef/);
say(`clés : nom=${kName} code=${kCode} co2=${kCo2} groupe=${kGrp} score=${kScore}`);
if (!kName || !kCo2) throw new Error("colonnes introuvables");
// 2. toutes les lignes
const sel = [kName, kCode, kCo2, kGrp, kScore].filter(Boolean).join(",");
let rows = [], url = `${API}/datasets/${ds.id}/lines?size=1000&select=${encodeURIComponent(sel)}`;
for (let i = 0; url && i < 20; i++) { const j = await getJ(url); rows.push(...(j.results || [])); url = j.next || null; }
say("lignes : " + rows.length);
const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : null; };
const f = rows.map((r) => [String(r[kName] || "").trim(), num(r[kCo2]), r[kCode] != null ? String(r[kCode]) : "", kScore ? num(r[kScore]) : null, kGrp ? String(r[kGrp] || "") : ""])
  .filter((x) => x[0] && x[1] != null).map((x) => [x[0], Math.round(x[1] * 1000) / 1000, x[2], x[3] != null ? Math.round(x[3] * 1000) / 1000 : null, x[4]]);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "agribalyse.json"), JSON.stringify({ v: 1, src: { name: "Agribalyse (ADEME)", id: ds.id, title: ds.title, url: `https://data.ademe.fr/datasets/${ds.id}` }, updated: new Date().toISOString(), cols: ["nom", "kgCO2e/kg", "ciqual", "score EF (mPt/kg)", "groupe"], f }));
say(`écrit : ${f.length} aliments`);
