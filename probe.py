#!/usr/bin/env python3
"""Measure the real failure rate on image input, with full error bodies."""
import base64, json, pathlib, sys, time, urllib.request, urllib.error

key = next((l.split("=",1)[1].strip() for l in pathlib.Path(".env").read_text().splitlines()
            if l.strip().startswith("GEMINI_API_KEY=") and len(l.strip()) > 15), None)
if not key: sys.exit("no GEMINI_API_KEY in .env")

big = pathlib.Path("/tmp/pc-drawing.png").read_bytes()
# 1x1 white PNG — rules out anything about image size or content.
tiny = base64.b64decode(
 "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

def call(model, img_bytes, label):
    parts = [{"text": "What is in this image? One sentence."}]
    if img_bytes is not None:
        parts.append({"inlineData": {"mimeType": "image/png",
                                     "data": base64.b64encode(img_bytes).decode()}})
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=json.dumps({"contents": [{"role": "user", "parts": parts}]}).encode(),
        headers={"Content-Type": "application/json"})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            json.load(r)
            return True, f"OK in {time.time()-t:.1f}s"
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            msg = json.loads(body)["error"]["message"]
        except Exception:
            msg = body[:160]
        return False, f"HTTP {e.code}  {msg[:150]}"
    except Exception as e:
        return False, f"{type(e).__name__} after {time.time()-t:.1f}s"

print("A) same model, text only vs tiny image vs real image", flush=True)
for label, img in (("text only ", None), ("1x1 image ", tiny), ("real image", big)):
    ok, detail = call("gemini-3.7-flash", img, label)
    print(f"   {label}  {'OK  ' if ok else 'FAIL'}  {detail}", flush=True)

print("\nB) real image across models", flush=True)
for m in ["gemini-3.7-flash","gemini-3.6-flash","gemini-3.5-flash",
          "gemini-3.1-flash-lite","gemini-flash-latest","gemini-pro-latest"]:
    ok, detail = call(m, big, m)
    print(f"   {m:24} {'OK  ' if ok else 'FAIL'}  {detail}", flush=True)

print("\nC) failure rate — 8 attempts, gemini-3.7-flash, real image", flush=True)
wins = 0
for i in range(8):
    ok, detail = call("gemini-3.7-flash", big, "")
    wins += ok
    print(f"   {i+1}/8  {'OK' if ok else 'FAIL'}  {detail}", flush=True)
    time.sleep(2)
print(f"\n   success rate: {wins}/8", flush=True)
