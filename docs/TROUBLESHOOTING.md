# Solução de problemas

## Diagnóstico rápido do servidor
No computador do servidor (troque o IP):
```bash
curl -s  http://192.168.0.10/widgetlist.xml
curl -s  http://192.168.0.10/px/tv.playchannel.com.br/assets/json/config.json
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
     -d '{"username":"x","password":"y"}' http://192.168.0.10/px/tv.playchannel.com.br/auth    # esperado: 401
docker compose logs --tail 50 bridge thumbs        # dentro da pasta server/
```
- `widgetlist.xml` não abre → o container `bridge` não está de pé ou a porta 80 está ocupada.
- `config.json` dá 502/504 → o servidor não alcança a internet/DNS.
- Esperado `401` no `/auth` com credenciais falsas: significa que a ponte chega ao serviço.

## A TV não encontra o widget
- Confirme o IP digitado em *Configuração de IP do servidor* e que a TV e o servidor estão na **mesma rede/VLAN**.
- O servidor deve responder na **porta 80**.
- Apague o app antigo antes de sincronizar uma versão nova (o Smart Hub guarda ícones e nome em cache).

## O ícone do app aparece borrado ou com texto por trás
Use a versão atual: ela traz ícones com fundo sólido e versões HD. Se você trocou o logo, gere de novo com `tools/make_assets.py`.

## Volume e mudo não respondem
Os plugins precisam estar no HTML com os ids `pluginObjectTVMW`, `pluginObjectNNavi` e `pluginObjectAudio` (já estão em `widget/index.html`). Se mexeu no HTML, confira esses ids.

## Logs
Não há console na TV. Para depurar, rode o app num navegador de PC (veja o README) ou use os testes em `tests/`.
