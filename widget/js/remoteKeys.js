/**
 * Play Channel TV - Traducao de teclas para acoes
 * Na TV Samsung Orsay os codigos vem do Common.API.TVKeyValue (ex.: KEY_1 = 101,
 * KEY_4 = 8, KEY_8 = 13), que colidem com Backspace/Enter do PC. Por isso os
 * dois mapas sao separados e escolhidos conforme a plataforma.
 */
var RemoteKeys = {
    isTV: false,
    tvKey: null,
    tvMap: {},

    init: function() {
        try {
            if (typeof Common !== "undefined" && Common.API && Common.API.TVKeyValue) {
                this.tvKey = new Common.API.TVKeyValue();
                this.isTV = true;
            }
        } catch (e) {
            this.isTV = false;
        }

        if (this.isTV) {
            var k = this.tvKey;
            var map = {};
            var add = function(code, action) {
                if (typeof code === "number") map[code] = action;
            };
            add(k.KEY_UP, "UP"); add(k.KEY_DOWN, "DOWN");
            add(k.KEY_LEFT, "LEFT"); add(k.KEY_RIGHT, "RIGHT");
            add(k.KEY_ENTER, "ENTER"); add(k.KEY_RETURN, "RETURN");
            add(k.KEY_EXIT, "EXIT");
            add(k.KEY_RED, "RED"); add(k.KEY_GREEN, "GREEN");
            add(k.KEY_YELLOW, "YELLOW"); add(k.KEY_BLUE, "BLUE");
            add(k.KEY_CH_UP, "CH_UP"); add(k.KEY_CH_DOWN, "CH_DOWN");
            add(k.KEY_INFO, "INFO"); add(k.KEY_TOOLS, "INFO");
            add(k.KEY_PLAY, "PLAY"); add(k.KEY_PAUSE, "PAUSE"); add(k.KEY_STOP, "STOP");
            add(k.KEY_PRECH, "BACKSPACE");
            add(k.KEY_VOL_UP, "VOL_UP"); add(k.KEY_VOL_DOWN, "VOL_DOWN"); add(k.KEY_MUTE, "MUTE");
            var digits = [k.KEY_0, k.KEY_1, k.KEY_2, k.KEY_3, k.KEY_4, k.KEY_5, k.KEY_6, k.KEY_7, k.KEY_8, k.KEY_9];
            for (var i = 0; i < digits.length; i++) {
                add(digits[i], "DIGIT_" + i);
            }
            this.tvMap = map;
        }
    },

    /**
     * Retorna { action: "UP" | "DIGIT" | "CHAR" | ..., value: "5" } ou null
     */
    translate: function(e) {
        var code = e.keyCode;

        if (this.isTV) {
            var a = this.tvMap[code];
            if (!a) {
                // Teclado USB ligado na TV: deixa passar caracteres imprimiveis
                if (e.charCode && e.charCode >= 32) {
                    return { action: "CHAR", value: String.fromCharCode(e.charCode) };
                }
                return null;
            }
            if (a.indexOf("DIGIT_") === 0) {
                return { action: "DIGIT", value: a.substring(6) };
            }
            return { action: a, value: null };
        }

        // Navegador de PC
        switch (code) {
            case 38: return { action: "UP" };
            case 40: return { action: "DOWN" };
            case 37: return { action: "LEFT" };
            case 39: return { action: "RIGHT" };
            case 13: return { action: "ENTER" };
            case 27: return { action: "RETURN" };
            case 8: return { action: "BACKSPACE" };
            case 33: return { action: "CH_UP" };
            case 34: return { action: "CH_DOWN" };
            case 112: return { action: "RED" };    // F1
            case 113: return { action: "GREEN" };  // F2
            case 114: return { action: "YELLOW" }; // F3
            case 115: return { action: "BLUE" };   // F4
            case 120: return { action: "INFO" };   // F9
        }
        if (code >= 48 && code <= 57 && !e.shiftKey) return { action: "DIGIT", value: String(code - 48) };
        if (code >= 96 && code <= 105) return { action: "DIGIT", value: String(code - 96) };
        return null;
    }
};
