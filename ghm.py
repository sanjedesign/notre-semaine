import json, os, urllib.request, urllib.error
tok = os.environ.get("GITHUB_TOKEN", "")
out = open("report.txt", "w")
def say(s): out.write(s + "\n"); out.flush(); print(s)
say(f"jeton : {len(tok)} caractères")
for url in ["https://models.github.ai/inference/chat/completions", "https://models.inference.ai.azure.com/chat/completions"]:
    for mo in ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "gpt-4o-mini"]:
        for rf in [True, False]:
            body = {"model": mo, "temperature": 0.2, "messages": [{"role": "system", "content": "Réponds en JSON."}, {"role": "user", "content": 'Traduis en français : {"title": "One-pot chicken curry & rice"}. Réponds {"title": "..."}'}]}
            if rf: body["response_format"] = {"type": "json_object"}
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer " + tok, "Accept": "application/json", "X-GitHub-Api-Version": "2022-11-28"})
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    raw = r.read().decode(errors="replace")
                    say(f"{url[8:40]} {mo} rf={rf} → {r.status} {r.headers.get('content-type')} | {raw[:400]!r}")
                    rl = {k: v for k, v in r.headers.items() if "ratelimit" in k.lower()}
                    if rl: say("   " + json.dumps(rl))
            except urllib.error.HTTPError as e:
                say(f"{url[8:40]} {mo} rf={rf} → HTTP {e.code} | {e.read().decode(errors='replace')[:300]!r}")
            except Exception as e:
                say(f"{url[8:40]} {mo} rf={rf} → {e!r}")
