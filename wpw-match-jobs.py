#!/usr/bin/env python3
"""
WPW Job Matcher — pairs before/after photos by GPS location + timestamp.
Groups photos from the same physical location (same job) and uses
Haiku vision to confirm before/after order when needed.

Input:  Photos Library DB + organized photos from wpw-organize-photos.py
Output: ~/Desktop/WPW-Jobs/ with one subfolder per job containing
        matched before/after pairs and a job summary.
"""

import sqlite3
import shutil
import os
import json
import base64
import math
import csv
import time
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
import urllib.request

# ─── CONFIG ──────────────────────────────────────────────────────────────────
PHOTOS_LIBRARY = os.path.expanduser("~/Pictures/Photos Library.photoslibrary")
ORIGINALS_DIR  = os.path.join(PHOTOS_LIBRARY, "originals")
CLOUD_DIR      = os.path.join(PHOTOS_LIBRARY, "scopes", "cloudsharing", "data")
DB_COPY        = "/tmp/photos_query.sqlite"

OUTPUT_DIR     = os.path.expanduser("~/Desktop/WPW-Jobs")
MANIFEST_PATH  = os.path.join(OUTPUT_DIR, "jobs-manifest.csv")

ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")

TARGET_ALBUMS = [
    "Content", "Cement ,Brick & Wood", "Gutters",
    "GoPack2025", "Houses", "Service", "More Service 2024",
]

# Jobs: cluster photos within this radius (meters) = same property
JOB_RADIUS_METERS = 80

# Max time gap between before/after on same job (seconds): 8 hours
MAX_JOB_GAP_SECS = 8 * 3600

APPLE_EPOCH = 978307200

# ─── HELPERS ─────────────────────────────────────────────────────────────────

def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

def apple_ts(ts):
    if not ts:
        return None
    try:
        return float(ts) + APPLE_EPOCH
    except:
        return None

