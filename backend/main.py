# 5 apr 2026

import base64
import json
import os
import threading
from io import BytesIO
from pathlib import Path

import eel

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

load_dotenv()
eel.init("web")


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
                "roblox_id": str(user_data.get("roblox_id") or roblox_id),
                "flag_count": user_data.get("flag_count"),
                "last_updated": user_data.get("last_updated"),
                "confidence": user_data.get("confidence"),
            }

        except Exception as exc:
            print(f"Firebase lookup failed for {roblox_id}: {exc}")

    return result

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
        return {"image_data": None, "error": result.get("error", "cancelled")}

    try:
        screenshot = pyautogui.screenshot(region=result["bbox"])
        ocr_result = run_ocr(screenshot)
        converted_ids = convert_id(ocr_result["text"] or [])
        firebase_users = fetch_firebase_users(converted_ids)
    except Exception as exc:
        print("capture_snip failed:", exc)
        return {"image_data": None, "error": str(exc)}

    buffer = BytesIO()
    screenshot.save(buffer, format="PNG")
    buffer.seek(0)
    encoded = base64.b64encode(buffer.read()).decode("ascii")

    return {
        "image_data": f"data:image/png;base64,{encoded}",
        "text": ocr_result["text"],
        "user_ids": converted_ids,
        "firebase_users": firebase_users,
        "firebase_matches": firebase_users,
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

def convert_id(list):

    print("Sending to API:", list)
    url = "https://users.roblox.com/v1/usernames/users"
    payload = {
        "usernames": list,
        "excludeBannedUsers": True
    }

    response = requests.post(url, json=payload)
    data = response.json()

    result = {}
    for user in data.get("data", []):
        result[user["name"]] = user["id"]

    print(result)
    return result


eel.start("index.html", size=(1280, 720), port=8080)
