import json, time, sys
out = open("report_tr.txt", "w")
def say(s): out.write(s + "\n"); out.flush(); print(s)
t0 = time.time()
try:
    import argostranslate.package, argostranslate.translate
    argostranslate.package.update_package_index()
    pk = [p for p in argostranslate.package.get_available_packages() if p.from_code == "en" and p.to_code == "fr"][0]
    argostranslate.package.install_from_path(pk.download())
    say(f"modèle prêt en {time.time()-t0:.0f} s")
except Exception as e:
    say("ERREUR installation " + repr(e)); sys.exit(0)
S = json.load(open("samples.json"))
t1 = time.time(); n = 0
for s in S[:8]:
    say(f"\n### {s['src']} | {s['t']} → {argostranslate.translate.translate(s['t'], 'en', 'fr')}")
    for l in s["ing"][:8]:
        n += 1; say(f"  - {l} → {argostranslate.translate.translate(l, 'en', 'fr')}")
    for l in s["st"][:3]:
        n += 1; say(f"  > {l[:200]}\n    → {argostranslate.translate.translate(l, 'en', 'fr')[:260]}")
say(f"\n{n} segments en {time.time()-t1:.0f} s")
