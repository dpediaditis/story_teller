#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
set -a; . ./.env; set +a
python3 - <<'PY'
import base64, json, os, urllib.request, urllib.error
key = os.environ["GEMINI_API_KEY"]
img = base64.b64encode(open("/tmp/pc-drawing.png","rb").read()).decode()

SCHEMA = {"type":"object","properties":{
    "verdict":{"type":"string","enum":["pass","flag","block"]},
    "categories":{"type":"array","items":{"type":"string"}}},
  "required":["verdict","categories"]}

def call(model, *, image, schema, label):
    parts = [{"text":"Classify this for child-safety."}]
    if image: parts.append({"inlineData":{"mimeType":"image/png","data":img}})
    body = {"contents":[{"role":"user","parts":parts}]}
    if schema:
        body["generationConfig"] = {"responseMimeType":"application/json",
                                    "responseSchema":SCHEMA,"temperature":0}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.load(r)
            out = d["candidates"][0]["content"]["parts"][0]["text"][:60].replace("\n"," ")
            print(f"  OK    {model:24} {label:22} -> {out}")
            return True
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:90].replace("\n"," ")
        print(f"  FAIL  {model:24} {label:22} HTTP {e.code}  {msg}")
    except Exception as e:
        print(f"  FAIL  {model:24} {label:22} {type(e).__name__}")
    return False

print("Isolating which part of the moderation call is failing:\n")
for m in ["gemini-3.7-flash","gemini-3.5-flash","gemini-3.1-flash-lite","gemini-3.6-flash"]:
    call(m, image=True,  schema=False, label="image only")
    call(m, image=False, schema=True,  label="schema only")
    call(m, image=True,  schema=True,  label="image + schema")
    print()
PY
