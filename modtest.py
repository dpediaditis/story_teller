#!/usr/bin/env python3
"""Isolate which part of the moderation call Gemini is rejecting.
Reads GEMINI_API_KEY from .env directly — no shell sourcing involved."""
import base64, json, os, sys, urllib.request, urllib.error, pathlib

key = None
for line in pathlib.Path(".env").read_text().splitlines():
    line = line.strip()
    if line.startswith("GEMINI_API_KEY=") and len(line) > 15:
        key = line.split("=", 1)[1].strip()
if not key:
    sys.exit("GEMINI_API_KEY not found in .env")
print(f"key loaded ({len(key)} chars)\n")

png = pathlib.Path("/tmp/pc-drawing.png")
if not png.exists():
    sys.exit("/tmp/pc-drawing.png missing — run ./go.sh once to create it")
img = base64.b64encode(png.read_bytes()).decode()

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "flag", "block"]},
        "categories": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "categories"],
}

def call(model, image, schema, label):
    parts = [{"text": "Classify this for child-safety."}]
    if image:
        parts.append({"inlineData": {"mimeType": "image/png", "data": img}})
    body = {"contents": [{"role": "user", "parts": parts}]}
    if schema:
        body["generationConfig"] = {
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            "temperature": 0,
        }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.load(r)
            out = d["candidates"][0]["content"]["parts"][0]["text"][:55].replace("\n", " ")
            print(f"  OK    {model:24} {label:18} -> {out}")
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:80].replace("\n", " ")
        print(f"  FAIL  {model:24} {label:18} HTTP {e.code}  {msg}")
    except Exception as e:
        print(f"  FAIL  {model:24} {label:18} {type(e).__name__}: {e}")

for m in ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.6-flash"]:
    call(m, True,  False, "image only")
    call(m, False, True,  "schema only")
    call(m, True,  True,  "image + schema")
    print()
