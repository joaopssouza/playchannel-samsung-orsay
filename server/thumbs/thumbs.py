"""Miniaturas dos logos do Play Channel para a TV Samsung Orsay.

Os logos originais podem ter ~3500x3300 px e 1,7 MB; a TV levava segundos para baixar e
decodificar cada um e ainda reduzia com serrilhado. Aqui cada logo e reduzido uma
unica vez (LANCZOS), centralizado no tamanho exato pedido, salvo em PNG com paleta
(~2-5 KB) e guardado em disco.

  GET  /thumb/<L>x<A>/<caminho>?<query>  ex.: /thumb/40x40/logo/123.png?apptype=app
  POST /thumb/prewarm  corpo: {"sizes": ["40x40", "72x72"], "paths": ["/logo/1.png", ...]}
"""
import hashlib
import io
import json
import os
import queue
import re
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

ORIGIN = os.environ.get("PROVIDER_ORIGIN", "https://tv.playchannel.com.br")
CACHE = os.environ.get("CACHE_DIR", "/cache")
ALLOWED_SIZES = {(40, 40), (72, 72), (96, 96)}
PATH_RE = re.compile(r"^/(logo|theme)/[A-Za-z0-9._/-]+\.(png|jpg|jpeg)$", re.I)

os.makedirs(CACHE, exist_ok=True)
locks = {}
locks_guard = threading.Lock()
work = queue.Queue()


def cache_file(path, w, h):
    return os.path.join(CACHE, "%dx%d_%s.png" % (w, h, hashlib.sha1(path.encode()).hexdigest()))


def make_thumb(path, w, h):
    target = cache_file(path, w, h)
    if os.path.exists(target):
        return target
    with locks_guard:
        lock = locks.setdefault(target, threading.Lock())
    with lock:
        if os.path.exists(target):
            return target
        req = urllib.request.Request(ORIGIN + path + "?apptype=app", headers={"User-Agent": "pc-thumbs"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
        im = Image.open(io.BytesIO(data))
        im.draft("RGBA", (w * 4, h * 4))
        im = im.convert("RGBA")
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
        im.thumbnail((w, h), Image.LANCZOS)
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.paste(im, ((w - im.width) // 2, (h - im.height) // 2), im)
        out = canvas.quantize(colors=128, method=Image.Quantize.FASTOCTREE)
        tmp = target + ".tmp"
        out.save(tmp, "PNG", optimize=True)
        os.replace(tmp, target)
    with locks_guard:
        locks.pop(target, None)
    return target


def worker():
    while True:
        path, w, h = work.get()
        try:
            make_thumb(path, w, h)
        except Exception as e:  # noqa: BLE001 - registra e segue com os proximos
            print("prewarm falhou", path, e, flush=True)
        work.task_done()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body=b"", ctype="text/plain", cache=False):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if cache:
            self.send_header("Cache-Control", "public, max-age=2592000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        m = re.match(r"^/thumb/(\d+)x(\d+)(/[^?]+)", self.path)
        if not m:
            return self.send(404, b"not found")
        w, h, path = int(m.group(1)), int(m.group(2)), m.group(3)
        if (w, h) not in ALLOWED_SIZES or not PATH_RE.match(path):
            return self.send(400, b"bad request")
        try:
            with open(make_thumb(path, w, h), "rb") as f:
                self.send(200, f.read(), "image/png", cache=True)
        except Exception as e:  # noqa: BLE001
            self.send(502, str(e).encode())

    def do_POST(self):
        if not self.path.startswith("/thumb/prewarm"):
            return self.send(404, b"not found")
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(min(n, 2_000_000)) or b"{}")
            sizes = [tuple(int(v) for v in s.split("x")) for s in body.get("sizes", [])]
            count = 0
            for path in body.get("paths", [])[:5000]:
                for w, h in sizes:
                    if (w, h) in ALLOWED_SIZES and PATH_RE.match(path) and not os.path.exists(cache_file(path, w, h)):
                        work.put((path, w, h))
                        count += 1
            self.send(200, json.dumps({"queued": count}).encode(), "application/json")
        except Exception as e:  # noqa: BLE001
            self.send(400, str(e).encode())


if __name__ == "__main__":
    for _ in range(3):
        threading.Thread(target=worker, daemon=True).start()
    print("pc-thumbs ouvindo na porta 8080", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
