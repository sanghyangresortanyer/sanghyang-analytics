"""Adds the Marketing settings to Vercel production (run it yourself: python scripts/marketing/vercel-env.py). Values go through stdin; nothing is printed."""
import json
import shutil
import subprocess
from pathlib import Path

V = Path(__file__).resolve().parents[2]
env = {}
for line in (V / ".env.local").read_text(encoding="utf8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"')

creds = json.loads((V / "config" / "marketing" / "google-oauth-client.json").read_text(encoding="utf8"))
values = {
    "MARKETING_PROPERTY_ID": env["MARKETING_PROPERTY_ID"],
    "GOOGLE_OAUTH_CLIENT_JSON": json.dumps(creds, separators=(",", ":")),
    "GOOGLE_ADS_REFRESH_TOKEN": env["GOOGLE_ADS_REFRESH_TOKEN"],
    "GOOGLE_ADS_CUSTOMER_ID": env["GOOGLE_ADS_CUSTOMER_ID"],
    "GA4_PROPERTY_ID": env["GA4_PROPERTY_ID"],
}
npx_bin = shutil.which("npx") or "npx"
for name, value in values.items():
    r = subprocess.run(
        [npx_bin, "vercel", "env", "add", name, "production"],
        input=value, text=True, capture_output=True, cwd=V, timeout=180,
    )
    ok = r.returncode == 0
    print(f"{name}: {'ditambahkan' if ok else 'GAGAL'}")
    if not ok:
        # Show only Vercel's own message lines, never the value.
        print("  ", " ".join(l for l in (r.stdout + r.stderr).splitlines() if "Error" in l or "already" in l)[:200])
