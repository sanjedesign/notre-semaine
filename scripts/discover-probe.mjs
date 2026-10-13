// sonde : quels sites de recettes répondent depuis les serveurs de GitHub ?
import fs from "node:fs";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const urls=["https://www.hellofresh.fr/robots.txt","https://www.750g.com/robots.txt","https://www.quitoque.fr/robots.txt","https://jow.fr/robots.txt","https://www.marmiton.org/robots.txt","https://www.mangerbouger.fr/robots.txt","https://www.ricardocuisine.com/robots.txt","https://www.weightwatchers.com/robots.txt","https://www.hellofresh.fr/recipes/aiguillettes-de-poulet-facon-teriyaki-64d3b20ec6d2a3702a70fd91"];
let out=`sonde ${new Date().toISOString()}\n`;
for(const u of urls){try{const r=await fetch(u,{headers:{"User-Agent":UA,"Accept-Language":"fr-FR,fr;q=0.9"}});const t=await r.text();
 const sm=(t.match(/^sitemap:.*$/gim)||[]).slice(0,8).join(" | ");const ld=/application\/ld\+json/.test(t);
 out+=`${r.status} ${u} len=${t.length} ld=${ld} ${sm}\n`;if(/teriyaki/.test(u)){const m=t.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i);out+=(m?m[1].slice(0,1500):"no ld")+"\n"}}catch(e){out+=`ERR ${u} ${e.message}\n`}}
fs.mkdirSync("out",{recursive:true});fs.writeFileSync("out/probe.txt",out);console.log(out);
