/**
 * SAMSUNGTVLEGACY - M3U / M3U8 Playlist Parser
 * Parses standard M3U/M3U8 playlists into categories, logos, names, and streams
 */
var M3UParser = {
    parse: function(text) {
        var lines = text.split(/\r?\n/);
        var categoriesMap = {};
        var allChannels = [];
        var currentInfo = null;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i].replace(/^\s+|\s+$/g, "");
            if (!line) continue;

            if (line.indexOf('#EXTINF:') === 0) {
                currentInfo = this.parseExtInf(line);
            } else if (line.indexOf('http://') === 0 || line.indexOf('https://') === 0 || line.indexOf('rtmp://') === 0) {
                if (currentInfo) {
                    var channel = {
                        id: allChannels.length + 1,
                        name: currentInfo.name || ("Canal " + (allChannels.length + 1)),
                        logo: currentInfo.logo || "",
                        group: currentInfo.group || "Geral",
                        url: line
                    };

                    allChannels.push(channel);

                    if (!categoriesMap[channel.group]) {
                        categoriesMap[channel.group] = [];
                    }
                    categoriesMap[channel.group].push(channel);

                    currentInfo = null;
                }
            }
        }

        var categories = ["Todos"];
        for (var cat in categoriesMap) {
            if (categoriesMap.hasOwnProperty(cat)) {
                categories.push(cat);
            }
        }

        return {
            categories: categories,
            categoriesMap: categoriesMap,
            allChannels: allChannels
        };
    },

    parseExtInf: function(line) {
        var info = {
            name: "",
            logo: "",
            group: "Geral"
        };

        // Extract tvg-logo
        var logoMatch = line.match(/tvg-logo="([^"]*)"/i);
        if (logoMatch && logoMatch[1]) {
            info.logo = logoMatch[1];
        }

        // Extract group-title
        var groupMatch = line.match(/group-title="([^"]*)"/i);
        if (groupMatch && groupMatch[1]) {
            info.group = groupMatch[1];
        }

        // Extract channel name (after last comma)
        var lastComma = line.lastIndexOf(',');
        if (lastComma !== -1 && lastComma < line.length - 1) {
            info.name = line.substring(lastComma + 1).replace(/^\s+|\s+$/g, "");
        }

        return info;
    }
};