def find_file(directory, filename):
    first = filename[0].upper()
    candidates = [
        os.path.join(ORIGINALS_DIR, first, filename),
        os.path.join(ORIGINALS_DIR, first.lower(), filename),
        os.path.join(CLOUD_DIR, directory, filename),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None

def confirm_order_with_haiku(path_a, path_b):
    """Ask Haiku: which of these two photos is the BEFORE (dirty) shot?
    Returns 'a' (first is before), 'b' (second is before), or 'unknown'."""
    if not ANTHROPIC_KEY:
        return "unknown"

    def load_img(path):
        ext = Path(path).suffix.lower()
        mime_map = {'.jpg':'image/jpeg', '.jpeg':'image/jpeg',
                    '.heic':'image/jpeg', '.png':'image/png', '.webp':'image/webp'}
        mime = mime_map.get(ext, 'image/jpeg')
        with open(path, 'rb') as f:
            return base64.standard_b64encode(f.read()).decode('utf-8'), mime

    try:
        data_a, mime_a = load_img(path_a)
        data_b, mime_b = load_img(path_b)
    except:
        return "unknown"

    payload = json.dumps({
        "model": "claude-haiku-4-5",
        "max_tokens": 10,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "I'm going to show you two photos from a pressure washing job. Which one is the BEFORE (dirty/before cleaning) shot? Reply with only 'A' or 'B'."},
                {"type": "image", "source": {"type": "base64", "media_type": mime_a, "data": data_a}},
                {"type": "text", "text": "Photo A"},
                {"type": "image", "source": {"type": "base64", "media_type": mime_b, "data": data_b}},
                {"type": "text", "text": "Photo B — which is BEFORE (dirtier)?"},
            ]
        }]
    }).encode('utf-8')

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=payload,
        headers={
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read())
            ans = result.get("content", [{}])[0].get("text", "").strip().upper()
            if "A" in ans and "B" not in ans:
                return "a"
            elif "B" in ans and "A" not in ans:
                return "b"
            return "unknown"
    except:
        return "unknown"

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    print("🐺 WPW Job Matcher — grouping by GPS + time\n")

    # Load all photos with GPS from target albums
    print("📍 Loading photos with GPS coordinates...")
    conn = sqlite3.connect(DB_COPY)
    cur = conn.cursor()

    placeholders = ",".join("?" * len(TARGET_ALBUMS))
    cur.execute(f"""
        SELECT
            alb.ZTITLE as album,
            asset.ZDIRECTORY,
            asset.ZFILENAME,
            asset.ZDATECREATED,
            asset.ZLATITUDE,
            asset.ZLONGITUDE,
            asset.ZKIND,
            asset.Z_PK
        FROM ZGENERICALBUM alb
        JOIN Z_28ASSETS r ON r.Z_28ALBUMS = alb.Z_PK
        JOIN ZASSET asset ON asset.Z_PK = r.Z_3ASSETS
        WHERE alb.ZTITLE IN ({placeholders})
        AND asset.ZLATITUDE IS NOT NULL
        AND asset.ZLATITUDE != 0
        AND asset.ZLONGITUDE IS NOT NULL
        ORDER BY asset.ZDATECREATED
    """, TARGET_ALBUMS)

    rows = cur.fetchall()
    conn.close()
    print(f"✅ {len(rows)} photos with GPS\n")

    # Find files on disk
    photos = []
    for album, directory, filename, date_ts, lat, lon, kind, pk in rows:
        path = find_file(directory, filename)
        if not path:
            continue
        ts = apple_ts(date_ts)
        is_video = filename.upper().endswith(('.MP4', '.MOV', '.M4V'))
        photos.append({
            "album": album,
            "filename": filename,
            "path": path,
            "ts": ts,
            "lat": float(lat),
            "lon": float(lon),
            "is_video": is_video,
            "pk": pk,
        })

    print(f"📁 {len(photos)} files located on disk\n")

    # ─── Cluster by GPS location ──────────────────────────────────────────
    print("🗺️  Clustering by location (same property = within 80m)...")
    jobs = []         # list of lists of photos
    assigned = [False] * len(photos)

    # Sort by timestamp first
    photos.sort(key=lambda p: p["ts"] or 0)

    for i, photo in enumerate(photos):
        if assigned[i]:
            continue
        job = [photo]
        assigned[i] = True
        for j, other in enumerate(photos[i+1:], i+1):
            if assigned[j]:
                continue
            dist = haversine_meters(photo["lat"], photo["lon"], other["lat"], other["lon"])
            if dist <= JOB_RADIUS_METERS:
                job.append(other)
                assigned[j] = True
        jobs.append(job)

    print(f"✅ Found {len(jobs)} unique job locations\n")

    # Filter to jobs with 2+ photos (potential before/after)
    multi_jobs = [j for j in jobs if len(j) >= 2]
    print(f"📸 {len(multi_jobs)} jobs with multiple photos (potential before/after pairs)\n")

    # ─── Process each job ─────────────────────────────────────────────────
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    manifest_rows = []
    jobs_with_ba = 0

    for job_idx, job_photos in enumerate(multi_jobs[:200]):  # cap at 200 jobs
        # Sort by timestamp within job
        job_photos.sort(key=lambda p: p["ts"] or 0)

        first = job_photos[0]
        last = job_photos[-1]
        time_span = (last["ts"] or 0) - (first["ts"] or 0)

        # Skip if all photos from same minute (burst shots, not before/after)
        if time_span < 60:
            continue

        # Date for folder naming
        dt = datetime.fromtimestamp(first["ts"] or 0, tz=timezone.utc)
        date_str = dt.strftime("%Y-%m-%d")
        lat_str = f"{first['lat']:.4f}_{first['lon']:.4f}".replace("-", "m")
        job_name = f"job-{date_str}-{lat_str}"

        job_dir = os.path.join(OUTPUT_DIR, "by-job", job_name)
        before_dir = os.path.join(job_dir, "before")
        after_dir  = os.path.join(job_dir, "after")
        all_dir    = os.path.join(job_dir, "all")
        os.makedirs(before_dir, exist_ok=True)
        os.makedirs(after_dir, exist_ok=True)
        os.makedirs(all_dir, exist_ok=True)

        # Strategy: first 30% of photos = before, last 30% = after
        # (middle photos = during cleaning)
        n = len(job_photos)
        cutoff_before = max(1, n // 3)
        cutoff_after  = max(n - n // 3, n - 1)

        potential_before = [p for p in job_photos[:cutoff_before] if not p["is_video"]]
        potential_after  = [p for p in job_photos[cutoff_after:] if not p["is_video"]]

        # If we have at least one before and one after candidate, confirm with Haiku
        confirmed_before = []
        confirmed_after  = []

        if potential_before and potential_after and ANTHROPIC_KEY:
            # Sample 1 from each end to confirm order
            sample_b = potential_before[0]
            sample_a = potential_after[-1]
            order = confirm_order_with_haiku(sample_b["path"], sample_a["path"])
            time.sleep(0.2)

            if order == "a" or order == "unknown":
                # First photo is before (expected — time order)
                confirmed_before = potential_before
                confirmed_after  = potential_after
            else:
                # Reversed — later photos are actually the before shots
                confirmed_before = potential_after
                confirmed_after  = potential_before
        else:
            # No API — use time order (first = before, last = after)
            confirmed_before = potential_before
            confirmed_after  = potential_after

        if not confirmed_before or not confirmed_after:
            continue

        jobs_with_ba += 1

        # Copy files
        for photo in confirmed_before:
            dest = os.path.join(before_dir, photo["filename"])
            if not os.path.exists(dest):
                shutil.copy2(photo["path"], dest)
            manifest_rows.append({
                "job": job_name,
                "role": "before",
                "filename": photo["filename"],
                "date": date_str,
                "lat": photo["lat"],
                "lon": photo["lon"],
                "album": photo["album"],
                "src": photo["path"],
            })

        for photo in confirmed_after:
            dest = os.path.join(after_dir, photo["filename"])
            if not os.path.exists(dest):
                shutil.copy2(photo["path"], dest)
            manifest_rows.append({
                "job": job_name,
                "role": "after",
                "filename": photo["filename"],
                "date": date_str,
                "lat": photo["lat"],
                "lon": photo["lon"],
                "album": photo["album"],
                "src": photo["path"],
            })

        # Copy all photos to /all/
        for photo in job_photos:
            dest = os.path.join(all_dir, photo["filename"])
            if not os.path.exists(dest):
                shutil.copy2(photo["path"], dest)

        # Write job summary
        with open(os.path.join(job_dir, "summary.txt"), "w") as f:
            f.write(f"Job: {job_name}\n")
            f.write(f"Date: {date_str}\n")
            f.write(f"Location: {first['lat']:.4f}, {first['lon']:.4f}\n")
            f.write(f"Total photos: {n}\n")
            f.write(f"Before shots: {len(confirmed_before)}\n")
            f.write(f"After shots: {len(confirmed_after)}\n")
            f.write(f"Time span: {int(time_span/60)} minutes\n")
            f.write(f"Albums: {set(p['album'] for p in job_photos)}\n")

        if job_idx % 10 == 0:
            print(f"  [{job_idx+1}/{len(multi_jobs)}] {job_name} → {len(confirmed_before)} before, {len(confirmed_after)} after")

    # Write manifest
    if manifest_rows:
        with open(MANIFEST_PATH, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=manifest_rows[0].keys())
            writer.writeheader()
            writer.writerows(manifest_rows)

    print(f"\n✅ DONE!")
    print(f"   Jobs with before/after pairs: {jobs_with_ba}")
    print(f"   Output: {OUTPUT_DIR}/by-job/")
    print(f"   Manifest: {MANIFEST_PATH}")
    print(f"\n   Each job folder contains:")
    print(f"     before/  → dirty shots")
    print(f"     after/   → clean results")
    print(f"     all/     → every photo from that visit")
    print(f"     summary.txt → date, location, photo counts")

if __name__ == "__main__":
    main()
