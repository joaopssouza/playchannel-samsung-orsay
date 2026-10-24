# Play Channel for Samsung Smart TVs (Orsay, 2012–2014)

*[Leia em português](README.md)*

**Unofficial** live-TV client for old Samsung Smart TVs (the *Orsay* platform, 2011–2014) whose browser can no longer open modern HTTPS sites. Channel guide, grouped catalog, search, parental control and fast zapping, all driven by the remote.

> **Disclaimer.** Independent community project. **Not affiliated with, endorsed by or sponsored by** Samsung or Play Channel. It **ships no channels or content**: you need your own account on a compatible service. It uses the service's undocumented API, which may change at any time. Use at your own risk and respect the terms of your service.

## Is my TV supported?
The letter in the model code tells the platform (e.g. `UN40`**`H`**`5203`): **H (2014): tested** on one TV; **F (2013) / E (2012): should work**, untested; **J, K, M, N, Q… (2015+) run Tizen: not supported**.

## How it works
```
 Samsung TV ──HTTP──▶  your server (Docker)  ──HTTPS──▶  TV service
 (Orsay widget)        nginx + thumbnails                 (API + HLS video)
```
These TVs ship GnuTLS 2.12, which cannot talk to today's HTTPS servers, so a tiny **bridge** on your LAN translates HTTP↔HTTPS. The same server hands the widget to the TV and shrinks channel logos (originals are ~3500 px / 1.7 MB) to the exact on-screen size. Video plays on the TV's hardware player.

## Install
1. **Server** (any always-on machine with Docker, same LAN as the TV, port 80 free):
   ```bash
   git clone https://github.com/joaopssouza/playchannel-samsung-orsay.git && cd playchannel-samsung-orsay
   python tools/build.py --server http://192.168.0.10     # use YOUR server's IP
   cd server && docker compose up -d --build
   ```
   Check `http://192.168.0.10/widgetlist.xml` opens in a browser.
2. **TV**: Smart Hub → sign in with the Samsung *develop* developer account → Tools → Settings → Development → set **server IP** → **User application synchronization**. (Menu names vary by series and language.) USB alternative: copy `dist/usb/` to a `userwidget` folder on a FAT32 pendrive.
3. Open the app and sign in with your service credentials.

Optional: `python tools/make_assets.py --logo my_logo.png` to use your own logo before building.

## Security
No secrets are stored in the repo; credentials are typed on the TV. The token and password are kept in the TV's memory and removed by *Sair da conta* (log out). **The TV→server leg is plain HTTP** (the TV cannot do better), so use it only on a trusted home network and **never expose port 80 to the internet**.

## Development
`widget/` (ES5 app), `server/` (docker-compose), `tools/`, `tests/` (`cd tests && npm install && npm test`, jsdom simulating the TV) and `docs/ORSAY-NOTES.md` (platform gotchas: Latin-1 script encoding, fixed plugin ids, `|COMPONENT=HLS`, 960×540 display-area base, key-code collisions…).

MIT licensed.
