import fs from "fs"; import { spawnSync } from "child_process";
let out = "";
const runs = [["bbc,pinchofnom,skinnytaste", { MAX_FETCH: "40" }], ["jamieoliver,recipetineats,olive", { MAX_FETCH: "30" }]];
for (const [src, env] of runs) {
  const t0 = Date.now();
  const r = spawnSync("node", ["discover.mjs"], { env: { ...process.env, DRY_RUN: "1", SOURCES: src, SNACK_ONLY: "0", ...env }, encoding: "utf8", timeout: 1500000, maxBuffer: 50e6 });
  out += `\n######## ${src} (${Math.round((Date.now() - t0) / 1000)} s)\n` + (r.stdout || "").split("\n").filter((l) => !/^plan |^recherche /.test(l)).join("\n") + (r.stderr ? "\nERR " + r.stderr.slice(-3000) : "");
  fs.writeFileSync("report.txt", out);
}
fs.writeFileSync("report.txt", out + "\nFIN");
