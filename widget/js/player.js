/**
 * Play Channel TV - Player
 * TV Samsung Orsay: plugin SAMSUNG-INFOLINK-PLAYER (decodificador de hardware).
 *   - HLS precisa do sufixo "|COMPONENT=HLS" na URL.
 *   - SetDisplayArea usa coordenadas da base 960x540, mesmo com o app em 1280x720.
 *   - Os eventos do plugin sao registrados como string com o nome da funcao global.
 * PC: <video> HTML5 + hls.js (carregado sob demanda, nunca na TV).
 */
var VideoPlayer = {
    plugin: null,
    video: null,
    hls: null,
    useSamsung: false,
    currentUrl: "",
    state: "STOPPED",
    area: { x: 0, y: 0, w: 1280, h: 720 },
    retries: 0,
    retryTimer: null,
    RETRY_DELAYS: [2000, 5000, 10000],

    init: function() {
        this.plugin = document.getElementById("pluginPlayer");
        this.video = document.getElementById("html5Video");

        if (RemoteKeys.isTV && this.plugin && typeof this.plugin.Play !== "undefined") {
            this.useSamsung = true;
            var p = this.plugin;
            p.OnConnectionFailed = "VideoPlayer.onConnectionFailed";
            p.OnNetworkDisconnected = "VideoPlayer.onNetworkDisconnected";
            p.OnStreamNotFound = "VideoPlayer.onStreamNotFound";
            p.OnRenderError = "VideoPlayer.onRenderError";
            p.OnAuthenticationFailed = "VideoPlayer.onAuthenticationFailed";
            p.OnBufferingStart = "VideoPlayer.onBufferingStart";
            p.OnBufferingComplete = "VideoPlayer.onBufferingComplete";
            p.OnRenderingComplete = "VideoPlayer.onRenderingComplete";
            p.OnStreamInfoReady = "VideoPlayer.onStreamInfoReady";
            log("[Player] Plugin SAMSUNG-INFOLINK-PLAYER ativo");
        } else {
            this.useSamsung = false;
            if (this.plugin && this.plugin.parentNode) this.plugin.style.display = "none";
            if (this.video) {
                this.video.style.display = "block";
                this.video.onplaying = function() { VideoPlayer.onBuffering(false); VideoPlayer.state = "PLAYING"; };
                this.video.onwaiting = function() { VideoPlayer.onBuffering(true); };
                this.video.onerror = function() { VideoPlayer.onError("Erro ao reproduzir o canal."); };
            }
        }
    },

    isHls: function(url) {
        return url.indexOf(".m3u8") !== -1 || url.indexOf("/media/") !== -1;
    },

    // Reconecta sozinho quando o stream cai (queda de rede, servidor reiniciando...)
    scheduleRetry: function(msg) {
        if (this.retryTimer || !this.currentUrl) return;
        if (this.retries >= this.RETRY_DELAYS.length) {
            this.onError(msg);
            return;
        }
        var delay = this.RETRY_DELAYS[this.retries++];
        var n = this.retries;
        this.onBuffering(true);
        this.showNote("Reconectando (" + n + "/" + this.RETRY_DELAYS.length + ")...");
        this.retryTimer = setTimeout(function() {
            VideoPlayer.retryTimer = null;
            VideoPlayer.start(VideoPlayer.currentUrl);
        }, delay);
    },

    cancelRetry: function() {
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    },

    showNote: function(msg) {
        var el = document.getElementById("playerLoader");
        if (!el) return;
        el.innerHTML = "";
        el.appendChild(document.createTextNode(msg));
    },

    // Chamado pelo app ao escolher um canal: zera as tentativas
    play: function(url) {
        if (!url) return;
        this.cancelRetry();
        this.retries = 0;
        this.showNote("Carregando...");
        this.start(url);
    },

    start: function(url) {
        this.currentUrl = url;
        this.hideError();
        this.onBuffering(true);

        if (this.useSamsung) {
            try {
                this.plugin.Stop();
                this.applyArea();
                var playUrl = this.isHls(url) ? url + "|COMPONENT=HLS" : url;
                log("[Player] Play " + playUrl);
                this.plugin.Play(playUrl);
                this.state = "PLAYING";
            } catch (e) {
                this.onError("Falha no decodificador da TV: " + e);
            }
            return;
        }

        this.playHtml5(url);
    },

    playHtml5: function(url) {
        var v = this.video;
        if (!v) return;
        if (this.hls) {
            try { this.hls.destroy(); } catch (e) {}
            this.hls = null;
        }
        if (this.isHls(url) && !v.canPlayType("application/vnd.apple.mpegurl")) {
            this.loadHlsJs(function() {
                if (typeof Hls === "undefined" || !Hls.isSupported()) {
                    VideoPlayer.onError("Este navegador nao reproduz HLS.");
                    return;
                }
                var hls = new Hls();
                VideoPlayer.hls = hls;
                hls.loadSource(url);
                hls.attachMedia(v);
                hls.on(Hls.Events.MANIFEST_PARSED, function() { try { v.play(); } catch (e) {} });
                hls.on(Hls.Events.ERROR, function(ev, data) {
                    if (data && data.fatal) VideoPlayer.onError("Erro na transmissao HLS.");
                });
            });
            return;
        }
        v.src = url;
        try { v.load(); v.play(); } catch (e) {}
    },

    loadHlsJs: function(cb) {
        if (typeof Hls !== "undefined") { cb(); return; }
        var s = document.createElement("script");
        s.src = "js/hls.light.min.js";
        s.onload = cb;
        s.onerror = function() { VideoPlayer.onError("hls.js nao encontrado."); };
        document.getElementsByTagName("head")[0].appendChild(s);
    },

    stop: function() {
        this.cancelRetry();
        this.state = "STOPPED";
        this.onBuffering(false);
        if (this.useSamsung) {
            try { this.plugin.Stop(); } catch (e) {}
            return;
        }
        if (this.hls) {
            try { this.hls.destroy(); } catch (e2) {}
            this.hls = null;
        }
        if (this.video) {
            try { this.video.pause(); } catch (e3) {}
            this.video.removeAttribute("src");
        }
    },

    togglePause: function() {
        if (this.state === "PLAYING") {
            this.state = "PAUSED";
            if (this.useSamsung) { try { this.plugin.Pause(); } catch (e) {} }
            else if (this.video) this.video.pause();
        } else if (this.state === "PAUSED") {
            this.state = "PLAYING";
            if (this.useSamsung) { try { this.plugin.Resume(); } catch (e2) {} }
            else if (this.video) this.video.play();
        }
    },

    // Coordenadas em pixels do app (1280x720)
    setWindow: function(x, y, w, h) {
        this.area = { x: x, y: y, w: w, h: h };
        if (this.useSamsung) {
            this.applyArea();
        } else if (this.video) {
            var frame = document.getElementById("videoFrame");
            if (w >= 1280) {
                this.video.style.position = "absolute";
                this.video.style.left = "0px";
                this.video.style.top = "0px";
                this.video.style.width = "1280px";
                this.video.style.height = "720px";
                this.video.style.zIndex = "20";
                document.body.appendChild(this.video);
            } else {
                this.video.style.position = "static";
                this.video.style.width = w + "px";
                this.video.style.height = h + "px";
                this.video.style.zIndex = "";
                if (frame && this.video.parentNode !== frame) frame.appendChild(this.video);
            }
        }
    },

    applyArea: function() {
        var a = this.area;
        var f = 960 / 1280;
        try {
            this.plugin.SetDisplayArea(Math.round(a.x * f), Math.round(a.y * f), Math.round(a.w * f), Math.round(a.h * f));
        } catch (e) {}
    },

    // ---- Eventos do plugin Samsung ----
    onBufferingStart: function() { VideoPlayer.onBuffering(true); },
    onBufferingComplete: function() { VideoPlayer.onBuffering(false); VideoPlayer.state = "PLAYING"; VideoPlayer.retries = 0; VideoPlayer.showNote("Carregando..."); },
    onRenderingComplete: function() { VideoPlayer.state = "STOPPED"; },
    onStreamInfoReady: function() { VideoPlayer.applyArea(); },
    onConnectionFailed: function() { VideoPlayer.scheduleRetry("Falha de conexao com o servidor de video."); },
    onNetworkDisconnected: function() { VideoPlayer.scheduleRetry("Rede desconectada."); },
    onStreamNotFound: function() { VideoPlayer.scheduleRetry("Canal indisponivel no momento."); },
    onRenderError: function(code) { VideoPlayer.scheduleRetry("Formato de video nao suportado (" + code + ")."); },
    onAuthenticationFailed: function() {
        // Token vencido: o app renova o login e reabre o canal
        VideoPlayer.onBuffering(true);
        if (typeof App !== "undefined" && App.onStreamAuthFailed) App.onStreamAuthFailed();
        else VideoPlayer.onError("Sessao expirada.");
    },

    onBuffering: function(on) {
        var el = document.getElementById("playerLoader");
        if (el) el.style.display = on ? "block" : "none";
    },

    hideError: function() {
        var el = document.getElementById("playerError");
        if (el) el.style.display = "none";
    },

    onError: function(msg) {
        log("[Player] " + msg);
        this.onBuffering(false);
        var el = document.getElementById("playerError");
        if (!el) return;
        el.innerHTML = "";
        el.appendChild(document.createTextNode(msg));
        el.style.display = "block";
        setTimeout(function() { el.style.display = "none"; }, 6000);
    }
};
