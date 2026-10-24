#!/usr/bin/env python3
"""Empacota o widget e gera tudo que o servidor e o pendrive precisam.

Uso:
    python tools/build.py --server http://192.168.0.10

Saida (pasta dist/):
    dist/PlayChannel.zip      o widget (com o endereco do seu servidor gravado em js/config.js)
    dist/widgetlist.xml       lista que a TV le na sincronizacao de rede
    dist/icon.png             icone mostrado na lista de aplicativos de usuario
    dist/usb/widget.xml       arquivo para a instalacao por pendrive (pasta userwidget/)
    dist/usb/PlayChannel.zip
"""
import argparse
import os
import re
import shutil
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDGET = os.path.join(ROOT, "widget")
SKIP_FILES = {"hls.light.min.js"}  # hls.js so serve para testar no PC; a TV usa o player de hardware
WIDGET_ID = "PlayChannel"


def check_ascii(js_dir):
    """A TV le os .js como Latin-1: acentos tem de estar como escapes unicode (barra, u e 4 digitos hex), senao viram caracteres quebrados."""
    for name in sorted(os.listdir(js_dir)):
        if not name.endswith(".js") or name in SKIP_FILES:
            continue
        data = open(os.path.join(js_dir, name), "rb").read()
        for i, b in enumerate(data):
            if b > 127:
                line = data[:i].count(b"\n") + 1
                sys.exit("ERRO: js/%s linha %d tem caractere nao-ASCII. Escreva o acento como escape unicode (barra, u, 4 digitos hex; c-cedilha = 00E7)." % (name, line))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", required=True, help="endereco do servidor da ponte na sua rede, ex.: http://192.168.0.10")
    ap.add_argument("--provider", default=None, help="dominio do servico (padrao: o que esta em widget/js/config.js)")
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
    args = ap.parse_args()

    server = args.server.rstrip("/")
    if not re.match(r"^http://[A-Za-z0-9.-]+(:\d+)?$", server):
        sys.exit("--server deve ser algo como http://192.168.0.10 (a TV nao abre https; sem barra no final)")

    check_ascii(os.path.join(WIDGET, "js"))
    cfg = open(os.path.join(WIDGET, "js", "config.js"), encoding="utf-8").read()
    cfg = re.sub(r'bridgeUrl:\s*"[^"]*"', 'bridgeUrl: "%s"' % server, cfg)
    if args.provider:
        cfg = re.sub(r'providerHost:\s*"[^"]*"', 'providerHost: "%s"' % args.provider, cfg)

    out = args.out
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(os.path.join(out, "usb"))
    zip_path = os.path.join(out, WIDGET_ID + ".zip")
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(WIDGET):
            for f in sorted(files):
                if f in SKIP_FILES:
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, WIDGET).replace(os.sep, "/")
                if rel == "js/config.js":
                    z.writestr(rel, cfg)
                else:
                    z.write(full, rel)
                count += 1
    size = os.path.getsize(zip_path)

    entry = """        <widget id="%(id)s">
            <title>Play Channel</title>
            <compression size="%(size)d" type="zip"/>
            <description>Cliente nao oficial de TV ao vivo</description>
            <icon>%(server)s/icon.png</icon>
            <download>%(server)s/%(id)s.zip</download>
        </widget>""" % {"id": WIDGET_ID, "size": size, "server": server}
    with open(os.path.join(out, "widgetlist.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<rsp stat="ok">\n    <list>\n%s\n    </list>\n</rsp>\n' % entry)
    shutil.copy(os.path.join(WIDGET, "icon", "icon_106x87.png"), os.path.join(out, "icon.png"))

    shutil.copy(zip_path, os.path.join(out, "usb", WIDGET_ID + ".zip"))
    with open(os.path.join(out, "usb", "widget.xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write("""<?xml version="1.0" encoding="UTF-8"?>
<widgetlist>
    <widget id="%(id)s">
        <title>Play Channel</title>
        <compression size="%(size)d" type="zip"/>
        <description>Cliente nao oficial de TV ao vivo</description>
    </widget>
</widgetlist>
""" % {"id": WIDGET_ID, "size": size})

    print("%d arquivos -> %s (%d bytes)" % (count, os.path.relpath(zip_path, ROOT), size))
    print("Servidor gravado no widget: %s" % server)
    print("Proximo passo: copie o conteudo de dist/ (menos a pasta usb/) para a pasta publica do servidor (veja o README).")


if __name__ == "__main__":
    main()
