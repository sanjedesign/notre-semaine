import { execFileSync } from "node:child_process";
import fs from "node:fs";
let out = "";
for (const [src, max] of [["julieandrieu,hervecuisine", "70"], ["jow,hellofresh,marmiton", "45"]]) {
  try { out += execFileSync("node", ["discover.mjs"], { env: { ...process.env, DRY_RUN: "1", SOURCES: src, MAX_FETCH: max }, encoding: "utf8", maxBuffer: 1 << 26, timeout: 900000 }); }
  catch (e) { out += "ERREUR " + String(e).slice(0, 300) + "\n" + (e.stdout || ""); }
}
fs.writeFileSync("report.txt", out.split("\n").filter((l) => /^(OK |gardées|par source|à lire|plan )/.test(l)).map((l) => l.slice(0, 700)).join("\n"));
