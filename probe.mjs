import { execFileSync } from "node:child_process";
import fs from "node:fs";
let out = "";
for (const [src, max] of [["marmiton", "60"], ["julieandrieu,hervecuisine,fourchette,jow", "50"]]) {
  try { out += execFileSync("node", ["discover.mjs"], { env: { ...process.env, DRY_RUN: "1", SNACK_ONLY: "1", SOURCES: src, MAX_FETCH: max }, encoding: "utf8", maxBuffer: 1 << 26, timeout: 900000 }); }
  catch (e) { out += "ERREUR " + String(e).slice(0, 300) + "\n" + (e.stdout || ""); }
}
fs.writeFileSync("report.txt", out.split("\n").filter((l) => /^(OK |gardées|par source|à lire|recherche )/.test(l)).map((l) => l.startsWith("OK ") ? (() => { try { const o = JSON.parse(l.slice(3)); return `OK ${o.src} | ${o.t} | ${JSON.stringify(o.n || "-")} | sv=${o.sv || 0} | ${o.ing.slice(0, 4).join(" ; ")}`; } catch { return l.slice(0, 300); } })() : l.slice(0, 600)).join("\n"));
