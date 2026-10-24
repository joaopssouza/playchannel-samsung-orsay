#!/usr/bin/env python3
"""Baixa o hls.js (Apache-2.0) para widget/js/ -- usado SOMENTE para testar o app num navegador de PC.
A TV usa o player de hardware e o build.py nao inclui este arquivo no pacote."""
import os
import urllib.request

URL = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.light.min.js"
DEST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "widget", "js", "hls.light.min.js")

with urllib.request.urlopen(URL, timeout=30) as r, open(DEST, "wb") as f:
    f.write(r.read())
print("hls.js salvo em", DEST)
