import os
import threading
import time
from collections import deque
from datetime import datetime

import serial
from flask import Flask, jsonify

SERIAL_PORT = os.getenv("MESH_SERIAL_PORT", "/dev/meshtastic")
SERIAL_BAUD = int(os.getenv("MESH_SERIAL_BAUD", "115200"))
MAX_MESSAGES = int(os.getenv("MESH_MAX_MESSAGES", "200"))

app = Flask(__name__)
messages = deque(maxlen=MAX_MESSAGES)
state = {"connected": False, "port": SERIAL_PORT, "baud": SERIAL_BAUD, "last_seen": None}


def reader_loop():
    while True:
        try:
            with serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1) as ser:
                state["connected"] = True
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode(errors="ignore").strip()
                    if not line:
                        continue
                    stamp = datetime.utcnow().isoformat(timespec="seconds") + "Z"
                    messages.append({"ts": stamp, "text": line})
                    state["last_seen"] = stamp
        except Exception:
            state["connected"] = False
            time.sleep(2)


@app.route("/")
def root():
    return jsonify({"service": "mesh-bridge", "status": state})


@app.route("/status")
def status():
    return jsonify(state)


@app.route("/messages")
def get_messages():
    return jsonify({"items": list(messages)})


if __name__ == "__main__":
    threading.Thread(target=reader_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=8090)
