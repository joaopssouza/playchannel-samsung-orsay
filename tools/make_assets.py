#!/usr/bin/env python3
"""Gera as imagens do widget no tamanho exato em que a TV as exibe.

O WebKit da TV decodifica e escala imagens grandes muito mal. Por isso tudo e
pre-calculado aqui: logos, icones do Smart Hub (normal e HD), icones do menu e o
degrade da barra de informacoes.

Uso:
    python tools/make_assets.py                     # marca generica ("IPTV")
    python tools/make_assets.py --logo meu_logo.png # usa o SEU logo (PNG com fundo transparente)

Requer: pip install pillow
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDGET = os.path.join(ROOT, "widget")
SS = 4  # desenha em 4x e reduz: bordas e texto ficam suaves


def neutral_logo():
    """Marca generica: emblema com triangulo de play + texto. Nao e de nenhum servico."""
    w, h = 1050, 420
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # emblema com degrade azul -> violeta
    size = 300
    ox, oy = 60, 60
    grad = Image.new("RGBA", (size, size))
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * size)
            grad.putpixel((x, y), (int(40 + 120 * t), int(150 - 70 * t), int(235 - 20 * t), 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], 70, fill=255)
    im.paste(grad, (ox, oy), mask)
    d.polygon([(ox + 115, oy + 85), (ox + 115, oy + 215), (ox + 225, oy + 150)], fill=(255, 255, 255, 255))
    font_big = ImageFont.load_default(150)
    font_small = ImageFont.load_default(54)
    d.text((410, 70), "IPTV", font=font_big, fill=(255, 255, 255, 255))
    d.text((416, 250), "SAMSUNG ORSAY", font=font_small, fill=(190, 200, 220, 255))
    return im


def load_logo(path):
    logo = Image.open(path).convert("RGBA") if path else neutral_logo()
    box = logo.getbbox()
    return logo.crop(box) if box else logo


def fit(logo, w, h):
    lw = w
    lh = round(logo.height * lw / logo.width)
    if lh > h:
        lh = h
        lw = round(logo.width * lh / logo.height)
    return logo.resize((max(1, lw), max(1, lh)), Image.LANCZOS)


def save(im, *parts):
    path = os.path.join(WIDGET, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, optimize=True)


def make_logos(logo):
    for name, w in (("logo_sidebar.png", 210), ("logo_small.png", 150)):
        lg = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
        save(lg, "img", name)


def make_hub_icons(logo):
    """Icones do Smart Hub: fundo solido (os transparentes deixam o texto do banner da TV
    aparecer por tras) e versoes HD (2x) declaradas como *IconHD no config.xml."""
    sizes = {"85x70": (85, 70), "95x78": (95, 78), "106x87": (106, 87), "115x95": (115, 95)}

    def tile(w, h):
        W, H = w * SS, h * SS
        bg = Image.new("RGBA", (W, H))
        top, bottom = (24, 28, 44), (6, 7, 12)
        px = bg.load()
        for y in range(H):
            f = y / (H - 1)
            c = tuple(int(top[i] + (bottom[i] - top[i]) * f) for i in range(3)) + (255,)
            for x in range(W):
                px[x, y] = c
        glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        g = ImageDraw.Draw(glow)
        g.ellipse([W * 0.05, H * 0.15, W * 0.55, H * 0.95], fill=(90, 90, 220, 80))
        g.ellipse([W * 0.25, H * 0.25, W * 0.75, H * 0.85], fill=(60, 140, 255, 40))
        bg = Image.alpha_composite(bg, glow.filter(ImageFilter.GaussianBlur(W * 0.08)))
        lg = fit(logo, int(W * 0.88), int(H * 0.8))
        bg.alpha_composite(lg, ((W - lg.width) // 2, (H - lg.height) // 2))
        return bg.resize((w, h), Image.LANCZOS).convert("RGB")

    for name, (w, h) in sizes.items():
        t = tile(w, h)
        save(t, "icon", "icon_%s.png" % name)
        save(tile(w * 2, h * 2), "icon", "icon_%s_hd.png" % name)
        save(t, "icon_%s.png" % name)
    save(tile(106, 87), "icon.png")


def make_menu_icons():
    size = 30
    dark = (11, 13, 18, 255)
    white = (255, 255, 255, 255)

    def home(d, c):
        d.polygon([(60, 8), (8, 56), (24, 56), (24, 112), (50, 112), (50, 80), (70, 80), (70, 112), (96, 112), (96, 56), (112, 56)], fill=c)

    def user(d, c):
        d.ellipse([4, 4, 116, 116], fill=c)
        d.ellipse([40, 22, 80, 62], fill=(0, 0, 0, 0))
        d.pieslice([22, 66, 98, 140], 180, 360, fill=(0, 0, 0, 0))

    def calendar(d, c):
        d.rounded_rectangle([10, 18, 110, 112], 10, fill=c)
        d.rectangle([28, 4, 40, 30], fill=c)
        d.rectangle([80, 4, 92, 30], fill=c)
        d.rectangle([10, 42, 110, 48], fill=(0, 0, 0, 0))

    def tv(d, c):
        d.rounded_rectangle([4, 14, 116, 86], 8, outline=c, width=12)
        d.rectangle([52, 86, 68, 102], fill=c)
        d.rounded_rectangle([30, 100, 90, 112], 4, fill=c)

    def search(d, c):
        d.ellipse([8, 8, 82, 82], outline=c, width=14)
        d.line([(72, 72), (110, 110)], fill=c, width=18)

    def grid(d, c):
        for x in (6, 66):
            for y in (6, 66):
                d.rounded_rectangle([x, y, x + 48, y + 48], 8, fill=c)

    for name, fn in (("home", home), ("user", user), ("calendar", calendar), ("tv", tv), ("search", search), ("grid", grid)):
        for suffix, color in (("", white), ("_dark", dark)):
            im = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
            fn(ImageDraw.Draw(im), color)
            save(im.resize((size, size), Image.LANCZOS), "img", "ic_%s%s.png" % (name, suffix))


def make_gradient():
    g = Image.new("RGBA", (1, 300))
    for y in range(300):
        g.putpixel((0, y), (0, 0, 0, int(235 * (y / 299.0) ** 1.4)))
    save(g.resize((1280, 300), Image.NEAREST), "img", "osd_gradient.png")


def make_blank():
    import base64
    path = os.path.join(WIDGET, "img", "blank.gif")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--logo", help="PNG do seu logo (fundo transparente, de preferencia horizontal)")
    args = ap.parse_args()
    logo = load_logo(args.logo)
    make_logos(logo)
    make_hub_icons(logo)
    make_menu_icons()
    make_gradient()
    make_blank()
    print("Imagens geradas em", WIDGET)


if __name__ == "__main__":
    main()
