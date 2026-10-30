// Sano — fonctionnement hors ligne (au magasin, sans réseau)
// Page : le réseau d'abord (toujours la dernière version), la copie gardée si le réseau ne répond pas en 4 s.
// Fichiers du site : la copie gardée tout de suite, mise à jour en arrière-plan. Polices Google : gardées.
// Les données (synchro, recettes à découvrir, produits) ne passent pas par ici : l'appli gère déjà leur absence.
const C = "sano-v2";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(["./", "./index.html"])).catch(() => {})); });
self.addEventListener("activate", (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== C) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url), same = u.origin === self.location.origin;
  if (r.mode === "navigate" || (same && /\/(index\.html)?$/.test(u.pathname))) { e.respondWith(page(r)); return; }
  if (same) { if (/version\.json$/.test(u.pathname)) return; e.respondWith(fresh(r)); return; }
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) e.respondWith(kept(r));
});
async function page(r) {
  const c = await caches.open(C);
  try { const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000); const res = await fetch(r, { signal: ac.signal }); clearTimeout(t);
    if (res.ok) c.put("./index.html", res.clone()); return res; }
  catch (e) { return (await c.match("./index.html")) || (await c.match("./")) || Response.error(); }
}
async function fresh(r) {
  const c = await caches.open(C), hit = await c.match(r);
  const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}
async function kept(r) {
  const c = await caches.open(C), hit = await c.match(r); if (hit) return hit;
  try { const res = await fetch(r); if (res.ok || res.type === "opaque") c.put(r, res.clone()); return res; } catch (e) { return Response.error(); }
}
