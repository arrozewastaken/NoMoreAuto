#v1.0.0

import base64
import json
import os
import threading
from io import BytesIO

import eel
import firebase_admin
from firebase_admin import credentials, db
import pyautogui
import easyocr
import numpy as np
import re
import requests
from dotenv import load_dotenv

reader = easyocr.Reader(['en'])

load_dotenv()
eel.init("web")


def init_firebase():
    if firebase_admin._apps:
        return

    key_blob = os.getenv("FIREBASE_KEY")
    project_id = os.getenv("FIREBASE_PROJECT_ID")
    database_url = os.getenv("FIREBASE_DATABASE_URL")

    if not key_blob:
        print("Firebase credentials not configured; skipping Firebase init.")
        return

    try:
        if key_blob.strip().startswith("{"):
            service_account = json.loads(key_blob)
        else:
            if not os.path.exists(key_blob):
                print(f"Firebase credential file not found: {key_blob}")
                return
            with open(key_blob, "r", encoding="utf-8") as file:
                service_account = json.load(file)
    except Exception as exc:
        print("Firebase credential load failed:", exc)
        return

    options = {}
    if database_url:
        options["databaseURL"] = database_url
    elif project_id:
        options["databaseURL"] = f"https://{project_id}.firebaseio.com"

    cred = credentials.Certificate(service_account)
    firebase_admin.initialize_app(cred, options or None)


def fetch_firebase_servers(user_ids):
    init_firebase()

    if not firebase_admin._apps:
        return {}

    ref = db.reference("/")
    result = {}

    for username, user_id in user_ids.items():
        servers = ref.child(str(user_id)).get()
        if servers:
            result[username] = servers

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
