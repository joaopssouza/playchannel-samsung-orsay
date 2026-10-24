/**
 * Play Channel TV - Samsung Smart TV Orsay 2014 (WebKit 534, JavaScript ES5)
 *
 * Restricoes do aparelho levadas em conta:
 *  - Sem ES6 (startsWith/endsWith, let, arrow functions, Promise).
 *  - Sem xhr.timeout / xhr.onload confiaveis: usa onreadystatechange + setTimeout.
 *  - GnuTLS 2.12 nao conecta em https://tv.playchannel.com.br (certificado ECDSA),
 *    por isso a API e os videos passam pela ponte HTTP do seu servidor (APP_CONFIG.bridgeUrl).
 *  - CPU/memoria limitados: listas usam um conjunto fixo de linhas reaproveitadas
 *    (nada de recriar DOM a cada tecla), logos vem do servico /thumb/ ja no tamanho
 *    exato (os originais tem 3500 px e 1,7 MB) e a troca de canal espera o usuario
 *    parar de apertar antes de abrir o video.
 *  - O relogio da TV pode estar errado (1970): a hora vem do cabecalho Date da API.
 */
function log(msg) {
    try { console.log(msg); } catch (e) {}
}

function $(id) {
    return document.getElementById(id);
}

function setText(el, text) {
    if (!el) return;
    el.innerHTML = "";
    el.appendChild(document.createTextNode(text === undefined || text === null ? "" : String(text)));
}

function hasClass(el, c) {
    return (" " + el.className + " ").indexOf(" " + c + " ") !== -1;
}

function addClass(el, c) {
    if (el && !hasClass(el, c)) el.className = (el.className ? el.className + " " : "") + c;
}

function removeClass(el, c) {
    if (!el || !hasClass(el, c)) return;
    el.className = (" " + el.className + " ").replace(" " + c + " ", " ").replace(/^\s+|\s+$/g, "");
}

function toggleClass(el, c, on) {
    if (on) addClass(el, c);
    else removeClass(el, c);
}

function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function trim(s) {
    return String(s || "").replace(/^\s+|\s+$/g, "");
}

var Store = {
    get: function(key, def) {
        try {
            var v = window.localStorage.getItem(key);
            return v === null || v === undefined ? def : v;
        } catch (e) {
            return def;
        }
    },
    set: function(key, value) {
        try { window.localStorage.setItem(key, value); } catch (e) {}
    },
    remove: function(key) {
        try { window.localStorage.removeItem(key); } catch (e) {}
    }
};

var Http = {
    request: function(method, url, headers, body, timeoutMs, callback) {
        var xhr = new XMLHttpRequest();
        var finished = false;
        var timer = setTimeout(function() {
            if (finished) return;
            finished = true;
            try { xhr.abort(); } catch (e) {}
            callback(0, "", true, null);
        }, timeoutMs || 20000);

        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4 || finished) return;
            finished = true;
            clearTimeout(timer);
            var date = null;
            try { date = xhr.getResponseHeader("Date"); } catch (e) {}
            callback(xhr.status, xhr.responseText, false, date);
        };

        try {
            xhr.open(method, url, true);
            for (var h in headers) {
                if (headers.hasOwnProperty(h)) xhr.setRequestHeader(h, headers[h]);
            }
            xhr.send(body || null);
        } catch (e) {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                callback(0, String(e), false, null);
            }
        }
    }
};

/**
 * Conjunto fixo de linhas de uma lista. Cada linha guarda referencias aos nos de
 * texto e a imagem, e so altera o que mudou.
 */
function RowPool(container, count, build) {
    this.rows = [];
    container.innerHTML = "";
    for (var i = 0; i < count; i++) {
        var row = build(i);
        row.key = null;
        container.appendChild(row.el);
        this.rows.push(row);
    }
}

function textNode(parent, cls, tag) {
    var el = document.createElement(tag || "div");
    el.className = cls;
    var t = document.createTextNode("");
    el.appendChild(t);
    parent.appendChild(el);
    return t;
}

function setImg(img, src) {
    src = src || "img/blank.gif";
    if (img.getAttribute("data-src") !== src) {
        img.setAttribute("data-src", src);
        img.src = src;
    }
}

var DAYS = ["Domingo", "Segunda", "Ter\u00E7a", "Quarta", "Quinta", "Sexta", "S\u00E1bado"];

