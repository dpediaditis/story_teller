#!/usr/bin/env python3
import base64, json, pathlib, sys, urllib.request, urllib.error
key = next((l.split("=",1)[1].strip() for l in pathlib.Path(".env").read_text().splitlines()
            if l.strip().startswith("GEMINI_API_KEY=") and len(l.strip()) > 15), None)
print("key:", "found" if key else "MISSING", flush=True)
if not key: sys.exit(1)
img = base64.b64encode(pathlib.Path("/tmp/pc-drawing.png").read_bytes()).decode()
SCHEMA = {"type":"object","properties":{"verdict":{"type":"string"}},"required":["verdict"]}

def go(label, image, schema):
    parts = [{"text":"Classify this for child-safety. Reply with a verdict."}]
    if image: parts.append({"inlineData":{"mimeType":"image/png","data":img}})
    body = {"contents":[{"role":"user","parts":parts}]}
    if schema: body["generationConfig"] = {"responseMimeType":"application/json","responseSchema":SCHEMA}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:generateContent?key={key}",
        data=json.dumps(body).encode(), headers={"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            print(f"  OK    {label}", flush=True)
    except urllib.error.HTTPError as e:
        print(f"  FAIL  {label}  HTTP {e.code}", flush=True)
    except Exception as e:
        print(f"  FAIL  {label}  {type(e).__name__}", flush=True)

go("image only    ", True,  False)
go("schema only   ", False, True)
go("image + schema", True,  True)
