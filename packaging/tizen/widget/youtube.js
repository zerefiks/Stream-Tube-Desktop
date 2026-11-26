/* Search and iOS HLS extraction adapted from Stream Tube (MIT). */
(function (root) {
  'use strict';
  var base = 'https://www.youtube.com/youtubei/v1/';
  var videoId = /^[A-Za-z0-9_-]{11}$/;
  var streamUrl = /^https:\/\/(?:[a-z0-9-]+\.)*(?:googlevideo\.com|youtube\.com)\//i;
  var visitorData;
  var clients = {
    web: { clientName: 'WEB', clientVersion: '2.20251120.01.00', hl: 'ru' },
    vision: {
      clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      hl: 'ru'
    },
    ios: {
      clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple',
      deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '18.3.2.22D82',
      userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
      hl: 'ru'
    }
  };

  function request(endpoint, client, body, done, token) {
    var req = new XMLHttpRequest();
    try {
      req.open('POST', base + endpoint + '?prettyPrint=false', true);
      req.timeout = 10000;
      req.setRequestHeader('Content-Type', 'application/json');
      if (token) req.setRequestHeader('Authorization', 'Bearer ' + token);
      req.onload = function () {
        if (req.status !== 200) {
          done('YouTube вернул HTTP ' + req.status + '.');
          return;
        }
        var value;
        try { value = JSON.parse(req.responseText); }
        catch (e) { done('Некорректный ответ YouTube.'); return; }
        done(null, value);
      };
      req.onerror = function () { done('Телевизор не получил ответ YouTube. Проверьте доступ к сети.'); };
      req.ontimeout = function () { done('YouTube не ответил вовремя.'); };
      body.context = { client: client };
      req.send(JSON.stringify(body));
    } catch (e) {
      done('Ошибка сетевого запроса к YouTube.');
    }
  }

  function title(text) {
    if (!text) return '';
    if (text.simpleText || text.content) return text.simpleText || text.content;
    return (text.runs || []).map(function (run) { return run.text || ''; }).join('');
  }

  function collect(data, filter) {
    var items = [];
    var seen = Object.create(null);
    function walk(node) {
      if (!node || typeof node !== 'object' || items.length >= 30) return;
      var item = node.videoRenderer || node.gridVideoRenderer || node.compactVideoRenderer ||
        node.videoWithContextRenderer || node.playlistVideoRenderer || node.playlistPanelVideoRenderer;
      var tile = node.tileRenderer;
      var lockup = node.lockupViewModel;
      var id = item && item.videoId;
      var name = item && title(item.title);
      var byline = item && title(item.ownerText || item.shortBylineText || item.longBylineText);
      var duration = item && title(item.lengthText);
      var reel = node.reelItemRenderer;
      var shorts = node.shortsLockupViewModel;
      var channel = node.channelRenderer;
      var playlist = node.playlistRenderer || node.gridPlaylistRenderer;
      var kind = 'video';
      if (tile && (!tile.contentType || tile.contentType === 'TILE_CONTENT_TYPE_VIDEO')) {
        id = tile.contentId || ((tile.onSelectCommand || {}).watchEndpoint || {}).videoId;
        name = title(((tile.metadata || {}).tileMetadataRenderer || {}).title);
      }
      if (lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        id = lockup.contentId;
        name = (((lockup.metadata || {}).lockupMetadataViewModel || {}).title || {}).content;
      }
      if (reel || shorts) {
        kind = 'shorts';
        var command = (((shorts || {}).onTap || {}).innertubeCommand || {}).reelWatchEndpoint;
        id = reel ? reel.videoId : (command || {}).videoId;
        name = title(reel ? reel.headline : ((shorts || {}).overlayMetadata || {}).primaryText);
      }
      if (channel && filter) {
        kind = 'channel'; id = channel.channelId; name = title(channel.title);
      }
      if ((playlist || (lockup && lockup.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST')) && filter) {
        kind = 'playlist'; id = playlist ? playlist.playlistId : lockup.contentId;
        name = playlist ? title(playlist.title) : title(((lockup.metadata || {}).lockupMetadataViewModel || {}).title);
      }
      var valid = typeof id === 'string' && (kind === 'channel' ? /^UC[A-Za-z0-9_-]{22}$/.test(id) :
        kind === 'playlist' ? /^[A-Za-z0-9_-]{2,80}$/.test(id) : videoId.test(id));
      var matches = filter === 'all' || !filter || filter === kind || (filter === 'live' && kind === 'video');
      if (valid && matches && !seen[id]) {
        seen[id] = true;
        items.push({ id: id, title: name || id, byline: byline, duration: duration,
          channel: kind === 'channel', playlist: kind === 'playlist' });
        return;
      }
      Object.keys(node).forEach(function (key) {
        if (!/adSlot|promoted|frameworkUpdates|topbar|menu/i.test(key)) walk(node[key]);
      });
    }
    walk(data);
    return items;
  }

  function mediaLanguage(language, name) {
    return /^(ru|rus)(?:[-_]|$)/i.test(language || '') || /русск|russian/i.test(name || '');
  }

  function variants(manifest, masterUrl) {
    var byHeight = Object.create(null);
    var groups = Object.create(null);
    var general = ['#EXTM3U'];
    var streams = [];
    var pending;
    function absolute(value) {
      try {
        var url = new URL(value, masterUrl);
        return streamUrl.test(url.href) ? url.href : '';
      } catch (e) { return ''; }
    }
    manifest.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (/^#EXT-X-(?:VERSION:|INDEPENDENT-SEGMENTS$)/.test(line)) general.push(line);
      if (line.indexOf('#EXT-X-MEDIA:') === 0 && /[:,]TYPE=AUDIO(?:,|$)/.test(line)) {
        var group = /[:,]GROUP-ID="([^"]+)"/.exec(line);
        var uri = /[:,]URI="([^"]+)"/.exec(line);
        var url = uri && absolute(uri[1]);
        if (!group || !url) return;
        var language = /[:,]LANGUAGE="([^"]+)"/.exec(line);
        var name = /[:,]NAME="([^"]+)"/.exec(line);
        var rank = mediaLanguage(language && language[1], name && name[1]) ? 3 :
          /acont(?:=|%3D)original|\boriginal\b|оригинал/i.test(line) ? 2 :
          /[:,]DEFAULT=YES(?:,|$)/.test(line) ? 1 : 0;
        if (!groups[group[1]] || groups[group[1]].rank < rank) {
          groups[group[1]] = { rank: rank, line: line.replace(uri[0], uri[0][0] + 'URI="' + url + '"') };
        }
      } else if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
        pending = line;
      } else if (line && line[0] !== '#' && pending) {
        var variantUrl = absolute(line);
        if (variantUrl) streams.push({ line: pending, url: variantUrl });
        pending = null;
      }
    });
    streams.forEach(function (entry) {
      var size = /[:,]RESOLUTION=([0-9]+)x([0-9]+)/i.exec(entry.line);
      var bandwidth = /[:,]BANDWIDTH=([0-9]+)/i.exec(entry.line);
      var audio = /[:,]AUDIO="([^"]+)"/.exec(entry.line);
      if (!size || !bandwidth || (audio && !groups[audio[1]])) return;
      var height = Math.min(Number(size[1]), Number(size[2]));
      var bitrate = Number(bandwidth[1]);
      var codecs = /[:,]CODECS="([^",]+)[^"]*"/i.exec(entry.line);
      var codecRank = /CODECS="avc[13]/i.test(entry.line) ? 3 :
        /CODECS="(?:hvc1|hev1)/i.test(entry.line) ? 2 : 1;
      var selectedAudio = audio && groups[audio[1]];
      var manifestLines = general.slice();
      if (selectedAudio) {
        manifestLines.push(selectedAudio.line.replace(/,(?:DEFAULT|AUTOSELECT)=(?:YES|NO)/g, '') +
          ',DEFAULT=YES,AUTOSELECT=YES');
      }
      manifestLines.push(entry.line.replace(/,SUBTITLES="[^"]+"/, ''), entry.url);
      var variant = { height: height, bitrate: bitrate, codecRank: codecRank,
        codec: codecs && codecs[1],
        russian: !!(selectedAudio && selectedAudio.rank === 3), manifest: manifestLines.join('\n') + '\n' };
      if (!byHeight[height] || (variant.russian && !byHeight[height].russian) ||
          (variant.russian === byHeight[height].russian && (codecRank > byHeight[height].codecRank ||
            (codecRank === byHeight[height].codecRank && bitrate > byHeight[height].bitrate)))) {
        byHeight[height] = variant;
      }
    });
    return Object.keys(byHeight).map(Number).sort(function (a, b) { return b - a; })
      .map(function (height) { return byHeight[height]; });
  }

  function playlists(data) {
    var items = [];
    var seen = Object.create(null);
    function walk(node) {
      if (!node || typeof node !== 'object' || items.length >= 30) return;
      var tile = node.tileRenderer;
      var id = tile && tile.contentId;
      if (tile && tile.contentType === 'TILE_CONTENT_TYPE_PLAYLIST' &&
          typeof id === 'string' && /^[A-Za-z0-9_-]{2,80}$/.test(id) && !seen[id]) {
        seen[id] = true;
        items.push({
          id: id,
          title: title(((tile.metadata || {}).tileMetadataRenderer || {}).title) || id,
          playlist: true
        });
        return;
      }
      Object.keys(node).forEach(function (key) { walk(node[key]); });
    }
    walk(data);
    return items;
  }

  function parseId(value) {
    value = value.trim();
    if (videoId.test(value)) return value;
    var match = /^(?:https?:\/\/)?(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i.exec(value);
    return match ? match[1] : '';
  }

  function resolve(id, done) {
    if (!videoId.test(id)) {
      done('Некорректный идентификатор видео.');
      return;
    }
    function attempt(index, lastError) {
      if (index === 2) {
        done(lastError);
        return;
      }
      var client = index === 0 ? clients.vision : clients.ios;
      request('player', client, { videoId: id }, function (error, data) {
        if (error) {
          attempt(index + 1, error);
          return;
        }
        var url = (data.streamingData || {}).hlsManifestUrl;
        if (typeof url === 'string' && streamUrl.test(url)) {
          var details = data.videoDetails || {};
          done(null, { url: url, title: details.title, channelId: details.channelId, author: details.author });
          return;
        }
        var reason = (data.playabilityStatus || {}).reason;
        attempt(index + 1, reason || 'YouTube не предоставил HLS-поток для этого видео.');
      });
    }
    if (visitorData) { attempt(0); return; }
    request('visitor_id', clients.web, {}, function (error, data) {
      if (!error) {
        var value = (data.responseContext || {}).visitorData;
        if (typeof value === 'string' && value) {
          visitorData = value;
          clients.vision.visitorData = value;
        }
      }
      attempt(0);
    });
  }

  root.StreamTubeYouTube = {
    parseId: parseId,
    collect: collect,
    variants: variants,
    mediaLanguage: mediaLanguage,
    loadVariants: function (url, done) {
      var req = new XMLHttpRequest();
      try {
        req.open('GET', url, true);
        req.timeout = 8000;
        req.onload = function () { done(req.status === 200 ? variants(req.responseText, req.responseURL || url) : []); };
        req.onerror = req.ontimeout = function () { done([]); };
        req.send();
      } catch (e) { done([]); }
    },
    feed: function (browseId, token, done) {
      var client = { clientName: 'TVHTML5', clientVersion: '7.20251120.13.00', hl: 'ru' };
      request('browse', client, { browseId: browseId }, function (error, data) {
        if (error) done(error);
        else done(null, browseId === 'FEplaylist_aggregation' ? playlists(data) : collect(data));
      }, token);
    },
    related: function (id, done) {
      request('next', clients.web, { videoId: id }, function (error, data) {
        if (error) done(error);
        else done(null, collect(data).filter(function (item) { return item.id !== id; }));
      });
    },
    channel: function (channelId, done) {
      request('browse', clients.web, { browseId: channelId }, function (error, data) {
        if (error) done(error);
        else done(null, collect(data));
      });
    },
    search: function (query, done, filter) {
      var body = { query: query };
      var params = { video: 'EgIQAQ==', channel: 'EgIQAg==', playlist: 'EgIQAw==', live: 'EgJAAQ==' };
      if (params[filter]) body.params = params[filter];
      request('search', clients.web, body, function (error, data) {
        if (error) done(error);
        else done(null, collect(data, filter));
      });
    },
    watch: function (id, done) {
      request('next', clients.web, { videoId: id }, function (error, data) {
        if (error) { done(error); return; }
        var live = find(data, 'liveChatRenderer');
        var first = ((live || {}).continuations || [])[0] || {};
        done(null, {
          items: collect(data).filter(function (item) { return item.id !== id; }),
          chat: live && !live.isReplay && (first.reloadContinuationData || {}).continuation
        });
      });
    },
    chat: function (token, done) {
      request('live_chat/get_live_chat', clients.web, { continuation: token }, function (error, data) {
        if (error) { done(error); return; }
        var chat = (data.continuationContents || {}).liveChatContinuation;
        if (!chat) { done('Чат завершён.'); return; }
        var messages = (chat.actions || []).map(function (action) {
          var item = (action.addChatItemAction || {}).item || {};
          var value = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer;
          return value ? { author: title(value.authorName), text: title(value.message) } : null;
        }).filter(function (message) { return message && message.text; });
        var entry = (chat.continuations || [])[0] || {};
        var next = entry.timedContinuationData || entry.invalidationContinuationData || entry.reloadContinuationData || {};
        done(null, { messages: messages, token: next.continuation, delay: next.timeoutMs });
      });
    },
    sponsorSegments: function (id, done) {
      var req = new XMLHttpRequest();
      req.open('GET', 'https://sponsor.ajay.app/api/skipSegments?videoID=' +
        encodeURIComponent(id) + '&categories=%5B%22sponsor%22%5D', true);
      req.timeout = 6000;
      req.onload = function () {
        if (req.status !== 200) return;
        try {
          var segments = JSON.parse(req.responseText).map(function (entry) { return entry.segment; });
          done(segments.filter(function (pair) {
            return Array.isArray(pair) && pair.length === 2 &&
              typeof pair[0] === 'number' && isFinite(pair[0]) && pair[0] >= 0 &&
              typeof pair[1] === 'number' && isFinite(pair[1]) && pair[1] > pair[0];
          }));
        } catch (e) { /* Playback continues without segments. */ }
      };
      req.send();
    },
    resolve: resolve
  };
  function find(node, key) {
    if (!node || typeof node !== 'object') return null;
    if (node[key]) return node[key];
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i += 1) {
      var result = find(node[keys[i]], key);
      if (result) return result;
    }
    return null;
  }
}(typeof window === 'undefined' ? module.exports : window));
