#!/usr/bin/env python3
"""
WPW Photo Organizer — powered by Claude Haiku vision
Reads Photos.sqlite, classifies each image with Haiku, copies to organized folders.
SAFE: copies only, never moves or deletes originals.
"""

import sqlite3
import shutil
import os
import json
import base64
import time
import csv
from pathlib import Path
from datetime import datetime, timezone
import urllib.request
import urllib.error

# ─── CONFIG ──────────────────────────────────────────────────────────────────
PHOTOS_LIBRARY = os.path.expanduser("~/Pictures/Photos Library.photoslibrary")
ORIGINALS_DIR  = os.path.join(PHOTOS_LIBRARY, "originals")
DB_PATH        = os.path.join(PHOTOS_LIBRARY, "database", "Photos.sqlite")
DB_COPY        = "/tmp/wpw_photos_query.sqlite"

OUTPUT_DIR     = os.path.expanduser("~/Desktop/WPW-Organized")
MANIFEST_PATH  = os.path.join(OUTPUT_DIR, "manifest.csv")

ANTHROPIC_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")

# Albums to process — edit this list to add/remove
TARGET_ALBUMS = [
    "Content",
    "Cement ,Brick & Wood",
    "Gutters",
    "GoPack2025",
    "Houses",
    "Service",
    "More Service 2024",
    "No Typo vid",
    "RADCLOFPV",
]

# Service categories Haiku will choose from
CATEGORIES = [
    "house-wash",
    "driveway",
    "deck-patio",
    "roof",
    "gutter",
    "fence",
    "commercial",
    "before",
    "after",
    "before-after-split",
    "team-equipment",
    "video",
    "other",
]

# Apple epoch offset (Jan 1 2001)
APPLE_EPOCH = 978307200

# ─── HELPERS ─────────────────────────────────────────────────────────────────

def apple_ts_to_date(ts):
    if not ts:
        return "unknown"
    try:
        dt = datetime.fromtimestamp(float(ts) + APPLE_EPOCH, tz=timezone.utc)
        return dt.strftime("%Y-%m")
    except:
        return "unknown"

