# 5 apr 2026

import base64
import json
import os
import threading
from io import BytesIO
from pathlib import Path

import eel,sys

import pyautogui
import easyocr
import numpy as np
import re
import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
OCR_STORAGE_DIR = BASE_DIR / "assets" / "ocr"
OCR_REQUIRED_FILES = ("craft_mlt_25k.pth", "english_g2.pth")

_ocr_reader = None
_ocr_lock = threading.Lock()


def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)
    
load_dotenv()
eel.init(resource_path("web"))


def ocr_models_present():
    return all((OCR_STORAGE_DIR / filename).exists() for filename in OCR_REQUIRED_FILES)


def get_ocr_reader():
    global _ocr_reader

    if _ocr_reader is not None:
        return _ocr_reader, False, True

    with _ocr_lock:
        if _ocr_reader is not None:
            return _ocr_reader, False, True

        OCR_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        cached = ocr_models_present()

        _ocr_reader = easyocr.Reader(
            ["en"],
            model_storage_directory=str(OCR_STORAGE_DIR),
            download_enabled=not cached,
        )
        return _ocr_reader, not cached, cached

def fetch_firebase_users(user_ids):
    # Expected Firebase shape per user:
    # /users/{roblox_id}.json
    # {
    #   "roblox_id": "123456789",
    #   "flag_count": 3,
    #   "source_count": 2,
    #   "source_summary": "2 community reports",
    #   "last_updated": 1712668800,
    #   "confidence": "high",
    #   "review_note": "Matched by two shared reports",
    #   "review_tags": ["high", "community", "manual"]
    # }
    database_url = os.getenv(
        "FIREBASE_DATABASE_URL",
        "https://nomoreauto-default-rtdb.firebaseio.com"
    ).rstrip("/")

    if not database_url:
        print("FIREBASE_DATABASE_URL not set.")
        return {}

    result = {}

    for username, roblox_id in user_ids.items():
        roblox_id = str(roblox_id).strip()

        if not roblox_id.isdigit():
            continue

        url = f"{database_url}/users/{roblox_id}.json"

        try:
            response = requests.get(url, timeout=10)
            if response.status_code != 200:
                continue

            user_data = response.json()

            if not user_data or not isinstance(user_data, dict):
                continue

            result[username] = {
                "username": username,
                "flag_count": user_data.get("flag_count"),
                # Used to power the hover text for source coverage.
                "source_count": user_data.get("source_count"),
                # Optional human-readable summary if the database provides one.
                "source_summary": user_data.get("source_summary") or user_data.get("sources"),
                # Unix timestamp or millis timestamp for the latest update.
                "last_updated": user_data.get("last_updated"),
                # Expected values: low, medium, high.
                "confidence": user_data.get("confidence"),
                # Optional short note shown in the review summary.
                "review_note": user_data.get("review_note"),
                # Optional tag list used to highlight the badges in the UI.
                "review_tags": user_data.get("review_tags") or user_data.get("tags") or user_data.get("labels"),
            }

        except Exception as exc:
            print(f"Firebase lookup failed for {roblox_id}: {exc}")

    return result


def build_scan_metadata(firebase_users, conversion_error=None, converted_ids=None):
    # Aggregate scan metadata for the browser UI.
    # This keeps the front end focused on display logic instead of database math.
    matched_users = list((firebase_users or {}).values())
    matched_count = len(matched_users)
    converted_total = len(converted_ids or [])
    source_total = 0
    latest_updated = None
    review_tags = set()

    for record in matched_users:
        source_count = record.get("source_count")
        try:
            source_total += int(source_count)
        except (TypeError, ValueError):
            source_total += 1

        updated_value = record.get("last_updated")
        try:
            numeric_updated = float(updated_value)
        except (TypeError, ValueError):
            numeric_updated = None

        if numeric_updated is not None:
            if latest_updated is None or numeric_updated > latest_updated:
                latest_updated = numeric_updated

        tags = record.get("review_tags")
        if isinstance(tags, (list, tuple, set)):
            for tag in tags:
                text = str(tag).strip()
                if text:
                    review_tags.add(text)
        elif isinstance(tags, str):
            for part in re.split(r"[;,|]", tags):
                text = part.strip()
                if text:
                    review_tags.add(text)
        elif tags:
            review_tags.add(str(tags).strip())

    if conversion_error:
        status = "error"
    elif matched_count > 0:
        status = "positive"
    else:
        status = "clear"

    return {
        "status": status,
        "matched_count": matched_count,
        "converted_total": converted_total,
        "source_total": source_total,
        "last_updated": latest_updated,
        "review_tags": sorted(review_tags),
        "conversion_error": conversion_error,
    }

@eel.expose
def hello():
    return "Hello from Python!"


