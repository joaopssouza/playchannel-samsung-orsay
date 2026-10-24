// Simula a TV Orsay (Common.API + plugin do player + XHR) e percorre os fluxos da v2.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const APP = process.argv[2] || path.join(__dirname, "..", "widget");
const html = fs.readFileSync(path.join(APP, "index.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const K = { KEY_0: 17, KEY_1: 101, KEY_2: 98, KEY_3: 6, KEY_4: 8, KEY_5: 9, KEY_6: 10, KEY_7: 12, KEY_8: 13, KEY_9: 14,
    KEY_UP: 29460, KEY_DOWN: 29461, KEY_LEFT: 4, KEY_RIGHT: 5, KEY_ENTER: 29443, KEY_RETURN: 88, KEY_EXIT: 45,
    KEY_RED: 108, KEY_GREEN: 20, KEY_YELLOW: 21, KEY_BLUE: 22, KEY_CH_UP: 68, KEY_CH_DOWN: 65, KEY_INFO: 31,
    KEY_PLAY: 71, KEY_PAUSE: 74, KEY_STOP: 70, KEY_VOL_UP: 7, KEY_VOL_DOWN: 11, KEY_MUTE: 27, KEY_TOOLS: 75, KEY_PRECH: 259 };

let failures = 0;
function check(cond, msg) { console.log((cond ? "  OK   " : "  FAIL ") + msg); if (!cond) failures++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "Agora" do servidor: sabado 24/10/2026 20:40 UTC = 17:40 em Brasilia (a TV esta em 1970)
const SERVER_NOW = Date.UTC(2026, 9, 24, 20, 40, 0);
const SERVER_DATE = new Date(SERVER_NOW).toUTCString();

async function boot(opts) {
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
    const w = dom.window;
    const calls = { play: [], area: [], xhr: [], blocked: 0 };
    w.Date.prototype.getTime = function() { return this.valueOf(); };
    w.Common = { API: {
        TVKeyValue: function() { Object.assign(this, K); },
        Widget: function() { this.sendReadyEvent = () => {}; this.blockNavigation = () => { calls.blocked++; }; },
        Plugin: function() { this.unregistKey = () => {}; this.registKey = () => {}; }
    } };
    const p = w.document.getElementById("pluginPlayer");
    p.Play = (u) => { calls.play.push(u); return true; };
    p.Stop = () => {}; p.Pause = () => {}; p.Resume = () => {};
    p.SetDisplayArea = (...a) => calls.area.push(a);
    w.XMLHttpRequest = function() {
        const x = this;
        x.readyState = 0;
        x.open = (m, u) => { x.m = m; x.u = u; };
        x.setRequestHeader = (h, v) => { (x.h = x.h || {})[h] = v; };
        x.getResponseHeader = (h) => (h === "Date" ? SERVER_DATE : null);
        x.abort = () => {};
        x.send = (b) => {
            calls.xhr.push({ m: x.m, u: x.u, h: x.h, b });
            const r = opts.respond(x.m, x.u, b);
            setTimeout(() => { x.status = r[0]; x.responseText = r[1]; x.readyState = 4; x.onreadystatechange(); }, 5);
        };
    };
    if (opts.storage) for (const k in opts.storage) w.localStorage.setItem(k, opts.storage[k]);
    w.eval('var APP_CONFIG = {bridgeUrl:"http://192.168.0.10", providerHost:"tv.playchannel.com.br", defaultUser:"demo"};');
    for (const f of ["js/remoteKeys.js", "js/player.js", "js/m3uParser.js", "js/app.js"]) {
        w.eval(fs.readFileSync(path.join(APP, f), "utf8"));
    }
    await sleep(30);
    if (!w.App.vkKeys.length) w.onload();
    const press = (code, n) => {
        for (let i = 0; i < (n || 1); i++) {
            w.document.dispatchEvent(new w.KeyboardEvent("keydown", { keyCode: code, bubbles: true, cancelable: true }));
            w.document.dispatchEvent(new w.KeyboardEvent("keypress", { charCode: code, bubbles: true, cancelable: true }));
        }
    };
    const $ = (id) => w.document.getElementById(id);
    const q = (s) => w.document.querySelector(s);
    const visible = (id) => $(id).style.display !== "none";
    return { w, calls, press, $, q, visible, App: w.App };
}

// 30 canais em "Todos" + categoria "Filmes"
const chans = [];
for (let i = 0; i < 30; i++) {
    chans.push({ id: 100 + i, uid: "U" + i, name: "Canal " + i, number: 300 + i, logo: "/logo/c" + i + ".png",
        hls: "/media/n/U" + i + "/a/playlist.m3u8?ch=U" + i, guide: "/channels/U" + i + "/guide", rating: 0 });
}
const categories = JSON.stringify([
    { id: 0, name: "Todos", rating: 0, channels: chans },
    { id: 5, name: "Filmes", rating: 0, channels: chans.slice(10, 13) }
]);
const guide = JSON.stringify([
    { title: "Passado", start: "2026-10-24 18:00:00", stop: "2026-10-24 19:32:00", desc: "x", category: "Series" },
    { title: "The Last of Us", start: "2026-10-24 19:32:00", stop: "2026-10-24 20:50:00", desc: "Bill se prepara...", category: "Séries" },
    { title: "Proximo", start: "2026-10-24 20:50:00", stop: "2026-10-24 21:38:00", desc: "y", category: "Séries" },
    { title: "Depois", start: "2026-10-24 21:38:00", stop: "2026-10-24 22:40:00", desc: "z", category: "Séries" }
]);

const SRV = "http://192.168.0.10/px/tv.playchannel.com.br";
function api(m, u) {
    if (/\/categories\?t=TOK$/.test(u)) return [200, categories];
    if (/\/channels\/U\d+\/guide\?t=TOK$/.test(u)) return [200, guide];
    if (/\/thumb\/prewarm$/.test(u)) return [200, "{}"];
    if (/\/auth$/.test(u)) return [200, JSON.stringify({ token: "TOK", username: "demo" })];
    return [404, ""];
}

(async () => {
    console.log("== Sessao salva: abre o guia ==");
    let t = await boot({ respond: api, storage: { PLAYCHANNEL_LOGGED_IN: "true", PLAYCHANNEL_JWT: "TOK", PLAYCHANNEL_SERVER: SRV, PLAYCHANNEL_USER: "demo", PLAYCHANNEL_LAST_CH: "105" } });
    await sleep(500);
    check(t.App.focusArea === "GUIDE" && t.visible("guideScreen"), "abre na Programacao");
    check(t.calls.play[0] === SRV + "/media/n/U5/a/playlist.m3u8?ch=U5&t=TOK|COMPONENT=HLS", "volta ao ultimo canal assistido (305): " + t.calls.play[0]);
    check(t.calls.area.length && t.calls.area[t.calls.area.length - 1].join(",") === "635,12,315,177", "video na janela de previa: " + t.calls.area[t.calls.area.length - 1]);
    const pre = t.calls.xhr.find((x) => /prewarm/.test(x.u));
    check(pre && pre.u === "http://192.168.0.10/thumb/prewarm" && JSON.parse(pre.b).paths.length === 30, "pede miniaturas dos 30 logos ao servidor");
    const focusRow = t.q(".crow.focused");
    check(focusRow && /305/.test(focusRow.textContent), "canal 305 focado: " + (focusRow && focusRow.textContent));
    check(t.$("sideClock").textContent === "17:40", "relogio sincronizado pelo servidor (TV em 1970): " + t.$("sideClock").textContent);
    check(t.$("epgLogo").getAttribute("src") === "http://192.168.0.10/thumb/40x40/logo/c5.png", "logo do EPG vem da miniatura 40x40");
    const erows = t.w.document.querySelectorAll(".erow");
    check(erows[0].textContent.indexOf("The Last of Us") === 0 && /S.bado 16:32 \| 17:50 \| 1h18m/.test(erows[0].textContent), "EPG comeca no programa no ar, hora de Brasilia: " + erows[0].textContent);
    check(t.$("prevTitle").textContent === "The Last of Us" && /S.ries/.test(t.$("prevCat").textContent), "painel da direita mostra programa atual");

    console.log("== Lista circular e reaproveitamento de linhas ==");
    const firstRowNode = t.w.document.querySelectorAll(".crow")[0];
    t.press(K.KEY_UP, 6);
    check(/329/.test(t.q(".crow.focused").textContent), "CIMA a partir do 300 vai para o ultimo (329): " + t.q(".crow.focused").textContent);
    check(t.w.document.querySelectorAll(".crow")[0] === firstRowNode && t.w.document.querySelectorAll(".crow").length === 12, "mesmas 12 linhas reaproveitadas (sem recriar DOM)");
    t.press(K.KEY_DOWN);
    check(/300/.test(t.q(".crow.focused").textContent), "BAIXO no ultimo volta para o primeiro");
    const before = t.calls.xhr.filter((x) => /guide/.test(x.u)).length;
    t.press(K.KEY_DOWN, 7);
    await sleep(500);
    const after = t.calls.xhr.filter((x) => /guide/.test(x.u)).length;
    check(after - before === 1, "EPG so carrega quando para de navegar (1 pedido para 7 teclas): " + (after - before));
    check(t.calls.play.length === 1, "navegar nao troca o video");

    console.log("== Tela cheia, OSD, troca rapida ==");
    t.press(K.KEY_ENTER);
    check(t.calls.play.length === 2 && /U7\//.test(t.calls.play[1]), "ENTER toca o canal focado na previa");
    t.press(K.KEY_ENTER);
    await sleep(50);
    check(t.App.focusArea === "FULLSCREEN" && !t.visible("guideScreen") && t.calls.area[t.calls.area.length - 1].join(",") === "0,0,960,540", "ENTER de novo = tela cheia");
    check(t.visible("osd") && t.$("osdTitle").textContent === "307 - Canal 7" && t.$("osdNowTitle").textContent === "The Last of Us" && t.$("osdNextTitle").textContent === "Proximo", "barra AGORA / A SEGUIR");
    check(t.$("osdNowTime").textContent === "16:32 - 17:50" && t.$("osdLogo").getAttribute("src") === "http://192.168.0.10/thumb/72x72/logo/c7.png", "horario e logo 72x72 na barra");
    t.press(K.KEY_UP, 4);
    check(t.calls.play.length === 2 && t.$("osdTitle").textContent === "311 - Canal 11", "CIMA x4 atualiza a barra sem abrir 4 videos");
    await sleep(700);
    check(t.calls.play.length === 3 && /U11\//.test(t.calls.play[2]), "abre so o canal final apos parar (311)");

    console.log("== Lista rapida sobre o video ==");
    t.press(K.KEY_ENTER);
    check(t.App.focusArea === "OVERLAY" && t.visible("overlayList"), "ENTER em tela cheia abre a lista rapida");
    check(/311-Canal 11/.test(t.q(".orow.focused").textContent) && t.q(".orow.focused img").getAttribute("src") === "http://192.168.0.10/thumb/40x40/logo/c11.png", "lista focada no canal atual com logo 40x40");
    t.press(K.KEY_DOWN, 21);
    check(/302-Canal 2/.test(t.q(".orow.focused").textContent), "lista rapida tambem e circular (311 + 21 = 302)");
    t.press(K.KEY_RIGHT, 2);
    check(t.App.currentCategory === "Filmes" && /FILMES/.test(t.$("overlayCat").textContent), "DIREITA troca de categoria (Todos > Outros > Filmes)");
    t.press(K.KEY_ENTER);
    check(!t.visible("overlayList") && /U11\//.test(t.calls.play[t.calls.play.length - 1]), "ENTER fecha a lista (canal 311 ja tocando em Filmes)");

    console.log("== Numeros e voltar ==");
    t.press(K.KEY_3); t.press(K.KEY_2); t.press(K.KEY_0);
    check(t.$("numberEntry").textContent === "320", "digitos aparecem na tela");
    await sleep(1600);
    check(/U20\//.test(t.calls.play[t.calls.play.length - 1]) && t.App.currentCategory === "Todos", "320 toca o canal (procura em Todos)");
    t.press(K.KEY_RETURN);
    check(t.App.focusArea === "GUIDE" && /320/.test(t.q(".crow.focused").textContent) && t.calls.blocked > 0, "RETURN volta ao guia focado no canal tocando");
    t.press(K.KEY_LEFT);
    check(t.App.guideFocus === "MENU" && /PROGRAMA/.test(t.q(".menu-item.focused").textContent), "ESQUERDA vai ao menu");
    t.press(K.KEY_DOWN, 2); t.press(K.KEY_ENTER);
    check(t.App.chanMode === "CATEGORIAS" || (t.App.chanMode === "CATEGORIES" && /CATEGORIAS/.test(t.$("chanColTitle").textContent)), "CATEGORIAS mostra a lista de grupos");
    t.press(K.KEY_DOWN, 2); t.press(K.KEY_ENTER);
    check(t.App.currentCategory === "Filmes" && t.App.chanMode === "CHANNELS", "abre categoria Filmes");

    console.log("== Usuario (painel, sem sair ao abrir) ==");
    t.press(K.KEY_LEFT); t.press(K.KEY_DOWN); t.press(K.KEY_ENTER);
    check(t.App.view === "user" && t.visible("userPanel") && !t.visible("chanCol") && t.App.focusArea === "GUIDE", "USUARIO abre o painel ao lado e NAO desloga");
    check(/Ol.*demo/.test(t.$("userHello").textContent) && t.$("ubLogout").className.indexOf("focused") !== -1, "painel mostra Ola + botao Sair focado");
    t.press(K.KEY_DOWN, 2); t.press(K.KEY_ENTER);
    check(t.App.focusArea === "PIN" && /Alterar senha/.test(t.$("pinTitle").textContent) && /atual/.test(t.$("pinSubtitle").textContent), "Alterar senha pede a senha atual");
    [K.KEY_0, K.KEY_0, K.KEY_0, K.KEY_0].forEach((k) => t.press(k)); await sleep(200);
    check(/nova senha/.test(t.$("pinSubtitle").textContent), "pede a nova senha");
    [K.KEY_1, K.KEY_2, K.KEY_3, K.KEY_4].forEach((k) => t.press(k)); await sleep(200);
    [K.KEY_1, K.KEY_2, K.KEY_3, K.KEY_5].forEach((k) => t.press(k)); await sleep(200);
    check(/conferem/.test(t.$("pinAlert").textContent), "confirmacao diferente e recusada");
    [K.KEY_1, K.KEY_2, K.KEY_3, K.KEY_4].forEach((k) => t.press(k)); await sleep(200);
    [K.KEY_1, K.KEY_2, K.KEY_3, K.KEY_4].forEach((k) => t.press(k)); await sleep(200);
    check(t.w.localStorage.getItem("PLAYCHANNEL_PARENTAL_PIN") === "1234" && t.App.focusArea === "GUIDE", "nova senha 1234 salva");
    t.press(K.KEY_UP, 2); t.press(K.KEY_ENTER);
    check(t.App.focusArea === "LOGIN", "botao Sair da conta desloga");

    console.log("== Pesquisa e catalogo com nomes reais ==");
    const real = [["Globo Minas HD", 12], ["SBT MG", 5], ["HBO", 330], ["HBO Signature", 334], ["Telecine Action", 321],
        ["ESPN", 403], ["SporTV", 400], ["24H Os Simpsons", 155], ["Chaves", 153], ["Cartoon Network", 103],
        ["Canção Nova", 27], ["ClipStation Rock", 600], ["Infantil", 610], ["24H Filmes Ação", 207]]
        .map(([name, number], i) => ({ id: 500 + i, uid: "R" + i, name, number, logo: "/logo/r" + i + ".png", hls: "/media/n/R" + i + "/a/p.m3u8?ch=R" + i, rating: 0 }));
    t = await boot({ respond: (m, u, bd) => /categories/.test(u) ? [200, JSON.stringify([{ id: 0, name: "Todos", channels: real }])] : api(m, u, bd),
        storage: { PLAYCHANNEL_LOGGED_IN: "true", PLAYCHANNEL_JWT: "TOK", PLAYCHANNEL_SERVER: SRV, PLAYCHANNEL_USER: "demo" } });
    await sleep(500);
    check(JSON.stringify(t.App.categories) === JSON.stringify(["Todos", "TV Aberta", "Esportes", "Filmes", "Filmes 24 Horas", "Infantil", "Desenhos 24 Horas", "Música", "Religiosos"]), "grupos montados pelo nome: " + t.App.categories.join(", "));
    check(t.App.categoriesMap["Música"].map((c) => c.number).join() === "600,610", "610 'Infantil' vai para Musica (faixa de clipes)");
    t.press(K.KEY_LEFT); t.press(K.KEY_UP); t.press(K.KEY_ENTER);
    check(t.App.view === "search" && t.visible("searchPanel"), "PESQUISAR abre o painel");
    t.press(K.KEY_RIGHT); t.press(K.KEY_DOWN, 2); t.press(K.KEY_ENTER); // linha 3, coluna 2 = 'r'
    t.press(K.KEY_UP, 2); t.press(K.KEY_LEFT); t.press(K.KEY_ENTER); // 'a'
    check(t.App.searchQuery === "ra", "teclado da pesquisa digita com as setas (" + t.App.searchQuery + ")");
    t.press(K.KEY_RED); t.press(K.KEY_RED);
    const typeKb = (txt) => { for (const c of txt) { t.App.searchKey = t.App.searchKeys.findIndex((k) => k.value === c); t.press(K.KEY_ENTER); } };
    typeKb("sig");
    check(t.App.searchResults.length === 1 && t.App.searchResults[0].name === "HBO Signature", "'sig' encontra HBO Signature");
    t.press(K.KEY_RED, 3); t.press(K.KEY_3); t.press(K.KEY_3);
    check(t.App.searchResults.map((c) => c.number).join() === "330,334", "numeros do controle buscam pelo numero (33 -> 330, 334)");
    t.press(K.KEY_RED, 2);
    typeKb("cancao");
    check(t.App.searchResults.length === 1 && t.App.searchResults[0].number === 27, "busca ignora acentos (cancao -> Canção Nova)");
    t.App.searchKey = 7; t.press(K.KEY_RIGHT); t.press(K.KEY_ENTER);
    await sleep(50);
    check(t.App.focusArea === "FULLSCREEN" && /R10\//.test(t.calls.play[t.calls.play.length - 1]), "ENTER no resultado assiste em tela cheia");
    t.press(K.KEY_RETURN);
    check(t.App.view === "search" && t.visible("searchPanel"), "RETURN volta para a pesquisa");
    t.press(K.KEY_RETURN); t.press(K.KEY_RETURN);
    check(t.App.guideFocus === "MENU", "RETURN volta ao menu");
    t.press(K.KEY_DOWN, 2); t.press(K.KEY_ENTER);
    check(t.App.view === "catalog" && t.visible("catalogPanel"), "CATALOGO abre");
    const titles = Array.from(t.w.document.querySelectorAll(".cgroup")).map((g) => g.querySelector(".cgroup-title").textContent);
    check(/TV Aberta/.test(titles[0]) && /Esportes/.test(titles[1]) && /Filmes/.test(titles[2]), "fileiras por grupo: " + titles.map((s) => s.split("  ")[0]).join(" | "));
    check(/5SBT MG/.test(t.q(".ctile.focused").textContent) && t.q(".ctile.focused img").getAttribute("src") === "http://192.168.0.10/thumb/72x72/logo/r1.png", "grupo em ordem de numero, 1o canal (5 SBT) focado com logo 72x72");
    t.press(K.KEY_DOWN, 2); t.press(K.KEY_RIGHT);
    check(/330HBO$/.test(t.q(".ctile.focused").textContent), "BAIXO/DIREITA navegam (Filmes: 321 > 330 HBO)");
    t.press(K.KEY_ENTER); await sleep(50);
    check(t.App.focusArea === "FULLSCREEN" && t.App.currentCategory === "Filmes" && /R2\//.test(t.calls.play[t.calls.play.length - 1]), "ENTER assiste e CH+/- passa a navegar no grupo Filmes");

    console.log("== Controle parental ==");
    t = await boot({ respond: (m, u, bd) => /categories/.test(u) ? [200, JSON.stringify([{ id: 0, name: "Todos", channels: [chans[0], { id: 999, name: "Canal Adulto", number: 900, hls: "/media/n/X/a/p.m3u8", rating: 18 }] }])] : api(m, u, bd),
        storage: { PLAYCHANNEL_LOGGED_IN: "true", PLAYCHANNEL_JWT: "TOK", PLAYCHANNEL_SERVER: SRV } });
    await sleep(500);
    t.press(K.KEY_DOWN); t.press(K.KEY_ENTER);
    check(t.App.focusArea === "PIN" && t.visible("pinModal"), "canal 18+ pede PIN");
    [K.KEY_1, K.KEY_1, K.KEY_1, K.KEY_1].forEach((k) => t.press(k));
    await sleep(200);
    check(t.App.focusArea === "PIN" && /incorreta/.test(t.$("pinAlert").textContent), "PIN errado recusado");
    [K.KEY_0, K.KEY_0, K.KEY_0, K.KEY_0].forEach((k) => t.press(k));
    await sleep(200);
    check(t.App.focusArea === "GUIDE" && /\/X\//.test(t.calls.play[t.calls.play.length - 1]), "PIN 0000 libera e toca");

    console.log("== Login e demonstracao ==");
    t = await boot({ respond: api });
    t.press(K.KEY_1); t.press(K.KEY_DOWN, 2); t.press(K.KEY_ENTER);
    await sleep(500);
    check(t.App.focusArea === "GUIDE" && t.App.allChannels.length === 30, "login leva ao guia com 30 canais");
    t = await boot({ respond: api });
    t.press(K.KEY_DOWN, 3); t.press(K.KEY_ENTER);
    await sleep(500);
    check(t.App.focusArea === "GUIDE" && /BigBuckBunny/.test(t.calls.play[0]) && /indispon/i.test(t.$("epgEmpty").textContent), "demonstracao abre no guia");

    console.log(failures ? "\n" + failures + " FALHA(S)" : "\nTODOS OS TESTES PASSARAM");
    process.exit(failures ? 1 : 0);
})();
