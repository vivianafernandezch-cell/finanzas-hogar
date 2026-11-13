#!/bin/sh
# Pega en config.js la llave "anon public" que copiaste de Supabase (no la muestra en pantalla).
cd "$(dirname "$0")"
pbpaste | python3 -c '
import sys, re, json, base64
k = re.sub(r"\s", "", sys.stdin.read())
try:
    p = k.split(".")[1]; p += "=" * (-len(p) % 4)
    role = json.loads(base64.urlsafe_b64decode(p)).get("role")
except Exception:
    role = None
if role != "anon":
    sys.exit("⛔ Lo que copiaste no es la llave anon public (rol: %s). No guardé nada." % role)
s = open("config.js").read()
s = re.sub(r"supabaseAnonKey: \x27[^\x27]*\x27", "supabaseAnonKey: \x27" + k + "\x27", s)
open("config.js", "w").write(s)
print("✅ Llave anon guardada en config.js")
'
