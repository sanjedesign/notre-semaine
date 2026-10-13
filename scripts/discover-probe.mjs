// sonde 2 : plans de site et fiches recettes (JSON-LD) de chaque source
import fs from "node:fs";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const get=async u=>{const r=await fetch(u,{headers:{"User-Agent":UA,"Accept-Language":"fr-FR,fr;q=0.9"}});return{status:r.status,text:await r.text()}};
const locs=x=>[...x.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m=>m[1].replace(/&amp;/g,"&"));
function findRecipe(n){if(!n||typeof n!=="object")return null;if(Array.isArray(n)){for(const x of n){const r=findRecipe(x);if(r)return r}return null}
 const t=n["@type"];if(t==="Recipe"||(Array.isArray(t)&&t.includes("Recipe")))return n;return findRecipe(n["@graph"])||findRecipe(n.mainEntity)||null}
function ld(h){const re=/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;let m;while((m=re.exec(h))){try{const r=findRecipe(JSON.parse(m[1].trim()));if(r)return r}catch(e){}}return null}
let out=`sonde2 ${new Date().toISOString()}\n`;
const S=[["hellofresh","https://www.hellofresh.fr/sitemap_recipe_pages.xml",/\/recipes\/[a-z0-9-]+-[0-9a-f]{24}$/],
 ["quitoque","https://www.quitoque.fr/sitemap_index.xml",/\/recette\//],["jow","https://jow.fr/sitemap-index.xml",/\/recipes\//],
 ["marmiton","https://www.marmiton.org/wsitemap_recipes_index.xml",/\/recettes\/recette_/],["ricardo","https://www.ricardocuisine.com/sitemap.xml",/\/recettes\/\d+/],
 ["750g","https://www.750g.com/sitemap.xml",/-r\d+\.htm$/],["ww-ca-fr","https://www.weightwatchers.com/ca/fr/sitemap.xml",/\/recette\//]];
for(const[name,sm,re]of S){try{let r=await get(sm);out+=`\n## ${name} ${r.status} ${sm} len=${r.text.length}\n`;let L=locs(r.text);out+=`  locs ${L.length}: ${L.slice(0,6).join(" ")}\n`;
 let rec=L.filter(u=>re.test(u));
 if(!rec.length){const subs=L.filter(u=>/xml/.test(u)&&/recip|recet|recette/i.test(u)).slice(0,3);const subs2=subs.length?subs:L.filter(u=>/xml/.test(u)).slice(0,2);
  for(const s of subs2){const r2=await get(s);const L2=locs(r2.text);out+=`  sub ${r2.status} ${s} locs ${L2.length}: ${L2.slice(0,3).join(" ")}\n`;rec.push(...L2.filter(u=>re.test(u)))}}
 out+=`  recettes trouvées ${rec.length}\n`;
 for(const u of rec.slice(-2)){const p=await get(u);const R=ld(p.text);out+=`  ${p.status} ${u}\n`;
  if(R){const n=R.nutrition||{};out+=`   name=${R.name} yield=${JSON.stringify(R.recipeYield)} time=${R.totalTime} img=${JSON.stringify(R.image).slice(0,160)}\n   ing(${(R.recipeIngredient||[]).length})=${JSON.stringify((R.recipeIngredient||[]).slice(0,6))}\n   nut=${JSON.stringify(n).slice(0,300)}\n   author=${JSON.stringify(R.author).slice(0,120)} rating=${JSON.stringify(R.aggregateRating||null).slice(0,120)} video=${JSON.stringify(R.video||null).slice(0,160)} cat=${JSON.stringify(R.recipeCategory||null)} kw=${String(R.keywords||"").slice(0,120)}\n`}
  else out+=`   pas de JSON-LD Recipe (len ${p.text.length})\n`}}catch(e){out+=`ERR ${name} ${e.message}\n`}}
fs.mkdirSync("out",{recursive:true});fs.writeFileSync("out/probe.txt",out);console.log(out);