def classify_with_haiku(image_path):
    """Send image to Claude Haiku for classification. Returns category string."""
    if not ANTHROPIC_KEY:
        return "unclassified"
    
    ext = Path(image_path).suffix.lower()
    if ext in ('.mp4', '.mov', '.m4v', '.avi'):
        return "video"
    
    mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', 
                '.png': 'image/png', '.heic': 'image/jpeg',
                '.webp': 'image/webp'}
    mime = mime_map.get(ext, 'image/jpeg')
    
    try:
        with open(image_path, 'rb') as f:
            img_data = base64.standard_b64encode(f.read()).decode('utf-8')
    except Exception as e:
        print(f"  ! Could not read {image_path}: {e}")
        return "unclassified"
    
    prompt = f"""Look at this photo from a pressure washing / exterior home cleaning business.
Classify it as ONE of these categories (reply with ONLY the category name, nothing else):
{chr(10).join(CATEGORIES)}

Rules:
- house-wash: full house exterior being washed or after shot
- driveway: driveway or parking area cleaning
- deck-patio: deck, patio, or outdoor living space
- roof: roof soft wash
- gutter: gutters or downspouts
- fence: fence or gate cleaning  
- commercial: commercial property or large building
- before: clearly a dirty/before shot
- after: clearly a clean/after result shot
- before-after-split: side-by-side comparison or split image
- team-equipment: crew, truck, equipment, branding
- video: if it's a video file
- other: anything else (people, interior, unrelated)"""

    payload = json.dumps({
        "model": "claude-haiku-4-5",
        "max_tokens": 20,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": img_data}},
                {"type": "text", "text": prompt}
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
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            raw = result.get("content", [{}])[0].get("text", "").strip().lower()
            # Match to known categories
            for cat in CATEGORIES:
                if cat in raw:
                    return cat
            return "other"
    except Exception as e:
        print(f"  ! Haiku API error: {e}")
        return "unclassified"

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    print("🐺 WPW Photo Organizer — powered by Claude Haiku\n")
    
    if not ANTHROPIC_KEY:
        print("⚠️  ANTHROPIC_API_KEY not set — will copy files without classification")
        print("   Set it with: export ANTHROPIC_API_KEY=your_key")
        print("   Continuing in dry-run copy mode...\n")
    
    # Copy DB to avoid interfering with Photos app
    print("📦 Copying Photos database...")
    shutil.copy2(DB_PATH, DB_COPY)
    
    # Query all photos in target albums
    print("🔍 Querying albums...")
    conn = sqlite3.connect(DB_COPY)
    cur = conn.cursor()
    
    placeholders = ",".join("?" * len(TARGET_ALBUMS))
    cur.execute(f"""
        SELECT 
            alb.ZTITLE as album,
            asset.ZDIRECTORY,
            asset.ZFILENAME,
            asset.ZDATECREATED,
            asset.ZKIND,
            asset.Z_PK as asset_id
        FROM ZGENERICALBUM alb
        JOIN Z_28ASSETS r ON r.Z_28ALBUMS = alb.Z_PK
        JOIN ZASSET asset ON asset.Z_PK = r.Z_3ASSETS
        WHERE alb.ZTITLE IN ({placeholders})
        ORDER BY asset.ZDATECREATED
    """, TARGET_ALBUMS)
    
    rows = cur.fetchall()
    conn.close()
    
    print(f"✅ Found {len(rows)} files across target albums\n")
    
    # Create output structure
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for cat in CATEGORIES:
        os.makedirs(os.path.join(OUTPUT_DIR, "by-service", cat), exist_ok=True)
    
    # Also create by-date and by-album dirs
    os.makedirs(os.path.join(OUTPUT_DIR, "by-album"), exist_ok=True)
    os.makedirs(os.path.join(OUTPUT_DIR, "unclassified"), exist_ok=True)
    
    # Process files
    manifest = []
    processed = 0
    skipped = 0
    errors = 0
    
    print(f"🚀 Processing {len(rows)} files (Haiku vision classification)...\n")
    
    for i, (album, directory, filename, date_ts, kind, asset_id) in enumerate(rows):
        # Try multiple possible storage locations (originals or cloudsharing)
        first_char = filename[0].upper()
        candidates = [
            os.path.join(ORIGINALS_DIR, first_char, filename),
            os.path.join(ORIGINALS_DIR, first_char.lower(), filename),
            os.path.join(PHOTOS_LIBRARY, "scopes", "cloudsharing", "data", directory, filename),
            os.path.join(PHOTOS_LIBRARY, "resources", "derivatives", first_char, filename),
        ]
        src_path = None
        for c in candidates:
            if os.path.exists(c):
                src_path = c
                break
        if not src_path:
            skipped += 1
            continue
        
        date_str = apple_ts_to_date(date_ts)
        ext = Path(filename).suffix.lower()
        is_video = ext in ('.mp4', '.mov', '.m4v', '.avi')
        
        # Classify
        if i % 50 == 0:
            print(f"  [{i+1}/{len(rows)}] Processing... ({processed} done, {errors} errors)")
        
        if ANTHROPIC_KEY and not is_video:
            category = classify_with_haiku(src_path)
            time.sleep(0.1)  # rate limit courtesy
        elif is_video:
            category = "video"
        else:
            category = "unclassified"
        
        # Build output paths
        # by-service copy
        service_dir = os.path.join(OUTPUT_DIR, "by-service", category)
        dest_filename = f"{date_str}_{album.replace(' ','_').replace(',','')}_{asset_id}{ext}"
        dest_path = os.path.join(service_dir, dest_filename)
        
        # by-album copy
        album_dir = os.path.join(OUTPUT_DIR, "by-album", album.replace(' ','_').replace(',',''))
        os.makedirs(album_dir, exist_ok=True)
        album_dest = os.path.join(album_dir, dest_filename)
        
        try:
            shutil.copy2(src_path, dest_path)
            shutil.copy2(src_path, album_dest)
            processed += 1
            
            manifest.append({
                "album": album,
                "filename": filename,
                "date_month": date_str,
                "category": category,
                "type": "video" if is_video else "photo",
                "dest_service": dest_path,
                "dest_album": album_dest,
                "original": src_path,
            })
        except Exception as e:
            print(f"  ! Error copying {filename}: {e}")
            errors += 1
    
    # Write manifest CSV
    if manifest:
        with open(MANIFEST_PATH, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=manifest[0].keys())
            writer.writeheader()
            writer.writerows(manifest)
    
    print(f"\n✅ DONE!")
    print(f"   Processed: {processed}")
    print(f"   Skipped (missing): {skipped}")
    print(f"   Errors: {errors}")
    print(f"   Output: {OUTPUT_DIR}")
    print(f"   Manifest: {MANIFEST_PATH}")
    print(f"\n📁 Folders created:")
    for cat in CATEGORIES:
        count = len([m for m in manifest if m['category'] == cat])
        if count > 0:
            print(f"   by-service/{cat}/  → {count} files")

if __name__ == "__main__":
    main()
