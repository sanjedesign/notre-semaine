import fs from "fs"; import { spawnSync } from "child_process";
let out = "";
const runs = [["cuisineaz", { SNACK_ONLY: "1", MAX_FETCH: "60" }], ["jdf", { SNACK_ONLY: "0", MAX_FETCH: "50" }]];
for (const [src, env] of runs) {
  const r = spawnSync("node", ["discover.mjs"], { env: { ...process.env, DRY_RUN: "1", SOURCES: src, ...env }, encoding: "utf8", timeout: 900000, maxBuffer: 50e6 });
  out += `\n######## ${src}\n` + (r.stdout || "").split("\n").filter((l) => !/^plan |^recherche /.test(l)).join("\n") + (r.stderr ? "\nERR " + r.stderr.slice(0, 2000) : "");
  fs.writeFileSync("report.txt", out);
}
fs.writeFileSync("report.txt", out + "\nFIN");
