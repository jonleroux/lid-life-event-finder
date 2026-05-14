#!/usr/bin/env python3
"""
Lid Life Event Finder — update_app.py
--------------------------------------
Converts the master CSV from Desktop into events.json,
then deploys to Netlify and pushes to GitHub.

Usage (from Terminal):
    cd "/Users/jonathanleroux/Claude Code/biketorque-event-finder-v2"
    python3 update_app.py
"""

import csv, json, os, subprocess
from datetime import datetime
from glob import glob

# ── Config ────────────────────────────────────────────────────────────────────
CSV_FOLDER = os.path.expanduser("~/Desktop/Lid Life/Event Finder App")
OUT_FILE   = os.path.join(os.path.dirname(__file__), "events.json")

TYPE_MAP = {
    "race meets":                  "Race Meets",
    "bike track days":             "Track Days",
    "motorcycle shows and events": "Shows & Events",
    "bike meets":                  "Bike Meets",
    "motorcycle ride outs":        "Ride Outs",
    "motorcycle rider training":   "Rider Training",
    "rider training":              "Rider Training",
}

MON      = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
MON_IDX  = {m: i for i, m in enumerate(MON)}

# ── Helpers ───────────────────────────────────────────────────────────────────
def parse_date(s):
    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            dt = datetime.strptime(s.strip(), fmt)
            return "%02d-%s-%02d" % (dt.day, MON[dt.month - 1], dt.year % 100)
        except ValueError:
            pass
    return None

def sort_key(d):
    try:
        day, mon, yr = d.split("-")
        return (int(yr), MON_IDX[mon], int(day))
    except Exception:
        return (99, 99, 99)

def find_csv():
    """Find the most recently modified CSV in the Desktop folder."""
    pattern = os.path.join(CSV_FOLDER, "*.csv")
    files   = glob(pattern)
    if not files:
        raise FileNotFoundError(f"No CSV found in {CSV_FOLDER}")
    return max(files, key=os.path.getmtime)

def run(cmd, cwd=None):
    result = subprocess.run(cmd, shell=True, cwd=cwd or os.path.dirname(__file__),
                            capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.stderr.strip():
        print(result.stderr.strip())
    return result.returncode

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    # 1. Find CSV
    csv_path = find_csv()
    print(f"📄  Reading: {os.path.basename(csv_path)}")

    # 2. Parse
    events, seen = [], set()
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            title   = (row.get("Event Name")          or "").strip()
            desc    = (row.get("Description")          or "").strip()
            start   = (row.get("Start Date and Time")  or "").strip()
            etype   = (row.get("Event Type Name")      or "").strip().lower()
            venue   = (row.get("Venue Name")            or "").strip()
            address = (row.get("Venue Address")         or "").strip()
            link    = (row.get("Button Link")           or "").strip()

            if not title or not start:
                continue
            d = parse_date(start)
            if not d:
                continue

            ty  = TYPE_MAP.get(etype, "Shows & Events")
            loc = venue
            if address and address != venue:
                loc = (address if not venue else venue + ", " + address)

            key = d + "|" + title + "|" + loc
            if key in seen:
                continue
            seen.add(key)

            ev = {"d": d, "t": title, "ty": ty, "loc": loc}
            if desc: ev["desc"] = desc
            if link: ev["link"] = link
            events.append(ev)

    events.sort(key=lambda e: sort_key(e["d"]))
    print(f"✅  {len(events)} events parsed")

    # 3. Write events.json
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(events, f, ensure_ascii=False, indent=2)
    print(f"💾  events.json updated")

    # 4. Deploy to Netlify
    print("🚀  Deploying to Netlify…")
    code = run("netlify deploy --prod --dir . --no-build")
    if code != 0:
        print("⚠️   Netlify deploy failed — check your netlify login")

    # 5. Push to GitHub
    print("📤  Pushing to GitHub…")
    run('git add events.json')
    run(f'git commit -m "Update events.json from {os.path.basename(csv_path)}"')
    run('git push')
    print("✅  Done!")

if __name__ == "__main__":
    main()
