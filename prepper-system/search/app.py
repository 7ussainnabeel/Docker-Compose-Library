import os
import sqlite3
import threading
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from flask import Flask, jsonify, render_template_string, request

DB_PATH = os.getenv("SEARCH_DB_PATH", "/db/search.db")
DATA_DIR = os.getenv("SEARCH_DATA_DIR", "/content")
KIWIX_DIR = os.getenv("SEARCH_KIWIX_DIR", "/kiwix")
REINDEX_SECS = int(os.getenv("SEARCH_REINDEX_SECS", "1200"))
MAX_FILE_MB = int(os.getenv("SEARCH_MAX_FILE_MB", "2"))

app = Flask(__name__)
lock = threading.Lock()

PAGE = """
<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>Offline Search</title>
  <style>
    body { margin:0; font-family: \"Avenir Next\", \"Segoe UI Variable\", \"Noto Sans\", sans-serif; background:#0a1222; color:#eaf0fe; padding:18px; }
    .box { max-width:980px; margin:0 auto; border:1px solid #30476b; border-radius:12px; background:#101b31; padding:14px; }
    form { display:flex; gap:8px; margin-bottom:12px; }
    input { flex:1; padding:10px; border-radius:10px; border:1px solid #38537b; background:#0b1528; color:#eef2ff; }
    button { border:1px solid #4f91c5; border-radius:10px; background:#1b3f67; color:#fff; padding:10px 12px; }
    .item { padding:10px; margin-bottom:8px; border:1px solid #2a4060; border-radius:10px; background:#0c1528; }
    .meta { color:#98afd1; font-size:0.9rem; }
    a { color:#80d6ff; }
  </style>
</head>
<body>
  <main class=\"box\">
    <h1>Offline Search</h1>
    <p class=\"meta\">Search local files and Kiwix library metadata. <a href=\"/\">Dashboard</a></p>
    <form method=\"GET\" action=\"/\">
      <input type=\"search\" name=\"q\" value=\"{{ q }}\" placeholder=\"Search survival guides, notes, library titles...\" />
      <button type=\"submit\">Search</button>
    </form>
    {% for item in results %}
      <article class=\"item\">
        <strong>{{ item[0] }}</strong>
        <div class=\"meta\">{{ item[1] }}</div>
        <div>{{ item[2] }}</div>
      </article>
    {% endfor %}
  </main>
</body>
</html>
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(title, path, body, source)"
        )


def reset_index(conn):
    conn.execute("DELETE FROM docs")


def maybe_text(path: Path):
    if path.stat().st_size > MAX_FILE_MB * 1024 * 1024:
        return None
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        return None
    return text[:250000]


def index_files(conn):
    root = Path(DATA_DIR)
    if not root.exists():
        return

    allowed = {".txt", ".md", ".json", ".csv", ".log", ".html", ".yml", ".yaml"}
    for file in root.rglob("*"):
        if not file.is_file() or file.suffix.lower() not in allowed:
            continue
        text = maybe_text(file)
        if not text:
            continue
        rel = str(file.relative_to(root))
        conn.execute(
            "INSERT INTO docs(title, path, body, source) VALUES (?, ?, ?, ?)",
            (file.name, rel, text, "local-file"),
        )


def index_kiwix_library(conn):
    library = Path(KIWIX_DIR) / "library.xml"
    if not library.exists():
        return

    try:
        tree = ET.parse(library)
        root = tree.getroot()
    except Exception:
        return

    for item in root.findall(".//book"):
        title = item.get("title", "Untitled Library")
        description = item.get("description", "")
        language = item.get("language", "")
        path = item.get("path", "")
        text = f"{description} language={language} path={path}"
        conn.execute(
            "INSERT INTO docs(title, path, body, source) VALUES (?, ?, ?, ?)",
            (title, path, text, "kiwix-library"),
        )


def rebuild_once():
    with lock, get_conn() as conn:
        reset_index(conn)
        index_files(conn)
        index_kiwix_library(conn)
        conn.commit()


def index_loop():
    while True:
        try:
            rebuild_once()
        except Exception:
            pass
        time.sleep(REINDEX_SECS)


@app.route("/")
def home():
    q = request.args.get("q", "").strip()
    results = []
    if q:
        with lock, get_conn() as conn:
            cur = conn.execute(
                "SELECT title, path, snippet(docs, 2, '[', ']', ' ... ', 20) FROM docs WHERE docs MATCH ? LIMIT 40",
                (q,),
            )
            results = cur.fetchall()
    return render_template_string(PAGE, q=q, results=results)


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"items": []})
    with lock, get_conn() as conn:
        cur = conn.execute(
            "SELECT title, path, snippet(docs, 2, '[', ']', ' ... ', 20), source FROM docs WHERE docs MATCH ? LIMIT 40",
            (q,),
        )
        rows = cur.fetchall()
    items = [{"title": r[0], "path": r[1], "snippet": r[2], "source": r[3]} for r in rows]
    return jsonify({"items": items})


if __name__ == "__main__":
    init_db()
    threading.Thread(target=index_loop, daemon=True).start()
    app.run(host="0.0.0.0", port=8080)
