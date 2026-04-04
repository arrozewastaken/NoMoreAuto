# 4 apr 2026

import base64
import json
import os
import threading
from io import BytesIO

import eel

import pyautogui
import easyocr
import numpy as np
import re
import requests
from dotenv import load_dotenv

reader = easyocr.Reader(['en'])

load_dotenv()
eel.init("web")

def fetch_firebase_servers(user_ids):
    DATABASE_URL = os.getenv(
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

            servers = response.json()

            if not servers:
                continue

            # If stored as {"Server A": true, "Server B": true}
            if isinstance(servers, dict):
                result[username] = list(servers.keys())

            elif isinstance(servers, list):
                result[username] = servers

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
        firebase_matches = fetch_firebase_servers(converted_ids)
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
        "firebase_matches": firebase_matches,
    }


def run_ocr(image):

    img_array = np.array(image)
    results = reader.readtext(img_array, detail=0)  

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
