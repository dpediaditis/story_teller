#!/usr/bin/env python3
"""Is gemini-3.1-flash-lite reliably healthy? 10 attempts, image input."""
import base64, json, pathlib, sys, time, urllib.request, urllib.error
key = next((l.split("=",1)[1].strip() for l in pathlib.Path(".env").read_text().splitlines()
            if l.strip().startswith("GEMINI_API_KEY=") and len(l.strip()) > 15), None)
if not key: sys.exit("no key")
img = base64.b64encode(pathlib.Path("/tmp/pc-drawing.png").read_bytes()).decode()

def call(model, schema=False):
    parts = [{"text":"Describe this drawing in one sentence."},
             {"inlineData":{"mimeType":"image/png","data":img}}]
    body = {"contents":[{"role":"user","parts":parts}]}
    if schema:
        body["generationConfig"] = {"responseMimeType":"application/json",
            "responseSchema":{"type":"object","properties":{"verdict":{"type":"string"}},
                              "required":["verdict"]}}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    t=time.time()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            json.load(r); return True, f"{time.time()-t:.1f}s"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, f"{type(e).__name__} {time.time()-t:.0f}s"

for model in ["gemini-3.1-flash-lite", "gemini-3.5-flash"]:
    wins=0
    print(f"\n{model} — 10 attempts (60s timeout):", flush=True)
    for i in range(10):
        ok,d = call(model); wins+=ok
        print(f"   {i+1:2}/10  {'OK  ' if ok else 'FAIL'} {d}", flush=True)
        time.sleep(1)
    print(f"   => {wins}/10", flush=True)

print("\ngemini-3.1-flash-lite with responseSchema (what gate 1 sends):", flush=True)
w=0
for i in range(5):
    ok,d = call("gemini-3.1-flash-lite", schema=True); w+=ok
    print(f"   {i+1}/5  {'OK  ' if ok else 'FAIL'} {d}", flush=True)
print(f"   => {w}/5", flush=True)