var App = {
    // Ponte HTTP->HTTPS no servidor da rede local (nginx; veja a pasta server/)
    PROXY_SERVER: APP_CONFIG.bridgeUrl + "/px/" + APP_CONFIG.providerHost,
    DEFAULT_USER: APP_CONFIG.defaultUser || "",
    VERSION: "2.0.0",
    // Horario de Brasilia (sem horario de verao desde 2019); a programacao vem em UTC
    TZ_OFFSET_MIN: -180,
    EPG_TTL_MS: 15 * 60 * 1000,
    ZAP_DELAY_MS: 600,
    EPG_DELAY_MS: 350,

    widgetAPI: null,
    pluginAPI: null,
    clockOffset: 0,

    focusArea: "LOGIN", // LOGIN, GUIDE, FULLSCREEN, OVERLAY, PIN
    loginZone: "LEFT",
    leftItems: ["loginUser", "loginPass", "loginServer", "btnLogin", "btnDemo"],
    leftIndex: 1,
    activeInputId: "loginPass",
    isCaps: false,
    isLoggingIn: false,

    vkKeys: [],
    vkGrid: [],
    vkIndex: 0,
    vkPrefCol: 0,
    ime: null,
    imeActive: false,

    // Dados
    server: "",
    token: "",
    thumbBase: "",
    categories: [],
    categoriesMap: {},
    adultCategories: {},
    allChannels: [],
    currentCategory: "Todos",
    currentChannels: [],
    selectedCatIndex: 0,
    selectedChanIndex: 0,
    playingChannel: null,
    isFullscreen: false,

    // Guia
    menu: [
        { id: "home", label: "IN\u00CDCIO", icon: "home" },
        { id: "search", label: "PESQUISAR", icon: "search" },
        { id: "guide", label: "PROGRAMA\u00C7\u00C3O", icon: "calendar" },
        { id: "catalog", label: "CAT\u00C1LOGO", icon: "grid" },
        { id: "channels", label: "CATEGORIAS", icon: "tv" },
        { id: "user", label: "USU\u00C1RIO", icon: "user" }
    ],
    menuIndex: 2,
    view: "guide", // guide, search, catalog, user
    guideFocus: "CHAN", // MENU, CHAN, EPG, VIEW (paineis de pesquisa/catalogo/usuario)

    // Usuario
    userButtons: ["ubLogout", "ubRefresh", "ubPin"],
    userIndex: 0,

    // Pesquisa
    searchQuery: "",
    searchKeys: [],
    searchGrid: [],
    searchKey: 0,
    searchZone: "KB", // KB ou LIST
    searchResults: [],
    searchSel: 0,

    // Catalogo: grupos montados pelo nome do canal
    groups: [],
    catalogGroup: 0,
    catalogTile: {},

    // Troca de senha do controle parental
    pinMode: "VERIFY", // VERIFY ou CHANGE
    pinStep: 0,
    pinNew: "",
    chanMode: "CHANNELS", // CHANNELS, CATEGORIES
    catCursor: 0,
    epgSel: 0,
    epgForChannel: null,
    epgList: [],
    epgCache: {},
    epgCacheKeys: [],
    epgTimer: null,

    // Tela cheia
    zapTimer: null,
    osdTimer: null,
    overlayTimer: null,
    numBuffer: "",
    numTimer: null,
    toastTimer: null,
    preloaded: [],

    isAdultUnlocked: false,
    pinInput: "",
    pinOnSuccess: null,
    pinPrevArea: null,

    defaultM3U:
        "#EXTM3U\n" +
        "#EXTINF:-1 group-title=\"Demonstracao\",Big Buck Bunny\n" +
        "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4\n" +
        "#EXTINF:-1 group-title=\"Demonstracao\",Tears of Steel\n" +
        "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4\n" +
        "#EXTINF:-1 group-title=\"Demonstracao\",Sintel\n" +
        "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4\n" +
        "#EXTINF:-1 group-title=\"Demonstracao\",Mux HLS (via ponte)\n" +
        APP_CONFIG.bridgeUrl + "/px/test-streams.mux.dev/x36xhzz/x36xhzz.m3u8\n",

    // ======================================================================
    // Inicializacao
    // ======================================================================
    init: function() {
        RemoteKeys.init();
        if (!RemoteKeys.isTV) addClass(document.body, "pc");

        this.initSamsung();
        VideoPlayer.init();
        this.buildKeyboard();
        this.buildGuide();
        this.bindEvents();

        this.updateClock();
        setInterval(function() { App.updateClock(); }, 20000);
        setInterval(function() { App.refreshChannels(true); }, 30 * 60 * 1000);
        setInterval(function() { App.checkToken(); }, 60 * 1000);

        var token = Store.get("PLAYCHANNEL_JWT", "");
        if (Store.get("PLAYCHANNEL_LOGGED_IN", "") === "true" && token) {
            this.setSession(this.getServer(), token);
            this.showGuide();
            this.toast("Carregando canais...", true);
            this.fetchCategories(false);
        } else {
            this.showLoginScreen();
        }
    },

    initSamsung: function() {
        if (!RemoteKeys.isTV) return;
        try {
            this.widgetAPI = new Common.API.Widget();
            this.pluginAPI = new Common.API.Plugin();
        } catch (e) {
            log("[App] Common API indisponivel: " + e);
        }
        // Volume e mudo: libera as teclas para a TV (barra de volume nativa). Cada passo
        // tem o seu try para que uma falha nao impeca os outros.
        var k = RemoteKeys.tvKey;
        var volKeys = [k.KEY_VOL_UP, k.KEY_VOL_DOWN, k.KEY_MUTE];
        var i;
        for (i = 0; i < volKeys.length; i++) {
            try { if (this.pluginAPI) this.pluginAPI.unregistKey(volKeys[i]); } catch (e2) { log("[App] unregistKey: " + e2); }
            try {
                var tvmw = $("pluginObjectTVMW");
                if (tvmw && tvmw.UnregisterKey) tvmw.UnregisterKey(volKeys[i]);
            } catch (e3) { log("[App] UnregisterKey: " + e3); }
        }
        try {
            var nnavi = $("pluginObjectNNavi");
            if (nnavi && nnavi.SetBannerState) nnavi.SetBannerState(1);
        } catch (e4) { log("[App] SetBannerState: " + e4); }
        try {
            if (this.widgetAPI) this.widgetAPI.sendReadyEvent();
        } catch (e5) {}
        // O app oficial mantem a tela acordada (wakelock). Aqui desliga o protetor de tela
        // da TV enquanto o app estiver aberto.
        try {
            if (this.pluginAPI && this.pluginAPI.setOffScreenSaver) this.pluginAPI.setOffScreenSaver();
        } catch (e6) { log("[App] setOffScreenSaver: " + e6); }
    },

    // ======================================================================
    // Volume e mudo
    // Normalmente a TV trata as teclas e o app nem as recebe. Se uma delas chegar
    // aqui, e porque a TV nao assumiu: o app controla o volume pelo plugin de audio
    // e desenha a propria barra.
    // ======================================================================
    volumeTimer: null,

    volumeKey: function(action) {
        var audio = $("pluginObjectAudio");
        var vol = null;
        var muted = false;
        try {
            if (audio) {
                if (action === "MUTE") {
                    muted = !(audio.GetUserMute() === true || audio.GetUserMute() === 1);
                    audio.SetUserMute(muted);
                } else {
                    muted = audio.GetUserMute() === true || audio.GetUserMute() === 1;
                    if (muted) audio.SetUserMute(false);
                    muted = false;
                    if (audio.SetVolumeWithKey) audio.SetVolumeWithKey(action === "VOL_UP" ? 0 : 1);
                    else audio.SetVolume(Math.max(0, Math.min(100, audio.GetVolume() + (action === "VOL_UP" ? 2 : -2))));
                }
                vol = audio.GetVolume();
                if (action === "MUTE") muted = audio.GetUserMute() === true || audio.GetUserMute() === 1;
            }
        } catch (e) {
            log("[Volume] " + e);
        }
        this.showVolume(vol, muted);
    },

    showVolume: function(vol, muted) {
        var box = $("volumeBox");
        setText($("volumeLabel"), muted ? "MUDO" : (vol === null ? "Volume" : "Vol " + vol));
        $("volumeFill").style.width = (muted || vol === null ? 0 : Math.round(156 * Math.max(0, Math.min(100, vol)) / 100)) + "px";
        toggleClass(box, "muted", muted);
        box.style.display = "block";
        if (this.volumeTimer) clearTimeout(this.volumeTimer);
        this.volumeTimer = setTimeout(function() { box.style.display = "none"; }, 2500);
    },

    getServer: function() {
        return this.normalizeServer(Store.get("PLAYCHANNEL_SERVER", "") || this.PROXY_SERVER);
    },

    normalizeServer: function(srv) {
        srv = trim(srv);
        if (!srv) srv = this.PROXY_SERVER;
        if (srv.indexOf("://") === -1) srv = "http://" + srv;
        while (srv.length > 8 && srv.charAt(srv.length - 1) === "/") srv = srv.substring(0, srv.length - 1);
        if (RemoteKeys.isTV && srv.toLowerCase() === "https://" + APP_CONFIG.providerHost.toLowerCase()) srv = this.PROXY_SERVER;
        return srv;
    },

    // ======================================================================
    // Validade do login: o token JWT dura 5 horas. Renova sozinho (com a senha
    // salva) 30 minutos antes de vencer, sem interromper o canal por mais de 1 s.
    // ======================================================================
    TOKEN_RENEW_MARGIN_MS: 30 * 60 * 1000,
    tokenRenewing: false,

    withToken: function(base, token) {
        return base + (base.indexOf("?") !== -1 ? "&" : "?") + "t=" + encodeURIComponent(token);
    },

    // Instante de vencimento (ms) lido do payload do JWT; 0 se nao der para ler
    jwtExpiry: function(token) {
        try {
            var part = String(token || "").split(".")[1];
            if (!part) return 0;
            part = part.replace(/-/g, "+").replace(/_/g, "/");
            while (part.length % 4) part += "=";
            var exp = JSON.parse(window.atob(part)).exp;
            return exp ? exp * 1000 : 0;
        } catch (e) {
            return 0;
        }
    },

    checkToken: function() {
        if (!this.token || this.focusArea === "LOGIN" || this.tokenRenewing) return;
        var exp = this.jwtExpiry(this.token);
        if (exp && exp - this.now() < this.TOKEN_RENEW_MARGIN_MS) this.renewToken();
    },

    renewToken: function(then) {
        var user = Store.get("PLAYCHANNEL_USER", "");
        var pass = Store.get("PLAYCHANNEL_PASS", "");
        if (!user || !pass || !this.server || this.tokenRenewing) { if (then) then(false); return; }
        this.tokenRenewing = true;
        var srv = this.server;
        var body = JSON.stringify({ username: user, password: pass, location: { latitude: null, longitude: null } });
        Http.request("POST", srv + "/auth", {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-app-type": "app"
        }, body, 20000, function(status, text, timedOut, date) {
            App.tokenRenewing = false;
            App.syncClock(date);
            var data = null;
            try { data = JSON.parse(text); } catch (e) {}
            if (status === 200 && data && data.token) {
                App.applyNewToken(data.token);
                if (then) then(true);
            } else {
                log("[Token] renovacao falhou: " + status);
                if (then) then(false);
            }
        });
    },

    applyNewToken: function(token) {
        this.token = token;
        Store.set("PLAYCHANNEL_JWT", token);
        for (var i = 0; i < this.allChannels.length; i++) {
            var ch = this.allChannels[i];
            if (ch.hlsBase) ch.url = this.withToken(ch.hlsBase, token);
        }
        var cur = this.playingChannel;
        if (cur && cur.url && VideoPlayer.state !== "STOPPED") VideoPlayer.play(cur.url);
    },

    // O servidor recusou o token no meio do video: renova e reabre o canal
    onStreamAuthFailed: function() {
        var self = this;
        this.renewToken(function(ok) {
            if (!ok) self.toast("Sess\u00E3o expirada. Entre novamente (amarelo = trocar conta).", true);
        });
    },

    setSession: function(srv, token) {
        this.server = srv;
        this.token = token;
        var i = srv.indexOf("/px/");
        this.thumbBase = i > 0 ? srv.substring(0, i) + "/thumb/" : "";
    },

    // ======================================================================
    // Hora (sincronizada com o servidor)
    // ======================================================================
    syncClock: function(dateHeader) {
        if (!dateHeader) return;
        var t = Date.parse(dateHeader);
        if (!isNaN(t)) this.clockOffset = t - new Date().getTime();
    },

    now: function() {
        return new Date().getTime() + this.clockOffset;
    },

    // Date "deslocada" para o fuso local: ler sempre com getUTC*
    local: function(ms) {
        return new Date(ms + this.TZ_OFFSET_MIN * 60000);
    },

    fmtHM: function(ms) {
        var d = this.local(ms);
        return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
    },

    fmtDuration: function(ms) {
        var m = Math.round(ms / 60000);
        if (m < 60) return m + "m";
        var h = Math.floor(m / 60);
        var r = m % 60;
        return h + "h" + (r ? r + "m" : "");
    },

    parseEpgTime: function(s) {
        var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || "");
        if (!m) return 0;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    },

    updateClock: function() {
        setText($("sideClock"), this.fmtHM(this.now()));
    },

    toast: function(msg, persistent) {
        var el = $("toast");
        if (this.toastTimer) clearTimeout(this.toastTimer);
        if (!msg) {
            el.style.display = "none";
            return;
        }
        setText(el, msg);
        el.style.display = "block";
        if (!persistent) this.toastTimer = setTimeout(function() { el.style.display = "none"; }, 4000);
    },

    // ======================================================================
    // Tela de login
    // ======================================================================
    showLoginScreen: function() {
        VideoPlayer.stop();
        this.focusArea = "LOGIN";
        this.hideAllPlayerUi();
        $("guideScreen").style.display = "none";
        $("loginScreen").style.display = "block";

        $("loginUser").value = Store.get("PLAYCHANNEL_USER", this.DEFAULT_USER);
        $("loginPass").value = "";
        $("loginServer").value = this.getServer();

        var inputs = ["loginUser", "loginPass", "loginServer"];
        for (var i = 0; i < inputs.length; i++) $(inputs[i]).setAttribute("readonly", "readonly");

        this.setActiveInput($("loginUser").value ? "loginPass" : "loginUser");
        this.loginZone = "LEFT";
        this.leftIndex = $("loginUser").value ? 1 : 0;
        this.updateLoginFocus();
        this.focusAnchor();
    },

    setActiveInput: function(id) {
        this.activeInputId = id;
        var names = { loginUser: "Usu\u00E1rio", loginPass: "Senha", loginServer: "Servidor" };
        setText($("vkTargetLabel"), names[id] || "");
        var inputs = ["loginUser", "loginPass", "loginServer"];
        for (var i = 0; i < inputs.length; i++) toggleClass($(inputs[i]), "input-active", inputs[i] === id);
        this.updatePreview();
    },

    updatePreview: function() {
        var inp = $(this.activeInputId);
        if (!inp) return;
        var v = inp.value;
        if (this.activeInputId === "loginPass") {
            var masked = "";
            for (var i = 0; i < v.length - 1; i++) masked += "\u2022";
            if (v.length > 0) masked += v.charAt(v.length - 1);
            v = masked;
        }
        setText($("vkPreview"), v + "_");
    },

    updateLoginFocus: function() {
        var i;
        for (i = 0; i < this.leftItems.length; i++) removeClass($(this.leftItems[i]), "focused");
        for (i = 0; i < this.vkKeys.length; i++) removeClass(this.vkKeys[i].el, "focused");
        if (this.loginZone === "LEFT") addClass($(this.leftItems[this.leftIndex]), "focused");
        else addClass(this.vkKeys[this.vkIndex].el, "focused");
    },

    focusAnchor: function() {
        try { $("keyAnchor").focus(); } catch (e) {}
    },

    buildKeyboard: function() {
        var rows = [
            "1234567890".split(""),
            "qwertyuiop".split(""),
            "asdfghjkl-".split(""),
            "zxcvbnm.@_".split("")
        ];
        var container = $("vkKeys");
        container.innerHTML = "";
        this.vkKeys = [];
        this.vkGrid = [];

        var self = this;
        var addKey = function(label, type, value, row, col, span) {
            var el = document.createElement("div");
            el.className = "vk-key" + (label.length > 1 ? " vk-small" : "");
            el.style.left = (col * 68) + "px";
            el.style.top = (row * 66) + "px";
            el.style.width = (span * 68 - 10) + "px";
            setText(el, label);
            var idx = self.vkKeys.length;
            el.onclick = function() {
                self.loginZone = "KB";
                self.vkIndex = idx;
                self.updateLoginFocus();
                self.pressKey(idx);
            };
            container.appendChild(el);
            self.vkKeys.push({ el: el, type: type, value: value, row: row, col: col, span: span });
            if (!self.vkGrid[row]) self.vkGrid[row] = [];
            for (var c = col; c < col + span; c++) self.vkGrid[row][c] = idx;
        };

        for (var r = 0; r < rows.length; r++) {
            for (var c = 0; c < rows[r].length; c++) addKey(rows[r][c], "char", rows[r][c], r, c, 1);
        }
        addKey("CAPS", "caps", null, 4, 0, 2);
        addKey("ESPA\u00C7O", "char", " ", 4, 2, 3);
        addKey("APAGAR", "back", null, 4, 5, 2);
        addKey("OK / ENTRAR", "ok", null, 4, 7, 3);
    },

    pressKey: function(idx) {
        var key = this.vkKeys[idx];
        if (!key) return;
        if (key.type === "char") this.vkType(key.value);
        else if (key.type === "back") this.vkBackspace();
        else if (key.type === "caps") this.vkToggleCaps();
        else if (key.type === "ok") this.vkOk();
    },

    vkType: function(ch) {
        var inp = $(this.activeInputId);
        if (!inp) return;
        inp.value += this.isCaps ? ch.toUpperCase() : ch;
        this.hideLoginAlert();
        this.updatePreview();
    },

    vkBackspace: function() {
        var inp = $(this.activeInputId);
        if (!inp || !inp.value) return;
        inp.value = inp.value.substring(0, inp.value.length - 1);
        this.updatePreview();
    },

    vkToggleCaps: function() {
        this.isCaps = !this.isCaps;
        for (var i = 0; i < this.vkKeys.length; i++) {
            var k = this.vkKeys[i];
            if (k.type === "char" && /[a-z]/.test(k.value)) setText(k.el, this.isCaps ? k.value.toUpperCase() : k.value);
            if (k.type === "caps") toggleClass(k.el, "vk-on", this.isCaps);
        }
    },

    vkOk: function() {
        if (this.activeInputId === "loginUser") {
            this.setActiveInput("loginPass");
        } else {
            this.loginZone = "LEFT";
            this.leftIndex = 3;
            this.updateLoginFocus();
            this.doLogin();
        }
    },

    activateLeftItem: function() {
        var id = this.leftItems[this.leftIndex];
        if (id === "btnLogin") { this.doLogin(); return; }
        if (id === "btnDemo") { this.doDemoLogin(); return; }
        this.setActiveInput(id);
        if (!this.openNativeKeyboard(id)) {
            this.loginZone = "KB";
            this.vkIndex = 0;
            this.updateLoginFocus();
        }
    },

    handleLoginKey: function(k) {
        var a = k.action;
        if (a === "DIGIT" || a === "CHAR") { this.vkType(k.value); return true; }
        if (a === "BACKSPACE" || a === "RED") { this.vkBackspace(); return true; }
        if (a === "YELLOW") { this.doDemoLogin(); return true; }

        if (this.loginZone === "LEFT") {
            if (a === "UP") {
                if (this.leftIndex > 0) this.leftIndex--;
            } else if (a === "DOWN") {
                if (this.leftIndex < this.leftItems.length - 1) this.leftIndex++;
            } else if (a === "RIGHT") {
                this.loginZone = "KB";
                this.vkIndex = this.vkGrid[Math.min(this.leftIndex, 4)][0];
                this.vkPrefCol = 0;
            } else if (a === "ENTER") {
                this.activateLeftItem();
                return true;
            } else {
                return false; // RETURN no login fecha o app
            }
            if (this.leftIndex <= 2) this.setActiveInput(this.leftItems[this.leftIndex]);
            this.updateLoginFocus();
            return true;
        }

        var key = this.vkKeys[this.vkIndex];
        var maxRow = this.vkGrid.length - 1;
        if (a === "LEFT") {
            if (key.col === 0) {
                this.loginZone = "LEFT";
                var map = { loginUser: 0, loginPass: 1, loginServer: 2 };
                this.leftIndex = map[this.activeInputId] !== undefined ? map[this.activeInputId] : 1;
            } else {
                this.vkIndex = this.vkGrid[key.row][key.col - 1];
                this.vkPrefCol = this.vkKeys[this.vkIndex].col;
            }
        } else if (a === "RIGHT") {
            var next = key.col + key.span;
            if (next <= 9) {
                this.vkIndex = this.vkGrid[key.row][next];
                this.vkPrefCol = this.vkKeys[this.vkIndex].col;
            }
        } else if (a === "UP") {
            if (key.row > 0) this.vkIndex = this.vkGrid[key.row - 1][Math.min(this.vkPrefCol, 9)];
        } else if (a === "DOWN") {
            if (key.row < maxRow) this.vkIndex = this.vkGrid[key.row + 1][Math.min(this.vkPrefCol, 9)];
        } else if (a === "ENTER") {
            this.pressKey(this.vkIndex);
        } else if (a === "RETURN") {
            this.loginZone = "LEFT";
        } else {
            return false;
        }
        this.updateLoginFocus();
        return true;
    },

    // ======================================================================
    // Teclado nativo da TV (IME do Smart Hub)
    // ======================================================================
    openNativeKeyboard: function(id) {
        if (!RemoteKeys.isTV) return false;
        var inp = $(id);
        var self = this;
        var tvKey = RemoteKeys.tvKey;
        try {
            if (typeof IMEShell_Common === "function") {
                var imeC = new IMEShell_Common();
                imeC.inputboxID = id;
                imeC.inputTitle = id === "loginPass" ? "Senha" : (id === "loginUser" ? "Usuario" : "Servidor");
                imeC.context = this;
                imeC.onKeyPressFunc = function(keyCode) {
                    if (keyCode === tvKey.KEY_ENTER || keyCode === tvKey.KEY_RETURN || keyCode === tvKey.KEY_EXIT) {
                        setTimeout(function() { self.closeNativeKeyboard(); }, 0);
                    }
                    return true;
                };
                imeC.onCompleteFunc = function() {
                    setTimeout(function() { self.closeNativeKeyboard(); }, 0);
                };
                inp.removeAttribute("readonly");
                inp.focus();
                imeC.onShow();
                this.ime = imeC;
                this.imeActive = true;
                return true;
            }
            if (typeof IMEShell === "function") {
                inp.removeAttribute("readonly");
                this.imeActive = true;
                this.ime = new IMEShell(id, function(imeObj) {
                    var done = function() {
                        setTimeout(function() { self.closeNativeKeyboard(); }, 0);
                        return false;
                    };
                    try {
                        imeObj.setKeyFunc(tvKey.KEY_ENTER, done);
                        imeObj.setKeyFunc(tvKey.KEY_RETURN, done);
                        imeObj.setKeyFunc(tvKey.KEY_EXIT, done);
                        imeObj.setKeypadPos(470, 90);
                    } catch (e) {}
                    inp.focus();
                }, "en");
                return true;
            }
        } catch (err) {
            log("[IME] falhou: " + err);
        }
        this.imeActive = false;
        if (inp) inp.setAttribute("readonly", "readonly");
        return false;
    },

    closeNativeKeyboard: function() {
        if (!this.imeActive) return;
        this.imeActive = false;
        var inp = $(this.activeInputId);
        try {
            if (this.ime && this.ime.onClose) this.ime.onClose();
        } catch (e) {}
        this.ime = null;
        if (inp) {
            inp.setAttribute("readonly", "readonly");
            try { inp.blur(); } catch (e2) {}
        }
        this.focusAnchor();
        this.updatePreview();
        if (this.activeInputId === "loginUser") {
            this.leftIndex = 1;
            this.setActiveInput("loginPass");
        } else if (this.activeInputId === "loginPass") {
            this.leftIndex = 3;
        }
        this.loginZone = "LEFT";
        this.updateLoginFocus();
    },

    // ======================================================================
    // Autenticacao Play Channel
    // ======================================================================
    showLoginAlert: function(msg) {
        var box = $("loginAlert");
        setText(box, msg);
        box.style.display = "block";
    },

    hideLoginAlert: function() {
        $("loginAlert").style.display = "none";
    },

    setLoginBusy: function(busy) {
        this.isLoggingIn = busy;
        setText($("loginBtnText"), busy ? "CONECTANDO..." : "ENTRAR");
    },

    doLogin: function() {
        if (this.isLoggingIn) return;
        var user = trim($("loginUser").value);
        var pass = trim($("loginPass").value);
        var srv = this.normalizeServer($("loginServer").value);
        $("loginServer").value = srv;

        if (!user || !pass) {
            this.showLoginAlert("Preencha o usu\u00E1rio e a senha.");
            this.setActiveInput(user ? "loginPass" : "loginUser");
            return;
        }
        this.hideLoginAlert();
        this.setLoginBusy(true);

        if (srv.indexOf("/px/") !== -1 || srv.indexOf(APP_CONFIG.providerHost) !== -1 || srv.indexOf("cdn.tv.br") !== -1) {
            this.authenticate(srv, user, pass, function(ok, msg) {
                App.setLoginBusy(false);
                if (!ok) App.showLoginAlert(msg);
            });
        } else {
            this.loginXtream(srv, user, pass);
        }
    },

    authenticate: function(srv, user, pass, done) {
        var body = JSON.stringify({ username: user, password: pass, location: { latitude: null, longitude: null } });
        Http.request("POST", srv + "/auth", {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "x-app-type": "app"
        }, body, 20000, function(status, text, timedOut, date) {
            var data = null;
            try { data = JSON.parse(text); } catch (e) {}
            App.syncClock(date);

            if (status === 200 && data && data.token) {
                Store.set("PLAYCHANNEL_LOGGED_IN", "true");
                Store.set("PLAYCHANNEL_AUTH_TYPE", "PLAYCHANNEL");
                Store.set("PLAYCHANNEL_JWT", data.token);
                Store.set("PLAYCHANNEL_USER", data.username || user);
                Store.set("PLAYCHANNEL_PASS", pass);
                Store.set("PLAYCHANNEL_SERVER", srv);
                if (data.rtoken) Store.set("PLAYCHANNEL_RTOKEN", data.rtoken);
                done(true, "");
                App.setSession(srv, data.token);
                App.showGuide();
                App.toast("Carregando canais...", true);
                App.fetchCategories(false);
                return;
            }

            var msg;
            if (timedOut) {
                msg = "Tempo esgotado ao conectar em " + srv + ". Verifique se a ponte " + APP_CONFIG.bridgeUrl + " est\u00E1 ativa.";
            } else if (status === 0) {
                msg = "Sem conex\u00E3o com " + srv + ". A TV n\u00E3o abre HTTPS: use o endere\u00E7o da ponte (" + App.PROXY_SERVER + ").";
            } else if (status === 429 || (text && text.indexOf("Too Many Sessions") !== -1)) {
                msg = "Limite de sess\u00F5es atingido. Feche o Play Channel em outro aparelho e tente de novo em 1-2 minutos.";
            } else if (status === 401) {
                msg = "Usu\u00E1rio ou senha incorretos.";
            } else if (status === 403) {
                msg = "Usu\u00E1rio bloqueado pelo provedor.";
            } else if (status === 404 || status === 502 || status === 504) {
                msg = "Ponte de rede indispon\u00EDvel (HTTP " + status + "). Verifique o servidor " + APP_CONFIG.bridgeUrl + ".";
            } else {
                msg = (data && (data.message || data.error)) || ("Erro do servidor (HTTP " + status + ").");
            }
            done(false, msg);
        });
    },

    loginXtream: function(srv, user, pass) {
        var m3uUrl = srv + "/get.php?username=" + encodeURIComponent(user) + "&password=" + encodeURIComponent(pass) + "&type=m3u_plus";
        Store.set("PLAYCHANNEL_LOGGED_IN", "true");
        Store.set("PLAYCHANNEL_AUTH_TYPE", "M3U");
        Store.set("PLAYCHANNEL_USER", user);
        Store.set("PLAYCHANNEL_SERVER", srv);
        Store.set("PLAYCHANNEL_M3U_URL", m3uUrl);
        this.setLoginBusy(false);
        this.setSession(srv, "");
        this.showGuide();
        this.fetchPlaylist(m3uUrl);
    },

    doDemoLogin: function() {
        Store.remove("PLAYCHANNEL_LOGGED_IN");
        this.setSession("", "");
        this.showGuide();
        setText($("sideUser"), "Modo demonstra\u00E7\u00E3o");
        this.processPlaylistData(this.defaultM3U);
    },

    logout: function() {
        VideoPlayer.stop();
        this.isAdultUnlocked = false;
        this.playingChannel = null;
        this.epgCache = {};
        this.epgCacheKeys = [];
        this.view = "guide";
        this.menuIndex = 2;
        this.guideFocus = "CHAN";
        this.searchQuery = "";
        this.searchResults = [];
        Store.remove("PLAYCHANNEL_LOGGED_IN");
        Store.remove("PLAYCHANNEL_JWT");
        Store.remove("PLAYCHANNEL_PASS");
        Store.remove("PLAYCHANNEL_RTOKEN");
        this.showLoginScreen();
    },

    // ======================================================================
    // Canais
    // ======================================================================
    refreshChannels: function(isBackground) {
        if (this.focusArea === "LOGIN") return;
        var authType = Store.get("PLAYCHANNEL_AUTH_TYPE", "PLAYCHANNEL");
        if (!isBackground) this.toast("Atualizando lista de canais...", true);
        if (authType === "PLAYCHANNEL" && this.token) {
            this.fetchCategories(isBackground);
        } else {
            var m3u = Store.get("PLAYCHANNEL_M3U_URL", "");
            if (m3u) this.fetchPlaylist(m3u);
        }
    },

    fetchCategories: function(isBackground) {
        var srv = this.server;
        var token = this.token;
        Http.request("GET", srv + "/categories?t=" + encodeURIComponent(token), {
            "Accept": "application/json",
            "x-app-type": "app"
        }, null, 30000, function(status, text, timedOut, date) {
            App.syncClock(date);
            App.updateClock();
            if (status === 200) {
                var list = null;
                try { list = JSON.parse(text); } catch (e) {}
                if (list && list.length) {
                    App.processPlayChannelData(list, isBackground);
                    App.toast("");
                    return;
                }
            }
            if (status === 401) {
                var user = Store.get("PLAYCHANNEL_USER", "");
                var pass = Store.get("PLAYCHANNEL_PASS", "");
                if (user && pass) {
                    App.toast("Sess\u00E3o expirada, reconectando...", true);
                    App.authenticate(srv, user, pass, function(ok, msg) {
                        if (!ok) { App.logout(); App.showLoginAlert(msg); }
                    });
                    return;
                }
                App.logout();
                return;
            }
            if (!isBackground) App.toast("Falha ao carregar canais (HTTP " + status + "). Aperte D (azul) para tentar de novo.", true);
        });
    },

    processPlayChannelData: function(list, isBackground) {
        var srv = this.server;
        var token = this.token;
        var categories = [];
        var map = {};
        var adult = {};
        var all = [];
        var seen = {};
        var logoPaths = [];
        var logoSeen = {};

        for (var i = 0; i < list.length; i++) {
            var cat = list[i];
            var catName = cat.name || ("Categoria " + cat.id);
            var catAdult = this.isAdultContent(catName, cat.rating);
            if (catAdult) adult[catName] = true;
            if (!map[catName]) {
                categories.push(catName);
                map[catName] = [];
            }
            var chans = cat.channels || [];
            for (var j = 0; j < chans.length; j++) {
                var ch = chans[j];
                var obj = seen[ch.id];
                if (!obj) {
                    var base = "";
                    if (ch.hls) base = /^https?:\/\//.test(ch.hls) ? ch.hls : srv + ch.hls;
                    obj = {
                        id: ch.id,
                        uid: ch.uid || "",
                        name: ch.name || "Canal",
                        number: ch.number || (j + 1),
                        group: catName,
                        hlsBase: base,
                        url: base ? this.withToken(base, token) : "",
                        aonly: !!ch.aonly,
                        logoPath: ch.logo && !/^https?:\/\//.test(ch.logo) ? ch.logo : "",
                        logoAbs: ch.logo && /^https?:\/\//.test(ch.logo) ? ch.logo : "",
                        guide: ch.guide || (ch.uid ? "/channels/" + ch.uid + "/guide" : ""),
                        isAdult: catAdult || this.isAdultContent(ch.name, ch.rating)
                    };
                    seen[ch.id] = obj;
                    all.push(obj);
                    if (obj.logoPath && !logoSeen[obj.logoPath]) {
                        logoSeen[obj.logoPath] = true;
                        logoPaths.push(obj.logoPath);
                    }
                }
                map[catName].push(obj);
            }
        }

        // A API so tem "Todos" e "Adultos": os grupos vem do nome de cada canal
        var grouped = this.buildGroups(all, categories, map, adult);

        this.prewarmThumbs(logoPaths);
        this.applyLists(grouped.categories, grouped.map, adult, all, isBackground);
    },

    // Ordem de exibicao dos grupos
    GROUP_ORDER: ["TV Aberta", "Not\u00EDcias", "Esportes", "Filmes", "Filmes 24 Horas", "S\u00E9ries", "Novelas",
        "Streaming", "Infantil", "Desenhos 24 Horas", "Document\u00E1rios", "Variedades", "M\u00FAsica",
        "Religiosos", "P\u00FAblicos e Educativos", "Outros", "Adultos"],

    // Regras em ordem: a primeira que casar define o grupo (nome sem acento, minusculo)
    GROUP_RULES: [
        ["Filmes 24 Horas", /(^|\s)24 ?h(oras)?\b.*filme|filme.*24 ?h|^top (film|action|family)/],
        ["Desenhos 24 Horas", /(^|\s)24 ?h(oras)?\b|chaves|simpsons|futurama|bob esponja|dragon ball|caverna do dragao|familia da pesada|american dad|rick e morty|pica.?pau|tom e jerry|pokemon|naruto|pantera cor de rosa/],
        ["Not\u00EDcias", /news|noticia|cnn|jovem pan|globonews|bandnews|record news/],
        ["Esportes", /sportv|espn|premiere|combate|^ge ?tv|band ?sports|fox sports|dazn|tnt sports|sporty|xsports|canal off|esporte/],
        ["TV Aberta", /^(globo|sbt|record|band|redetv|rede tv|intertv|tv cultura|cultura|gazeta|tv aparecida tv)\b|^(rede )?globo /],
        ["P\u00FAblicos e Educativos", /senado|justica|camara|tv brasil|educacao|canal gov|tv escola|futura/],
        ["Religiosos", /cancao nova|novo tempo|rede vida|aparecida|rede seculo|evangel|gospel|\brit\b/],
        ["Novelas", /novela/],
        ["Streaming", /paramount ?\+|disney ?\+|prime video|amazon|netflix|^max\b|star ?\+/],
        ["Infantil", /gloob|discovery kids|cartoon|nick|disney (jr|junior|channel)|baby ?tv|tooncast|boomerang|zoomoo|infantil/],
        ["Document\u00E1rios", /discovery|history|nat ?geo|animal planet|investigacao|smithsonian|curiosity/],
        ["Filmes", /telecine|hbo|megapix|cinemax|studio universal|^space\b|^tnt$|paramount channel|star channel|\bamc\b|\btcm\b|canal brasil|filme/],
        ["S\u00E9ries", /series|warner|universal tv|^sony|\baxn\b|a&e|^fx\b|adult swim|sobrenatural|lifetime|operacao/],
        ["Variedades", /multishow|gnt|\btlc\b|food network|hgtv|viva|^bis$|comedy|^e!$/],
        ["M\u00FAsica", /clipstation|^pop |top brasil|top internacional|funk|hip hop|pagode|sertanej|forro|mpb|rock|reggae|jazz|axe|romantica|barzinho|academia|metal|trap|anos (80|90)|^mtv|music/]
    ],

    plain: function(s) {
        var map = { "\u00E1": "a", "\u00E0": "a", "\u00E2": "a", "\u00E3": "a", "\u00E4": "a", "\u00E9": "e", "\u00EA": "e",
            "\u00E8": "e", "\u00ED": "i", "\u00EC": "i", "\u00EE": "i", "\u00F3": "o", "\u00F4": "o", "\u00F5": "o",
            "\u00F2": "o", "\u00F6": "o", "\u00FA": "u", "\u00F9": "u", "\u00FC": "u", "\u00E7": "c", "\u00F1": "n" };
        return String(s || "").toLowerCase().replace(/[\u00E0-\u00FC]/g, function(c) { return map[c] || c; });
    },

    classify: function(ch, adultCats) {
        if (ch.isAdult || (adultCats && adultCats[ch.group])) return "Adultos";
        var n = this.plain(ch.name);
        var rules = this.GROUP_RULES;
        if (rules[0][1].test(n)) return rules[0][0];
        // Faixas de numeracao do provedor: 600-699 e 1000+ sao canais de clipes
        // (ex.: o 610 "Infantil" e um canal de musica, nao de desenhos)
        var num = Number(ch.number);
        if ((num >= 600 && num < 700) || num >= 1000) return "M\u00FAsica";
        for (var i = 1; i < rules.length; i++) {
            if (rules[i][1].test(n)) return rules[i][0];
        }
        return "Outros";
    },

    buildGroups: function(all, apiCategories, apiMap, adult) {
        var map = { "Todos": all };
        var names = [];
        var i;
        for (i = 0; i < all.length; i++) {
            var g = this.classify(all[i], adult);
            all[i].catalogGroup = g;
            if (!map[g]) {
                map[g] = [];
                names.push(g);
            }
            map[g].push(all[i]);
        }
        var order = this.GROUP_ORDER;
        var self = this;
        names.sort(function(a, b) {
            var ia = self.indexOf(order, a);
            var ib = self.indexOf(order, b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        // Categorias proprias da API (alem de Todos/Adultos) continuam disponiveis
        for (i = 0; i < apiCategories.length; i++) {
            var c = apiCategories[i];
            if (c === "Todos" || map[c]) continue;
            map[c] = apiMap[c];
            names.push(c);
        }
        if (map["Adultos"]) adult["Adultos"] = true;
        // Dentro de cada grupo: ordem pelo numero do canal
        for (var key in map) {
            if (map.hasOwnProperty(key) && key !== "Todos") {
                map[key].sort(function(a, b) { return Number(a.number) - Number(b.number); });
            }
        }
        return { categories: ["Todos"].concat(names), map: map };
    },

    // Pede ao servidor para gerar as miniaturas de todos os logos em segundo plano
    prewarmThumbs: function(paths) {
        if (!this.thumbBase || !paths.length) return;
        Http.request("POST", this.thumbBase + "prewarm", { "Content-Type": "application/json" },
            JSON.stringify({ sizes: ["40x40", "72x72"], paths: paths }), 15000, function() {});
    },

    logoUrl: function(ch, size) {
        if (!ch) return "";
        if (ch.logoPath) {
            if (this.thumbBase) return this.thumbBase + size + "x" + size + ch.logoPath;
            return this.server + ch.logoPath + "?apptype=app";
        }
        return ch.logoAbs || "";
    },

    fetchPlaylist: function(url) {
        this.toast("Carregando lista...", true);
        Http.request("GET", url, {}, null, 30000, function(status, text) {
            if (status === 200 && text) {
                App.processPlaylistData(text);
                App.toast("");
            } else {
                App.toast("Falha ao carregar a lista (HTTP " + status + ").", true);
            }
        });
    },

    processPlaylistData: function(text) {
        var parsed = M3UParser.parse(text);
        var adult = {};
        for (var i = 0; i < parsed.categories.length; i++) {
            if (this.isAdultContent(parsed.categories[i], 0)) adult[parsed.categories[i]] = true;
        }
        for (var j = 0; j < parsed.allChannels.length; j++) {
            var c = parsed.allChannels[j];
            c.isAdult = !!adult[c.group] || this.isAdultContent(c.name, 0);
            c.number = c.number || (j + 1);
            c.logoAbs = c.logo || "";
            c.logoPath = "";
            c.guide = "";
        }
        this.applyLists(parsed.categories, parsed.categoriesMap, adult, parsed.allChannels, false);
    },

    applyLists: function(categories, map, adult, all, isBackground) {
        var keepId = isBackground && this.currentChannels[this.selectedChanIndex] ? this.currentChannels[this.selectedChanIndex].id : null;
        this.categories = categories;
        this.categoriesMap = map;
        this.adultCategories = adult;
        this.allChannels = all;
        if (!isBackground) {
            this.catalogGroup = 0;
            this.catalogTile = {};
        }
        if (this.view !== "guide") this.renderView();

        if (isBackground && map[this.currentCategory]) {
            this.currentChannels = map[this.currentCategory];
            this.selectedCatIndex = Math.max(0, this.indexOf(categories, this.currentCategory));
            this.selectedChanIndex = Math.max(0, this.findChannelIndex(this.currentChannels, keepId));
            if (this.playingChannel) this.playingChannel = this.findById(this.playingChannel.id) || this.playingChannel;
            this.renderGuide();
            return;
        }

        this.currentCategory = "Todos";
        this.currentChannels = all;
        this.selectedCatIndex = 0;
        this.chanMode = "CHANNELS";
        this.guideFocus = "CHAN";

        // Volta para o ultimo canal assistido (ou o primeiro livre)
        var lastId = Store.get("PLAYCHANNEL_LAST_CH", "");
        var start = lastId ? this.findChannelIndex(all, lastId) : -1;
        if (start < 0 || all[start].isAdult) {
            start = 0;
            for (var k = 0; k < all.length; k++) {
                if (!all[k].isAdult) { start = k; break; }
            }
        }
        this.selectedChanIndex = start;
        this.renderGuide();
        if (all.length && !all[start].isAdult) this.playChannel(all[start]);
        this.scheduleEpg(0);
    },

    indexOf: function(arr, v) {
        for (var i = 0; i < arr.length; i++) if (arr[i] === v) return i;
        return -1;
    },

    findChannelIndex: function(list, id) {
        if (id === null || id === undefined || id === "") return -1;
        for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) return i;
        return -1;
    },

    findById: function(id) {
        var i = this.findChannelIndex(this.allChannels, id);
        return i >= 0 ? this.allChannels[i] : null;
    },

    isAdultContent: function(name, rating) {
        if (rating >= 18) return true;
        if (!name) return false;
        var n = String(name).toLowerCase().replace("adult swim", "");
        var words = ["adult", "adulto", "xxx", "18+", "+18", "erotic", "er\u00F3tic", "playboy", "venus", "sexy",
            "prive", "priv\u00E9", "sextreme", "hustler", "redlight", "brazzers", "penthouse"];
        for (var i = 0; i < words.length; i++) if (n.indexOf(words[i]) !== -1) return true;
        return false;
    },

    // ======================================================================
    // Programacao (EPG) com cache
    // ======================================================================
    getEpg: function(ch, cb) {
        if (!ch || !ch.guide || !this.token) { cb([]); return; }
        var hit = this.epgCache[ch.id];
        if (hit && this.now() - hit.t < this.EPG_TTL_MS) { cb(hit.list); return; }
        if (hit && hit.loading) { hit.waiters.push(cb); return; }

        var entry = { t: 0, list: hit ? hit.list : [], loading: true, waiters: [cb] };
        this.epgCache[ch.id] = entry;
        Http.request("GET", this.server + ch.guide + "?t=" + encodeURIComponent(this.token), {
            "Accept": "application/json",
            "x-app-type": "app"
        }, null, 15000, function(status, text, timedOut, date) {
            App.syncClock(date);
            var list = [];
            if (status === 200) {
                try { list = App.normalizeEpg(JSON.parse(text)); } catch (e) {}
            }
            entry.loading = false;
            entry.list = list;
            entry.t = status === 200 ? App.now() : App.now() - App.EPG_TTL_MS + 60000; // erro: tenta de novo em 1 min
            App.rememberEpgKey(ch.id);
            var w = entry.waiters;
            entry.waiters = [];
            for (var i = 0; i < w.length; i++) w[i](list);
        });
    },

    normalizeEpg: function(raw) {
        var out = [];
        if (!raw || !raw.length) return out;
        for (var i = 0; i < raw.length; i++) {
            var p = raw[i];
            var start = this.parseEpgTime(p.start);
            var stop = this.parseEpgTime(p.stop);
            if (!start || !stop) continue;
            out.push({ title: p.title || "", desc: p.desc || "", category: p.category || "", start: start, stop: stop });
        }
        return out;
    },

    rememberEpgKey: function(id) {
        var keys = this.epgCacheKeys;
        var at = this.indexOf(keys, id);
        if (at !== -1) keys.splice(at, 1);
        keys.push(id);
        while (keys.length > 60) delete this.epgCache[keys.shift()];
    },

    // Indice do programa no ar (ou o proximo)
    nowIndex: function(list) {
        var now = this.now();
        for (var i = 0; i < list.length; i++) if (list[i].stop > now) return i;
        return -1;
    },

    scheduleEpg: function(delay) {
        var self = this;
        if (this.epgTimer) clearTimeout(this.epgTimer);
        var ch = this.chanMode === "CHANNELS" ? this.currentChannels[this.selectedChanIndex] : null;
        this.epgForChannel = ch;
        this.epgList = [];
        this.epgSel = 0;
        this.renderEpgHeader(ch);
        this.renderEpg();
        if (!ch) return;
        this.epgTimer = setTimeout(function() {
            self.getEpg(ch, function(list) {
                if (self.epgForChannel !== ch) return;
                var ni = self.nowIndex(list);
                self.epgList = ni > 0 ? list.slice(ni) : list;
                self.epgSel = 0;
                self.renderEpg();
            });
        }, delay === undefined ? this.EPG_DELAY_MS : delay);
    },

    // ======================================================================
    // Guia: construcao e renderizacao
    // ======================================================================
    buildGuide: function() {
        var self = this;
        var menuEl = $("menuList");
        menuEl.innerHTML = "";
        this.menuEls = [];
        for (var m = 0; m < this.menu.length; m++) {
            (function(i) {
                var item = self.menu[i];
                var el = document.createElement("div");
                el.className = "menu-item";
                var img = document.createElement("img");
                img.src = "img/ic_" + item.icon + ".png";
                el.appendChild(img);
                textNode(el, "", "span").data = item.label;
                el.onclick = function() { self.menuIndex = i; self.guideFocus = "MENU"; self.activateMenu(); };
                menuEl.appendChild(el);
                self.menuEls.push({ el: el, img: img, icon: item.icon });
            })(m);
        }

        this.chanPool = new RowPool($("chanRows"), 12, function(i) {
            var el = document.createElement("div");
            el.className = "crow";
            var row = { el: el, num: textNode(el, "crow-num"), name: textNode(el, "crow-name") };
            el.onclick = function() { self.onChanRowClick(row); };
            return row;
        });

        this.epgPool = new RowPool($("epgRows"), 10, function() {
            var el = document.createElement("div");
            el.className = "erow";
            var title = textNode(el, "erow-title");
            var time = document.createElement("div");
            time.className = "erow-time";
            el.appendChild(time);
            return { el: el, title: title, time: time };
        });

        this.overlayPool = new RowPool($("overlayRows"), 10, function() {
            var el = document.createElement("div");
            el.className = "orow";
            var img = document.createElement("img");
            img.src = "img/blank.gif";
            img.onerror = function() { this.onerror = null; this.src = "img/blank.gif"; };
            el.appendChild(img);
            var row = { el: el, img: img, name: textNode(el, "orow-name") };
            el.onclick = function() { if (row.key !== null) { self.selectedChanIndex = row.key; self.overlayEnter(); } };
            return row;
        });

        $("epgLogo").onerror = function() { this.src = "img/blank.gif"; addClass($("epgHeader"), "nologo"); };
        $("osdLogo").onerror = function() { this.src = "img/blank.gif"; };

        this.buildSearch();
        this.buildCatalog();
        var ub = this.userButtons;
        for (var u = 0; u < ub.length; u++) {
            (function(i) {
                $(ub[i]).onclick = function() {
                    self.guideFocus = "VIEW";
                    self.userIndex = i;
                    self.handleUserKey({ action: "ENTER" });
                };
            })(u);
        }
    },

    /**
     * Indices visiveis de uma lista circular: a selecao fica fixa na linha "anchor"
     * e a lista gira em volta dela (cima no primeiro vai para o ultimo).
     */
    windowIndices: function(total, sel, visible, anchor) {
        var out = [];
        var i;
        if (total <= visible) {
            for (i = 0; i < visible; i++) out.push(i < total ? i : null);
            return out;
        }
        for (i = 0; i < visible; i++) out.push(((sel - anchor + i) % total + total) % total);
        return out;
    },

    // Janela sem dar a volta: comeca no inicio e so rola quando a selecao passa de "before"
    windowClamp: function(total, sel, visible, before) {
        var start = Math.max(0, Math.min(sel - before, total - visible));
        var out = [];
        for (var i = 0; i < visible; i++) out.push(start + i < total ? start + i : null);
        return out;
    },

    renderGuide: function() {
        this.renderMenu();
        this.renderChanCol();
        this.renderPrevInfo();
    },

    renderMenu: function() {
        var current = this.view !== "guide" ? this.view : (this.chanMode === "CATEGORIES" ? "channels" : "guide");
        for (var i = 0; i < this.menuEls.length; i++) {
            var m = this.menuEls[i];
            var focused = this.guideFocus === "MENU" && i === this.menuIndex;
            toggleClass(m.el, "focused", focused);
            toggleClass(m.el, "current", this.menu[i].id === current);
            setImg(m.img, "img/ic_" + m.icon + (focused ? "_dark" : "") + ".png");
        }
    },

    renderChanCol: function() {
        var cats = this.chanMode === "CATEGORIES";
        var total = cats ? this.categories.length : this.currentChannels.length;
        var sel = cats ? this.catCursor : this.selectedChanIndex;
        var idx = this.windowIndices(total, sel, 12, 5);
        var playingId = this.playingChannel ? this.playingChannel.id : null;

        setText($("chanColTitle"), cats ? "CATEGORIAS" : (this.currentCategory.toUpperCase() + " (" + total + ")"));

        for (var r = 0; r < 12; r++) {
            var row = this.chanPool.rows[r];
            var i = idx[r];
            row.key = i;
            if (i === null) {
                row.el.style.visibility = "hidden";
                continue;
            }
            row.el.style.visibility = "visible";
            if (cats) {
                var cat = this.categories[i];
                var count = this.categoriesMap[cat] ? this.categoriesMap[cat].length : 0;
                row.num.data = String(count);
                row.name.data = (this.adultCategories[cat] && !this.isAdultUnlocked ? "[18+] " : "") + cat;
                toggleClass(row.el, "playing", cat === this.currentCategory);
            } else {
                var ch = this.currentChannels[i];
                row.num.data = String(ch.number);
                row.name.data = (ch.isAdult ? "[18+] " : "") + ch.name;
                toggleClass(row.el, "playing", ch.id === playingId);
            }
            var isSel = i === sel;
            toggleClass(row.el, "focused", isSel && this.guideFocus === "CHAN");
            toggleClass(row.el, "sel", isSel && this.guideFocus !== "CHAN");
        }
        if (!cats) this.preloadAround(this.currentChannels, sel, 40);
    },

    onChanRowClick: function(row) {
        if (row.key === null) return;
        this.guideFocus = "CHAN";
        if (this.chanMode === "CATEGORIES") {
            this.catCursor = row.key;
            this.openCategory(row.key);
        } else {
            this.selectedChanIndex = row.key;
            this.renderGuide();
            this.scheduleEpg();
            this.activateGuideChannel();
        }
    },

    renderEpgHeader: function(ch) {
        var header = $("epgHeader");
        removeClass(header, "nologo");
        setText($("epgChanName"), ch ? ch.name : "");
        var url = this.logoUrl(ch, 40);
        if (url) setImg($("epgLogo"), url);
        else {
            setImg($("epgLogo"), "");
            if (ch) addClass(header, "nologo");
        }
    },

    renderEpg: function() {
        var list = this.epgList;
        var visible = 10;
        var start = 0;
        if (list.length > visible) start = Math.max(0, Math.min(this.epgSel - 2, list.length - visible));
        var now = this.now();

        for (var r = 0; r < visible; r++) {
            var row = this.epgPool.rows[r];
            var i = start + r;
            var p = list[i];
            if (!p) {
                row.el.style.visibility = "hidden";
                continue;
            }
            row.el.style.visibility = "visible";
            row.title.data = p.title;
            var d = this.local(p.start);
            row.time.innerHTML = DAYS[d.getUTCDay()] + " <b>" + this.fmtHM(p.start) + "</b> | " + this.fmtHM(p.stop) + " | " + this.fmtDuration(p.stop - p.start);
            toggleClass(row.el, "now", p.start <= now && p.stop > now);
            toggleClass(row.el, "focused", this.guideFocus === "EPG" && i === this.epgSel);
        }

        var empty = $("epgEmpty");
        var ch = this.epgForChannel;
        if (!list.length && ch) {
            setText(empty, ch.guide && this.token ? "Carregando programa\u00E7\u00E3o..." : "Programa\u00E7\u00E3o indispon\u00EDvel");
            empty.style.display = "block";
        } else {
            empty.style.display = "none";
        }
        this.renderPrevInfo();
    },

    renderPrevInfo: function() {
        var title = "";
        var cat = "";
        var desc = "";
        if (this.chanMode === "CATEGORIES") {
            var c = this.categories[this.catCursor];
            title = c || "";
            cat = (this.categoriesMap[c] ? this.categoriesMap[c].length : 0) + " canais";
            desc = "ENTER abre a categoria.";
        } else {
            var p = this.epgList[this.guideFocus === "EPG" ? this.epgSel : 0];
            var ch = this.currentChannels[this.selectedChanIndex];
            if (p) {
                title = p.title;
                cat = p.category ? "Categoria: " + p.category : "";
                desc = p.desc;
            } else if (ch) {
                title = ch.number + " - " + ch.name;
                cat = "Categoria: " + (ch.catalogGroup || ch.group || "");
            }
        }
        setText($("prevTitle"), title);
        setText($("prevCat"), cat);
        setText($("prevDesc"), desc.length > 420 ? desc.substring(0, 417) + "..." : desc);
    },

    // Mantem os logos vizinhos no cache do navegador (miniaturas de ~1-2 KB)
    preloadAround: function(list, sel, size) {
        if (!list.length || !this.thumbBase) return;
        var keep = [];
        for (var d = -8; d <= 8; d++) {
            var ch = list[((sel + d) % list.length + list.length) % list.length];
            var url = this.logoUrl(ch, size);
            if (!url) continue;
            var img = new Image();
            img.src = url;
            keep.push(img);
        }
        this.preloaded = keep;
    },

    // ======================================================================
    // Telas: guia, tela cheia e lista rapida
    // ======================================================================
    showGuide: function() {
        this.focusArea = "GUIDE";
        $("loginScreen").style.display = "none";
        var user = Store.get("PLAYCHANNEL_USER", "");
        setText($("sideUser"), user ? "Conta: " + user : "");
        this.focusAnchor();
        this.setFullscreen(false);
    },

    hideAllPlayerUi: function() {
        $("osd").style.display = "none";
        $("overlayList").style.display = "none";
        $("numberEntry").style.display = "none";
        $("audioOnly").style.display = "none";
        removeClass(document.body, "fullscreen");
    },

    setFullscreen: function(on) {
        this.isFullscreen = on;
        if (on) {
            this.focusArea = "FULLSCREEN";
            $("guideScreen").style.display = "none";
            addClass(document.body, "fullscreen");
            VideoPlayer.setWindow(0, 0, 1280, 720);
            this.updateAudioOnly();
            this.showOSD();
        } else {
            this.hideAllPlayerUi();
            this.focusArea = "GUIDE";
            if (this.guideFocus !== "MENU") this.guideFocus = this.view === "guide" ? "CHAN" : "VIEW";
            $("guideScreen").style.display = "block";
            VideoPlayer.setWindow(846, 16, 420, 236);
            this.applyView();
            if (this.playingChannel && this.chanMode === "CHANNELS") {
                var i = this.findChannelIndex(this.currentChannels, this.playingChannel.id);
                if (i >= 0 && i !== this.selectedChanIndex) {
                    this.selectedChanIndex = i;
                    this.scheduleEpg(0);
                }
            }
            this.renderGuide();
            if (this.view !== "guide") this.renderView();
        }
    },

    playChannel: function(ch) {
        if (!ch) return;
        if (ch.isAdult && !this.isAdultUnlocked) {
            var self = this;
            this.promptPin(function() { self.playChannel(ch); });
            return;
        }
        if (this.zapTimer) { clearTimeout(this.zapTimer); this.zapTimer = null; }
        if (this.playingChannel && this.playingChannel.id !== ch.id) this.previousChannel = this.playingChannel;
        this.playingChannel = ch;
        Store.set("PLAYCHANNEL_LAST_CH", String(ch.id));
        VideoPlayer.play(ch.url);
        this.updateAudioOnly();
        if (this.focusArea === "GUIDE") this.renderChanCol();
    },

    // Canais de radio/clipes: o video e preto, entao mostra logo e nome no lugar
    updateAudioOnly: function() {
        var ch = this.playingChannel;
        var on = !!(ch && ch.aonly && (this.isFullscreen || this.view === "guide") && this.focusArea !== "LOGIN");
        var box = $("audioOnly");
        if (on) {
            setText($("audioTitle"), ch.number + " - " + ch.name);
            setImg($("audioLogo"), this.logoUrl(ch, 72));
        }
        box.style.display = on ? "block" : "none";
    },

    // Tecla PRE-CH: volta ao canal anterior
    goPreviousChannel: function() {
        var prev = this.previousChannel;
        if (!prev || (this.playingChannel && prev.id === this.playingChannel.id)) return;
        var ci = this.findChannelIndex(this.currentChannels, prev.id);
        if (ci >= 0) this.selectedChanIndex = ci;
        this.playChannel(prev);
        if (this.isFullscreen) this.showOSD(prev);
        else if (this.view === "guide") { this.renderGuide(); this.scheduleEpg(0); }
    },

    activateGuideChannel: function() {
        var ch = this.currentChannels[this.selectedChanIndex];
        if (!ch) return;
        if (this.playingChannel && this.playingChannel.id === ch.id && VideoPlayer.state !== "STOPPED") {
            this.setFullscreen(true);
        } else {
            this.playChannel(ch);
        }
    },

    openCategory: function(index) {
        var cat = this.categories[index];
        if (this.adultCategories[cat] && !this.isAdultUnlocked) {
            var self = this;
            this.promptPin(function() { self.openCategory(index); });
            return;
        }
        this.selectedCatIndex = index;
        this.catCursor = index;
        this.currentCategory = cat;
        this.currentChannels = this.categoriesMap[cat] || [];
        var i = this.playingChannel ? this.findChannelIndex(this.currentChannels, this.playingChannel.id) : -1;
        this.selectedChanIndex = i >= 0 ? i : 0;
        this.chanMode = "CHANNELS";
        if (this.focusArea === "GUIDE") {
            this.guideFocus = "CHAN";
            this.renderGuide();
            this.scheduleEpg();
        }
    },

    // Troca de canal em tela cheia: mostra a barra na hora e so abre o video
    // quando o usuario para de apertar (evita abrir varios streams seguidos)
    zap: function(delta) {
        var list = this.currentChannels;
        var n = list.length;
        if (!n) return;
        var i = this.playingChannel ? this.findChannelIndex(list, this.playingChannel.id) : this.selectedChanIndex;
        if (this.zapTimer) i = this.selectedChanIndex;
        if (i < 0) i = this.selectedChanIndex;
        for (var tries = 0; tries < n; tries++) {
            i = (i + delta + n) % n;
            if (!list[i].isAdult || this.isAdultUnlocked) break;
        }
        this.selectedChanIndex = i;
        var ch = list[i];
        this.showOSD(ch);
        var self = this;
        if (this.zapTimer) clearTimeout(this.zapTimer);
        this.zapTimer = setTimeout(function() {
            self.zapTimer = null;
            self.playChannel(ch);
        }, this.ZAP_DELAY_MS);
    },

    showOSD: function(target) {
        var ch = target || this.playingChannel;
        if (!ch) return;
        var self = this;
        this.osdChannel = ch;
        setText($("osdTitle"), ch.number + " - " + ch.name);
        setText($("osdSub"), ch.group || "");
        setImg($("osdLogo"), this.logoUrl(ch, 72));
        this.fillOsdEpg([]);
        $("osd").style.display = "block";
        this.getEpg(ch, function(list) {
            if (self.osdChannel === ch) self.fillOsdEpg(list);
        });
        if (this.osdTimer) clearTimeout(this.osdTimer);
        this.osdTimer = setTimeout(function() { $("osd").style.display = "none"; }, 6000);
    },

    fillOsdEpg: function(list) {
        var i = this.nowIndex(list);
        var now = i >= 0 ? list[i] : null;
        var next = i >= 0 ? list[i + 1] : null;
        var show = function(id, on) { $(id).style.display = on ? "block" : "none"; };
        setText($("osdNowTitle"), now ? now.title : "");
        setText($("osdNowTime"), now ? this.fmtHM(now.start) + " - " + this.fmtHM(now.stop) : "");
        setText($("osdNextTitle"), next ? next.title : "");
        setText($("osdNextTime"), next ? this.fmtHM(next.start) + " - " + this.fmtHM(next.stop) : "");
        show("osdNowLabel", !!now);
        show("osdProgress", !!now);
        show("osdNextLabel", !!next);
        if (now) {
            var f = Math.max(0, Math.min(1, (this.now() - now.start) / (now.stop - now.start)));
            $("osdProgressBar").style.width = Math.round(300 * f) + "px";
        }
    },

    openOverlay: function() {
        if (!this.currentChannels.length) return;
        $("osd").style.display = "none";
        this.focusArea = "OVERLAY";
        if (this.playingChannel) {
            var i = this.findChannelIndex(this.currentChannels, this.playingChannel.id);
            if (i >= 0) this.selectedChanIndex = i;
        }
        $("overlayList").style.display = "block";
        this.renderOverlay();
    },

    closeOverlay: function() {
        if (this.overlayTimer) clearTimeout(this.overlayTimer);
        $("overlayList").style.display = "none";
        this.focusArea = "FULLSCREEN";
    },

    renderOverlay: function() {
        var list = this.currentChannels;
        var idx = this.windowIndices(list.length, this.selectedChanIndex, 10, 4);
        var playingId = this.playingChannel ? this.playingChannel.id : null;
        setText($("overlayCat"), this.currentCategory.toUpperCase() + "  \u00B7  " + list.length + " CANAIS");
        for (var r = 0; r < 10; r++) {
            var row = this.overlayPool.rows[r];
            var i = idx[r];
            row.key = i;
            if (i === null) {
                row.el.style.visibility = "hidden";
                continue;
            }
            var ch = list[i];
            row.el.style.visibility = "visible";
            row.name.data = ch.number + "-" + ch.name;
            setImg(row.img, this.logoUrl(ch, 40));
            toggleClass(row.el, "focused", i === this.selectedChanIndex);
            toggleClass(row.el, "playing", ch.id === playingId);
        }
        this.preloadAround(list, this.selectedChanIndex, 40);
        var self = this;
        if (this.overlayTimer) clearTimeout(this.overlayTimer);
        this.overlayTimer = setTimeout(function() { if (self.focusArea === "OVERLAY") self.closeOverlay(); }, 15000);
    },

    overlayEnter: function() {
        var ch = this.currentChannels[this.selectedChanIndex];
        if (!ch) return;
        this.closeOverlay();
        if (!this.playingChannel || this.playingChannel.id !== ch.id) this.playChannel(ch);
        this.showOSD(ch);
    },

    overlayCategory: function(delta) {
        var n = this.categories.length;
        if (!n) return;
        var i = this.selectedCatIndex;
        for (var t = 0; t < n; t++) {
            i = (i + delta + n) % n;
            if (!this.adultCategories[this.categories[i]] || this.isAdultUnlocked) break;
        }
        this.openCategory(i);
        this.renderOverlay();
    },

    // ======================================================================
    // Controle parental
    // ======================================================================
    promptPin: function(onSuccess, isChange) {
        if (!isChange) this.pinMode = "VERIFY";
        this.pinOnSuccess = onSuccess;
        this.pinInput = "";
        this.pinPrevArea = this.focusArea;
        this.focusArea = "PIN";
        setText($("pinAlert"), "");
        this.updatePinTexts();
        this.updatePinDisplay();
        $("pinModal").style.display = "block";
    },

    updatePinDisplay: function() {
        for (var i = 0; i < 4; i++) {
            var box = $("pinBox" + i);
            setText(box, i < this.pinInput.length ? "\u2022" : "");
            box.className = "pin-box" + (i < this.pinInput.length ? " filled" : "");
        }
    },

    enterPinDigit: function(d) {
        if (this.pinInput.length >= 4) return;
        this.pinInput += d;
        this.updatePinDisplay();
        if (this.pinInput.length === 4) {
            var self = this;
            setTimeout(function() { self.verifyPin(); }, 150);
        }
    },

    updatePinTexts: function() {
        var title = "Controle Parental";
        var sub = "Digite a senha com os n\u00FAmeros do controle (padr\u00E3o 0000)";
        if (this.pinMode === "CHANGE") {
            title = "Alterar senha";
            sub = ["Digite a senha atual", "Digite a nova senha (4 n\u00FAmeros)", "Confirme a nova senha"][this.pinStep];
        }
        setText($("pinTitle"), title);
        setText($("pinSubtitle"), sub);
    },

    finishPinChange: function(msg) {
        $("pinModal").style.display = "none";
        this.pinMode = "VERIFY";
        this.focusArea = this.pinPrevArea || "GUIDE";
        if (msg) this.toast(msg);
    },

    verifyPin: function() {
        if (this.focusArea !== "PIN") return;
        var correct = Store.get("PLAYCHANNEL_PARENTAL_PIN", "0000");

        if (this.pinMode === "CHANGE") {
            if (this.pinInput.length !== 4) return;
            if (this.pinStep === 0 && this.pinInput !== correct) {
                setText($("pinAlert"), "Senha atual incorreta.");
            } else if (this.pinStep === 2 && this.pinInput !== this.pinNew) {
                setText($("pinAlert"), "As senhas n\u00E3o conferem. Digite a nova senha de novo.");
                this.pinStep = 1;
            } else if (this.pinStep === 2) {
                Store.set("PLAYCHANNEL_PARENTAL_PIN", this.pinNew);
                this.finishPinChange("Senha do controle parental alterada.");
                return;
            } else {
                if (this.pinStep === 1) this.pinNew = this.pinInput;
                this.pinStep++;
                setText($("pinAlert"), "");
            }
            this.pinInput = "";
            this.updatePinTexts();
            this.updatePinDisplay();
            return;
        }

        if (this.pinInput === correct) {
            this.isAdultUnlocked = true;
            $("pinModal").style.display = "none";
            this.focusArea = this.pinPrevArea || "GUIDE";
            var cb = this.pinOnSuccess;
            this.pinOnSuccess = null;
            if (cb) cb();
            if (this.focusArea === "GUIDE") this.renderGuide();
            else if (this.focusArea === "OVERLAY") this.renderOverlay();
        } else {
            setText($("pinAlert"), "Senha incorreta.");
            this.pinInput = "";
            this.updatePinDisplay();
        }
    },

    cancelPin: function() {
        if (this.pinMode === "CHANGE") { this.finishPinChange(""); return; }
        $("pinModal").style.display = "none";
        this.pinOnSuccess = null;
        this.focusArea = this.pinPrevArea || "GUIDE";
    },

    // ======================================================================
    // Teclas
    // ======================================================================
    bindEvents: function() {
        document.addEventListener("keydown", function(e) { App.onKeyDown(e); }, false);
        // Letras digitadas no teclado do PC / teclado USB na tela de login
        document.addEventListener("keypress", function(e) {
            var inSearch = App.focusArea === "GUIDE" && App.view === "search" && App.guideFocus === "VIEW";
            if ((App.focusArea !== "LOGIN" && !inSearch) || App.imeActive) return;
            // Na TV o keypress das teclas do controle repete o keyCode (ex.: KEY_1 = 101 = "e")
            if (App.lastKeyMapped) return;
            var c = e.charCode || 0;
            if (c >= 32 && !(c >= 48 && c <= 57)) {
                if (inSearch) {
                    App.searchQuery += String.fromCharCode(c);
                    App.updateSearchResults();
                } else {
                    App.vkType(String.fromCharCode(c));
                }
                e.preventDefault();
            }
        }, false);

        $("btnLogin").onclick = function() { App.doLogin(); };
        $("btnDemo").onclick = function() { App.doDemoLogin(); };
        var inputs = ["loginUser", "loginPass", "loginServer"];
        for (var i = 0; i < inputs.length; i++) {
            (function(id, idx) {
                $(id).onclick = function() {
                    App.loginZone = "LEFT";
                    App.leftIndex = idx;
                    App.setActiveInput(id);
                    App.updateLoginFocus();
                    if (RemoteKeys.isTV) App.openNativeKeyboard(id);
                };
            })(inputs[i], i);
        }
    },

    blockKey: function(e) {
        try { if (this.widgetAPI) this.widgetAPI.blockNavigation(e); } catch (err) {}
        try { e.preventDefault(); } catch (err2) {}
    },

    onKeyDown: function(e) {
        // Enquanto o teclado nativo esta aberto ele cuida das teclas
        if (this.imeActive) {
            var kk = RemoteKeys.translate(e);
            if (kk && kk.action === "RETURN" && !RemoteKeys.isTV) this.closeNativeKeyboard();
            return;
        }

        var k = RemoteKeys.translate(e);
        this.lastKeyMapped = !!k && k.action !== "CHAR";
        if (!k) return;
        if (k.action === "EXIT") return; // TV fecha o app normalmente
        if (k.action === "VOL_UP" || k.action === "VOL_DOWN" || k.action === "MUTE") {
            this.volumeKey(k.action);
            this.blockKey(e);
            return;
        }

        var handled = false;
        switch (this.focusArea) {
            case "LOGIN": handled = this.handleLoginKey(k); break;
            case "PIN": handled = this.handlePinKey(k); break;
            case "FULLSCREEN": handled = this.handleFullscreenKey(k); break;
            case "OVERLAY": handled = this.handleOverlayKey(k); break;
            default: handled = this.handleGuideKey(k); break;
        }
        if (handled) this.blockKey(e);
    },

    handlePinKey: function(k) {
        if (k.action === "DIGIT") this.enterPinDigit(k.value);
        else if (k.action === "BACKSPACE" || k.action === "RED") {
            this.pinInput = this.pinInput.substring(0, Math.max(0, this.pinInput.length - 1));
            this.updatePinDisplay();
        } else if (k.action === "ENTER") this.verifyPin();
        else if (k.action === "RETURN") this.cancelPin();
        return true;
    },

    handleCommonKey: function(k) {
        switch (k.action) {
            case "RED":
                if (this.focusArea === "GUIDE") { if (this.playingChannel) this.setFullscreen(true); }
                else this.setFullscreen(false);
                return true;
            case "GREEN":
                if (this.focusArea === "GUIDE") this.setFullscreen(true);
                if (this.focusArea === "OVERLAY") this.closeOverlay();
                else this.openOverlay();
                return true;
            case "YELLOW": this.logout(); return true;
            case "BLUE": this.refreshChannels(false); return true;
            case "BACKSPACE": this.goPreviousChannel(); return true;
            case "STOP": VideoPlayer.stop(); return true;
            case "PAUSE": case "PLAY": VideoPlayer.togglePause(); return true;
            case "DIGIT": this.numberKey(k.value); return true;
            case "CH_UP":
            case "CH_DOWN":
                if (this.focusArea !== "FULLSCREEN") this.setFullscreen(true);
                this.zap(k.action === "CH_UP" ? 1 : -1);
                return true;
        }
        return false;
    },

    handleFullscreenKey: function(k) {
        var a = k.action;
        if (a === "RETURN") { this.setFullscreen(false); return true; }
        if (a === "ENTER" || a === "LEFT") { this.openOverlay(); return true; }
        if (a === "INFO" || a === "RIGHT") { this.showOSD(); return true; }
        if (a === "UP") { this.zap(1); return true; }
        if (a === "DOWN") { this.zap(-1); return true; }
        return this.handleCommonKey(k);
    },

    handleOverlayKey: function(k) {
        var a = k.action;
        var n = this.currentChannels.length;
        if (a === "UP" || a === "DOWN") {
            if (n) this.selectedChanIndex = (this.selectedChanIndex + (a === "UP" ? -1 : 1) + n) % n;
            this.renderOverlay();
            return true;
        }
        if (a === "LEFT") { this.overlayCategory(-1); return true; }
        if (a === "RIGHT") { this.overlayCategory(1); return true; }
        if (a === "ENTER") { this.overlayEnter(); return true; }
        if (a === "RETURN") { this.closeOverlay(); return true; }
        return this.handleCommonKey(k);
    },

    handleGuideKey: function(k) {
        var a = k.action;
        // Paineis tratam as proprias teclas primeiro (ex.: numeros digitam na pesquisa)
        if (this.guideFocus === "VIEW") {
            var handledView = false;
            if (this.view === "search") handledView = this.handleSearchKey(k);
            else if (this.view === "catalog") handledView = this.handleCatalogKey(k);
            else if (this.view === "user") handledView = this.handleUserKey(k);
            if (handledView) return true;
        }
        if (this.handleCommonKey(k)) return true;

        if (this.guideFocus === "MENU") {
            var n = this.menu.length;
            if (a === "UP") this.menuIndex = (this.menuIndex - 1 + n) % n;
            else if (a === "DOWN") this.menuIndex = (this.menuIndex + 1) % n;
            else if (a === "RIGHT") this.guideFocus = this.view === "guide" ? "CHAN" : "VIEW";
            else if (a === "ENTER") { this.activateMenu(); return true; }
            else if (a === "RETURN") { if (this.playingChannel) this.setFullscreen(true); return true; }
            else return false;
            if (this.view === "guide") this.renderGuide();
            else this.renderView();
            return true;
        }

        if (this.guideFocus === "EPG") {
            if (a === "UP") { if (this.epgSel > 0) this.epgSel--; }
            else if (a === "DOWN") { if (this.epgSel < this.epgList.length - 1) this.epgSel++; }
            else if (a === "LEFT" || a === "RETURN") { this.guideFocus = "CHAN"; this.renderGuide(); this.renderEpg(); return true; }
            else if (a === "ENTER") { this.activateGuideChannel(); return true; }
            else return false;
            this.renderEpg();
            return true;
        }

        // Coluna de canais / categorias (lista circular)
        var cats = this.chanMode === "CATEGORIES";
        var total = cats ? this.categories.length : this.currentChannels.length;
        if (a === "UP" || a === "DOWN") {
            if (!total) return true;
            var d = a === "UP" ? -1 : 1;
            if (cats) this.catCursor = (this.catCursor + d + total) % total;
            else {
                this.selectedChanIndex = (this.selectedChanIndex + d + total) % total;
                this.scheduleEpg();
            }
            this.renderChanCol();
            this.renderPrevInfo();
            return true;
        }
        if (a === "LEFT") { this.guideFocus = "MENU"; this.renderGuide(); return true; }
        if (a === "RIGHT") {
            if (!cats && this.epgList.length) {
                this.guideFocus = "EPG";
                this.epgSel = 0;
                this.renderChanCol();
                this.renderEpg();
            }
            return true;
        }
        if (a === "ENTER") {
            if (cats) this.openCategory(this.catCursor);
            else this.activateGuideChannel();
            return true;
        }
        if (a === "RETURN") {
            if (cats) {
                this.chanMode = "CHANNELS";
                this.renderGuide();
                this.scheduleEpg(0);
            } else if (this.playingChannel) {
                this.setFullscreen(true);
            }
            return true;
        }
        return false;
    },

    activateMenu: function() {
        var id = this.menu[this.menuIndex].id;
        if (id === "home") {
            if (this.playingChannel) this.setFullscreen(true);
            return;
        }
        if (id === "guide" || id === "channels") {
            this.chanMode = id === "channels" ? "CATEGORIES" : "CHANNELS";
            if (id === "channels") this.catCursor = this.selectedCatIndex;
            this.setView("guide");
            this.guideFocus = "CHAN";
            this.renderGuide();
            this.scheduleEpg(0);
            return;
        }
        this.setView(id);
        this.guideFocus = "VIEW";
        this.renderView();
    },

    // ======================================================================
    // Paineis: troca de tela dentro do guia
    // ======================================================================
    setView: function(view) {
        this.view = view;
        this.applyView();
    },

    applyView: function() {
        var guide = this.view === "guide";
        var guideIds = ["bgMain", "bgPrevTop", "bgPrevLeft", "bgPrevRight", "bgPrevBottom", "chanCol", "epgCol", "videoFrame", "prevInfo"];
        for (var i = 0; i < guideIds.length; i++) $(guideIds[i]).style.display = guide ? "block" : "none";
        $("userPanel").style.display = this.view === "user" ? "block" : "none";
        $("searchPanel").style.display = this.view === "search" ? "block" : "none";
        $("catalogPanel").style.display = this.view === "catalog" ? "block" : "none";
        toggleClass(document.body, "panelview", !guide);
        this.updateAudioOnly();
        this.renderMenu();
    },

    renderView: function() {
        this.renderMenu();
        if (this.view === "user") this.renderUser();
        else if (this.view === "search") this.renderSearch();
        else if (this.view === "catalog") this.renderCatalog();
    },

    // Volta do painel para o menu lateral
    viewToMenu: function() {
        this.guideFocus = "MENU";
        this.renderView();
    },

    // ---------------- Usuario ----------------
    renderUser: function() {
        var user = Store.get("PLAYCHANNEL_USER", "") || "visitante";
        setText($("userHello"), "Ol\u00E1, " + user);
        for (var i = 0; i < this.userButtons.length; i++) {
            toggleClass($(this.userButtons[i]), "focused", this.guideFocus === "VIEW" && i === this.userIndex);
        }
        $("userInfo").innerHTML = "Servidor: " + escapeHtml(this.server || "demonstra\u00E7\u00E3o") +
            "<br>Canais: " + this.allChannels.length + " em " + Math.max(0, this.categories.length - 1) + " grupos" +
            "<br>Vers\u00E3o: " + this.VERSION;
    },

    handleUserKey: function(k) {
        var a = k.action;
        var n = this.userButtons.length;
        if (a === "UP") this.userIndex = (this.userIndex - 1 + n) % n;
        else if (a === "DOWN") this.userIndex = (this.userIndex + 1) % n;
        else if (a === "LEFT" || a === "RETURN") { this.viewToMenu(); return true; }
        else if (a === "ENTER") {
            var id = this.userButtons[this.userIndex];
            if (id === "ubLogout") { this.logout(); return true; }
            if (id === "ubRefresh") this.refreshChannels(false);
            if (id === "ubPin") { this.startPinChange(); return true; }
        } else return false;
        this.renderUser();
        return true;
    },

    // ---------------- Pesquisa ----------------
    buildSearch: function() {
        var self = this;
        var chars = "abcdefghijklmnopqrstuvwxyz0123456789+&-.".split("");
        var container = $("searchKeys");
        container.innerHTML = "";
        this.searchKeys = [];
        this.searchGrid = [];
        var add = function(label, type, value, row, col, span) {
            var el = document.createElement("div");
            el.className = "skey" + (label.length > 1 ? " skey-small" : "");
            el.style.left = (col * 63) + "px";
            el.style.top = (row * 56) + "px";
            el.style.width = (span * 63 - 5) + "px";
            el.style.height = "50px";
            el.style.lineHeight = "50px";
            setText(el, label.toUpperCase());
            var idx = self.searchKeys.length;
            el.onclick = function() { self.searchZone = "KB"; self.searchKey = idx; self.pressSearchKey(); };
            container.appendChild(el);
            self.searchKeys.push({ el: el, type: type, value: value, row: row, col: col, span: span });
            if (!self.searchGrid[row]) self.searchGrid[row] = [];
            for (var c = col; c < col + span; c++) self.searchGrid[row][c] = idx;
        };
        for (var i = 0; i < chars.length; i++) add(chars[i], "char", chars[i], Math.floor(i / 8), i % 8, 1);
        add("espa\u00E7o", "char", " ", 5, 0, 3);
        add("apagar", "back", null, 5, 3, 3);
        add("limpar", "clear", null, 5, 6, 2);

        this.searchPool = new RowPool($("searchRows"), 11, function() {
            var el = document.createElement("div");
            el.className = "srow";
            var img = document.createElement("img");
            img.src = "img/blank.gif";
            img.onerror = function() { this.onerror = null; this.src = "img/blank.gif"; };
            el.appendChild(img);
            var row = { el: el, img: img, name: textNode(el, "srow-name") };
            el.onclick = function() { if (row.key !== null) { self.searchSel = row.key; self.playSearchResult(); } };
            return row;
        });
    },

    pressSearchKey: function() {
        var key = this.searchKeys[this.searchKey];
        if (key.type === "char") this.searchQuery += key.value;
        else if (key.type === "back") this.searchQuery = this.searchQuery.substring(0, this.searchQuery.length - 1);
        else if (key.type === "clear") this.searchQuery = "";
        this.updateSearchResults();
    },

    updateSearchResults: function() {
        var q = trim(this.plain(this.searchQuery));
        var out = [];
        if (q) {
            var starts = [];
            var contains = [];
            for (var i = 0; i < this.allChannels.length; i++) {
                var ch = this.allChannels[i];
                if (ch.isAdult && !this.isAdultUnlocked) continue;
                var name = this.plain(ch.name);
                var num = String(ch.number);
                if (num.indexOf(q) === 0 || name.indexOf(q) === 0) starts.push(ch);
                else if (name.indexOf(q) !== -1 || name.replace(/\s+/g, "").indexOf(q.replace(/\s+/g, "")) !== -1) contains.push(ch);
            }
            out = starts.concat(contains);
        }
        this.searchResults = out;
        this.searchSel = 0;
        if (!out.length && this.searchZone === "LIST") this.searchZone = "KB";
        this.renderSearch();
    },

    renderSearch: function() {
        var focusKb = this.guideFocus === "VIEW" && this.searchZone === "KB";
        var focusList = this.guideFocus === "VIEW" && this.searchZone === "LIST";
        setText($("searchBox"), this.searchQuery + "_");
        for (var i = 0; i < this.searchKeys.length; i++) toggleClass(this.searchKeys[i].el, "focused", focusKb && i === this.searchKey);

        var res = this.searchResults;
        setText($("searchCount"), this.searchQuery ? (res.length ? res.length + " canal(is) encontrado(s)" : "Nenhum canal encontrado") : "Comece a digitar para ver os canais");
        var start = 0;
        if (res.length > 11) start = Math.max(0, Math.min(this.searchSel - 4, res.length - 11));
        for (var r = 0; r < 11; r++) {
            var row = this.searchPool.rows[r];
            var ch = res[start + r];
            row.key = ch ? start + r : null;
            if (!ch) {
                row.el.style.visibility = "hidden";
                continue;
            }
            row.el.style.visibility = "visible";
            row.name.data = ch.number + " - " + ch.name;
            setImg(row.img, this.logoUrl(ch, 40));
            toggleClass(row.el, "focused", focusList && start + r === this.searchSel);
        }
    },

    playSearchResult: function() {
        var ch = this.searchResults[this.searchSel];
        if (!ch) return;
        this.openChannelFrom("Todos", ch);
    },

    handleSearchKey: function(k) {
        var a = k.action;
        if (a === "DIGIT" || a === "CHAR") {
            this.searchQuery += k.value;
            this.updateSearchResults();
            return true;
        }
        if (a === "BACKSPACE" || a === "RED") {
            this.searchQuery = this.searchQuery.substring(0, this.searchQuery.length - 1);
            this.updateSearchResults();
            return true;
        }
        if (this.searchZone === "LIST") {
            var n = this.searchResults.length;
            if (a === "UP") { if (this.searchSel > 0) this.searchSel--; }
            else if (a === "DOWN") { if (this.searchSel < n - 1) this.searchSel++; }
            else if (a === "LEFT" || a === "RETURN") this.searchZone = "KB";
            else if (a === "ENTER") { this.playSearchResult(); return true; }
            else return false;
            this.renderSearch();
            return true;
        }
        var key = this.searchKeys[this.searchKey];
        var maxRow = this.searchGrid.length - 1;
        if (a === "LEFT") {
            if (key.col === 0) { this.viewToMenu(); return true; }
            this.searchKey = this.searchGrid[key.row][key.col - 1];
        } else if (a === "RIGHT") {
            var next = key.col + key.span;
            if (next <= 7) this.searchKey = this.searchGrid[key.row][next];
            else if (this.searchResults.length) this.searchZone = "LIST";
        } else if (a === "UP") {
            if (key.row > 0) this.searchKey = this.searchGrid[key.row - 1][Math.min(key.col, this.searchGrid[key.row - 1].length - 1)];
        } else if (a === "DOWN") {
            if (key.row < maxRow) this.searchKey = this.searchGrid[key.row + 1][Math.min(key.col, this.searchGrid[key.row + 1].length - 1)];
        } else if (a === "ENTER") {
            this.pressSearchKey();
            return true;
        } else if (a === "RETURN") {
            this.viewToMenu();
            return true;
        } else {
            return false;
        }
        this.renderSearch();
        return true;
    },

    // ---------------- Catalogo (fileiras por grupo) ----------------
    buildCatalog: function() {
        var self = this;
        this.catalogPool = new RowPool($("catalogRows"), 4, function(r) {
            var el = document.createElement("div");
            el.className = "cgroup";
            var title = document.createElement("div");
            title.className = "cgroup-title";
            var titleText = document.createTextNode("");
            title.appendChild(titleText);
            var count = document.createElement("span");
            count.className = "cgroup-count";
            var countText = document.createTextNode("");
            count.appendChild(countText);
            title.appendChild(count);
            el.appendChild(title);
            var tiles = [];
            for (var t = 0; t < 6; t++) {
                (function(ti) {
                    var tile = document.createElement("div");
                    tile.className = "ctile";
                    tile.style.left = (30 + ti * 158) + "px";
                    var img = document.createElement("img");
                    img.src = "img/blank.gif";
                    img.onerror = function() { this.onerror = null; this.src = "img/blank.gif"; };
                    tile.appendChild(img);
                    var tileObj = { el: tile, img: img, num: textNode(tile, "ctile-num"), name: textNode(tile, "ctile-name"), key: null };
                    tile.onclick = function() {
                        if (tileObj.key === null || row.group === null) return;
                        self.catalogGroup = row.group;
                        self.catalogTile[row.group] = tileObj.key;
                        self.playCatalogTile();
                    };
                    el.appendChild(tile);
                    tiles.push(tileObj);
                })(t);
            }
            var row = { el: el, title: titleText, count: countText, tiles: tiles, group: null };
            return row;
        });
    },

    renderCatalog: function() {
        var groups = this.catalogGroups();
        var g = this.catalogGroup;
        if (g >= groups.length) g = this.catalogGroup = 0;
        // grupo focado sempre na segunda fileira (a primeira mostra o anterior)
        var idx = this.windowClamp(groups.length, g, 4, 1);
        var playingId = this.playingChannel ? this.playingChannel.id : null;
        var focusOn = this.guideFocus === "VIEW";
        var total = 0;
        for (var c = 0; c < groups.length; c++) total += this.categoriesMap[groups[c]].length;
        setText($("catalogInfo"), groups.length + " grupos \u00B7 " + total + " canais \u00B7 \u25B2\u25BC grupo \u00B7 \u25C0\u25B6 canal \u00B7 ENTER assistir");

        for (var r = 0; r < 4; r++) {
            var row = this.catalogPool.rows[r];
            var gi = idx[r];
            row.group = gi;
            if (gi === null) {
                row.el.style.visibility = "hidden";
                continue;
            }
            row.el.style.visibility = "visible";
            var name = groups[gi];
            var list = this.categoriesMap[name];
            var locked = this.adultCategories[name] && !this.isAdultUnlocked;
            row.title.data = name + (locked ? " [18+]" : "") + "  ";
            row.count.data = list.length + " canais";
            var sel = this.catalogTile[gi] || 0;
            var tIdx = this.windowClamp(list.length, sel, 6, 2);
            for (var t = 0; t < 6; t++) {
                var tile = row.tiles[t];
                var ci = tIdx[t];
                tile.key = ci;
                if (ci === null) {
                    tile.el.style.visibility = "hidden";
                    continue;
                }
                var ch = list[ci];
                tile.el.style.visibility = "visible";
                tile.num.data = String(ch.number);
                tile.name.data = locked ? "Conte\u00FAdo 18+" : ch.name;
                setImg(tile.img, locked ? "" : this.logoUrl(ch, 72));
                toggleClass(tile.el, "focused", focusOn && gi === g && ci === sel);
                toggleClass(tile.el, "playing", ch.id === playingId);
            }
        }
    },

    catalogGroups: function() {
        var out = [];
        for (var i = 0; i < this.categories.length; i++) {
            if (this.categories[i] !== "Todos" && this.categoriesMap[this.categories[i]]) out.push(this.categories[i]);
        }
        return out;
    },

    handleCatalogKey: function(k) {
        var a = k.action;
        var groups = this.catalogGroups();
        if (!groups.length) {
            if (a === "LEFT" || a === "RETURN") { this.viewToMenu(); return true; }
            return false;
        }
        var g = this.catalogGroup;
        var list = this.categoriesMap[groups[g]];
        var sel = this.catalogTile[g] || 0;
        if (a === "UP") this.catalogGroup = (g - 1 + groups.length) % groups.length;
        else if (a === "DOWN") this.catalogGroup = (g + 1) % groups.length;
        else if (a === "RIGHT") this.catalogTile[g] = (sel + 1) % list.length;
        else if (a === "LEFT") {
            if (sel === 0) { this.viewToMenu(); return true; }
            this.catalogTile[g] = sel - 1;
        } else if (a === "ENTER") { this.playCatalogTile(); return true; }
        else if (a === "RETURN") { this.viewToMenu(); return true; }
        else return false;
        this.renderCatalog();
        return true;
    },

    playCatalogTile: function() {
        var groups = this.catalogGroups();
        var name = groups[this.catalogGroup];
        var list = this.categoriesMap[name];
        var ch = list && list[this.catalogTile[this.catalogGroup] || 0];
        if (!ch) return;
        this.openChannelFrom(name, ch);
    },

    // Abre um canal em tela cheia usando o grupo como lista atual (CH+/CH- navegam nele)
    openChannelFrom: function(categoryName, ch) {
        var self = this;
        if ((ch.isAdult || this.adultCategories[categoryName]) && !this.isAdultUnlocked) {
            this.promptPin(function() { self.openChannelFrom(categoryName, ch); });
            return;
        }
        var ci = this.indexOf(this.categories, categoryName);
        this.currentCategory = ci >= 0 ? categoryName : "Todos";
        this.selectedCatIndex = Math.max(0, ci);
        this.currentChannels = this.categoriesMap[this.currentCategory] || this.allChannels;
        this.selectedChanIndex = Math.max(0, this.findChannelIndex(this.currentChannels, ch.id));
        this.chanMode = "CHANNELS";
        if (!this.playingChannel || this.playingChannel.id !== ch.id) this.playChannel(ch);
        this.setFullscreen(true);
        this.scheduleEpg(0);
    },

    // ---------------- Troca da senha do controle parental ----------------
    startPinChange: function() {
        this.pinMode = "CHANGE";
        this.pinStep = 0;
        this.pinNew = "";
        this.promptPin(null, true);
    },

    // Digitar o numero do canal (aguarda 1,5 s entre digitos)
    numberKey: function(d) {
        var self = this;
        if (this.numBuffer.length >= 4) this.numBuffer = "";
        this.numBuffer += d;
        var box = $("numberEntry");
        setText(box, this.numBuffer);
        box.style.display = "block";
        if (this.numTimer) clearTimeout(this.numTimer);
        this.numTimer = setTimeout(function() {
            var n = parseInt(self.numBuffer, 10);
            self.numBuffer = "";
            box.style.display = "none";
            self.goToNumber(n);
        }, 1500);
    },

    goToNumber: function(n) {
        var i = -1;
        var c;
        for (c = 0; c < this.currentChannels.length; c++) {
            if (Number(this.currentChannels[c].number) === n) { i = c; break; }
        }
        if (i < 0) {
            for (c = 0; c < this.allChannels.length; c++) {
                if (Number(this.allChannels[c].number) === n) {
                    this.currentCategory = "Todos";
                    this.selectedCatIndex = 0;
                    this.currentChannels = this.allChannels;
                    i = c;
                    break;
                }
            }
        }
        if (i < 0) {
            this.toast("Canal " + n + " n\u00E3o encontrado.");
            return;
        }
        this.selectedChanIndex = i;
        var ch = this.currentChannels[i];
        if (this.focusArea === "GUIDE") {
            this.chanMode = "CHANNELS";
            this.guideFocus = "CHAN";
            this.renderGuide();
            this.scheduleEpg(0);
            this.playChannel(ch);
        } else {
            if (this.focusArea === "OVERLAY") this.closeOverlay();
            this.playChannel(ch);
            this.showOSD(ch);
        }
    }
};

window.onload = function() {
    App.init();
};

window.onunload = function() {
    try { VideoPlayer.stop(); } catch (e) {}
    try { if (App.pluginAPI && App.pluginAPI.setOnScreenSaver) App.pluginAPI.setOnScreenSaver(); } catch (e2) {}
};