@eel.expose
def handle_upload_click():
    key_loaded = bool(os.getenv("FIREBASE_KEY"))
    print("handle_upload_click reached; FIREBASE_KEY loaded:", key_loaded)
    return {
        "message": "Upload button reached Python successfully.",
        "firebase_key_loaded": key_loaded,
    }


@eel.expose
def ensure_ocr_ready():
    try:
        _reader_instance, installed, cached = get_ocr_reader()
        return {
            "ready": True,
            "installed": installed,
            "cached": cached,
            "message": (
                "OCR models installed and ready in assets/ocr."
                if installed
                else "OCR ready from assets/ocr."
            ),
        }
    except Exception as exc:
        print("ensure_ocr_ready failed:", exc)
        return {
            "ready": False,
            "installed": False,
            "cached": ocr_models_present(),
            "message": str(exc),
        }


@eel.expose
def capture_snip():
    result = {}
    done = threading.Event()

    def run_overlay():
        import tkinter as tk

        root = tk.Tk()
        root.attributes("-fullscreen", True)
        root.attributes("-topmost", True)
        root.overrideredirect(True)
        root.configure(bg="black")
        root.attributes("-alpha", 0.18)

        canvas = tk.Canvas(root, cursor="cross", bg="black", highlightthickness=0)
        canvas.pack(fill="both", expand=True)

        start_x = 0
        start_y = 0
        rect_id = None

        def on_press(event):
          nonlocal start_x, start_y, rect_id
          start_x = event.x_root
          start_y = event.y_root
          if rect_id is not None:
              canvas.delete(rect_id)
              rect_id = None

        def on_drag(event):
          nonlocal rect_id
          if rect_id is not None:
              canvas.delete(rect_id)
          rect_id = canvas.create_rectangle(
              start_x,
              start_y,
              event.x_root,
              event.y_root,
              outline="#3b82f6",
              width=2,
          )

        def finish():
          if root.winfo_exists():
              root.destroy()
          done.set()

        def on_release(event):
          x1 = min(start_x, event.x_root)
          y1 = min(start_y, event.y_root)
          x2 = max(start_x, event.x_root)
          y2 = max(start_y, event.y_root)
          if x2 - x1 < 4 or y2 - y1 < 4:
              result["error"] = "selection too small"
              finish()
              return
          result["bbox"] = (x1, y1, x2 - x1, y2 - y1)
          finish()

        def on_escape(_event=None):
          result["error"] = "cancelled"
          finish()

        canvas.bind("<ButtonPress-1>", on_press)
        canvas.bind("<B1-Motion>", on_drag)
        canvas.bind("<ButtonRelease-1>", on_release)
        root.bind("<Escape>", on_escape)
        root.mainloop()

    threading.Thread(target=run_overlay, daemon=True).start()
    done.wait()

    if "bbox" not in result:
        return {
            "image_data": None,
            "error": result.get("error", "cancelled"),
            "scan": build_scan_metadata({}, conversion_error=result.get("error", "cancelled")),
        }

    try:
        screenshot = pyautogui.screenshot(region=result["bbox"])
        ocr_result = run_ocr(screenshot)
        detected_usernames = ocr_result["text"] or []
        conversion_result = convert_id(detected_usernames)
        converted_ids = conversion_result["converted_ids"]
        conversion_error = conversion_result["error"] or ocr_result.get("error")
        firebase_users = {} if conversion_error else fetch_firebase_users(converted_ids)
    except Exception as exc:
        print("capture_snip failed:", exc)
        return {
            "image_data": None,
            "error": str(exc),
            "scan": build_scan_metadata({}, conversion_error=str(exc)),
        }

    buffer = BytesIO()
    screenshot.save(buffer, format="PNG")
    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("ascii")

    return {
        "image_data": f"data:image/png;base64,{encoded}",
        "text": ocr_result["text"],
        "firebase_users": firebase_users,
        "firebase_matches": firebase_users,
        "scan": build_scan_metadata(firebase_users, conversion_error=conversion_error, converted_ids=converted_ids),
    }


def run_ocr(image):
    reader_instance, _, _ = get_ocr_reader()

    img_array = np.array(image)
    results = reader_instance.readtext(img_array, detail=0)

    text = " ".join(results)
    users = re.findall(r'@(\w+)', text)

    if not users:
        return {"text": None, "error": "No @usernames found"}

    return {
        "text": users,  
        "error": None
    }

def convert_id(usernames):
    if not usernames:
        return {
            "converted_ids": {},
            "error": "No usernames found in the capture.",
        }

    print("Sending to API:", usernames)
    url = "https://users.roblox.com/v1/usernames/users"
    payload = {
        "usernames": usernames,
        "excludeBannedUsers": True
    }

    try:
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        return {
            "converted_ids": {},
            "error": str(exc),
        }

    result = {}
    for user in data.get("data", []):
        result[user["name"]] = user["id"]

    print(result)
    return {
        "converted_ids": result,
        "error": None,
    }


eel.start("index.html", size=(1280, 720), port=8080)
