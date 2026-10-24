# Notas técnicas: o que a plataforma Orsay exige

Aprendizados de fazer um app moderno rodar numa TV Samsung de 2014. Servem para quem quiser portar outros apps.

## Navegador da TV (série H)
- **WebKit 534** (≈ Chrome 13) e **JavaScript ES5**: sem `let/const`, setas `=>`, `Promise`, `startsWith`, `classList`, `trim()` confiável.
- **CSS antigo**: sem `flex`, `gap`, `calc`, `vw/vh`. O layout é todo em pixels, para **1280×720**.
- Sem `XMLHttpRequest.timeout` confiável: usamos `onreadystatechange` + `setTimeout`.
- **TLS 1.0–1.2 só com GnuTLS 2.12**: não abre sites com certificado ECDSA. Daí a ponte HTTP→HTTPS.
- O relógio da TV pode estar em **1970**. A hora vem do cabeçalho `Date` das respostas do servidor.

## Codificação (acentos viram `Ã§`)
A TV lê os `.js` como **Latin-1** mesmo com `<meta charset>`. Escreva os acentos como escapes Unicode: barra, `u` e 4 dígitos hexadecimais (c-cedilha = `00E7`). O `tools/build.py` recusa arquivos com caracteres não-ASCII.

## APIs da Samsung (`$MANAGER_WIDGET/Common/API`)
- `Widget.js`, `Plugin.js`, `TVKeyValue.js` existem **só na TV**: no PC o app detecta a ausência.
- Os plugins são `<object classid="clsid:SAMSUNG-INFOLINK-…">`. A biblioteca `Common.API.Plugin` procura por **ids fixos**: `pluginObjectTVMW`, `pluginObjectNNavi` (e `pluginObjectAudio`). Com outros ids, `unregistKey()` falha em silêncio e **volume/mudo não funcionam**.
- **Códigos de tecla**: o 1 do controle é `101`, o 4 é `8` e o 8 é `13`, que colidem com `e`, Backspace e Enter do PC. Por isso `remoteKeys.js` usa um mapa para a TV e outro para o navegador.
- A TV dispara `keypress` com `charCode` = `keyCode` para as teclas do controle. Ignore esses eventos ao digitar texto.
- `widgetAPI.blockNavigation(e)` evita que a TV trate a tecla (por exemplo RETURN fechando o app).
- Volume/mudo: `pluginAPI.unregistKey(KEY_VOL_UP|KEY_VOL_DOWN|KEY_MUTE)` + `pluginObjectNNavi.SetBannerState(1)` entregam as teclas à TV. Como reserva, o app usa `pluginObjectAudio` (`SetVolumeWithKey`, `SetUserMute`).

## Player (`SAMSUNG-INFOLINK-PLAYER`)
- HLS exige o sufixo **`|COMPONENT=HLS`** na URL.
- `SetDisplayArea(x, y, w, h)` usa a base **960×540**, mesmo com o widget em 1280×720. Multiplique as coordenadas por 0,75.
- O vídeo fica **atrás** do HTML: deixe o `body` transparente e **não pinte** a região do vídeo.
- Eventos do plugin são strings com o nome de uma função global (`plugin.OnBufferingComplete = "VideoPlayer.onBufferingComplete"`).
- Um canal que cai gera `OnConnectionFailed`/`OnStreamNotFound`; o app tenta reconectar 3 vezes.

## Desempenho (CPU fraca, pouca memória)
- Imagens **no tamanho exato** de exibição (a TV escala mal e decodifica devagar).
- **Linhas de lista reaproveitadas** (pool fixo) em vez de recriar o DOM a cada tecla.
- Cores sólidas: sem sombras, gradientes CSS ou transparência sobre o vídeo; sem animações.
- Troca de canal só abre o vídeo **0,6 s depois da última tecla**.
- Cache de programação (EPG) por canal, 15 min.

## Ícones do Smart Hub
- 4 tamanhos: `85×70`, `95×78`, `106×87`, `115×95`, mais as versões **HD** (2×) declaradas como `ThumbIconHD`, `BigThumbIconHD`, `ListIconHD`, `BigListIconHD` no `config.xml`.
- Use **fundo sólido**: ícones transparentes deixam o texto do banner da TV aparecer por trás.

## O que dá para fazer remotamente na TV
Pouco. Nas TVs Orsay a porta 8080 é só o servidor DIAL (transmitir do YouTube) e a 7676 é compartilhamento de mídia. Instalar apps é pela **sincronização de rede** (IP do servidor) ou **pendrive**.
