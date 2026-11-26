(function (root) {
  'use strict';

  function saveManifest(text, done) {
    var fs = root.tizen && root.tizen.filesystem;
    if (!fs || !text) { done(''); return; }
    var name = 'streamtube-selection.m3u8';
    var finished = false;
    function finish(url) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(url);
    }
    var timer = setTimeout(function () { finish(''); }, 1500);
    try {
      fs.resolve('wgt-private-tmp', function (directory) {
        if (finished) return;
        try {
          var file;
          try { file = directory.resolve(name); }
          catch (e) { file = directory.createFile(name); }
          file.openStream('w', function (stream) {
            var url = '';
            try {
              if (!finished) {
                stream.write(text);
                url = file.toURI();
              }
            } catch (e) { url = ''; }
            finally { stream.close(); }
            finish(/^file:\/\/\//i.test(url) ? url : '');
          }, function () { finish(''); }, 'UTF-8');
        } catch (e) { finish(''); }
      }, function () { finish(''); }, 'rw');
    } catch (e) { finish(''); }
  }

  function trackInfo(track) {
    var info = track.extra_info;
    if (typeof info === 'string') {
      try { info = JSON.parse(info); }
      catch (e) { return {}; }
    }
    return info || {};
  }

  function applyRussian(av, languageMatches) {
    try {
      var current = av.getCurrentStreamInfo();
      var audio = av.getTotalTrackInfo();
      var russian = audio.filter(function (track) {
        if (track.type !== 'AUDIO') return false;
        var info = trackInfo(track);
        return languageMatches(info.track_lang || info.language || info.Language,
          info.track_name || info.name || info.label);
      })[0];
      if (russian && !current.some(function (track) { return track.type === 'AUDIO' && track.index === russian.index; })) {
        av.setSelectTrack('AUDIO', russian.index);
      }
    } catch (e) { /* Some firmware exposes audio only through the manifest. */ }
  }

  function actualHeight(av) {
    try {
      var tracks = av.getCurrentStreamInfo();
      for (var i = 0; i < tracks.length; i += 1) {
        if (tracks[i].type !== 'VIDEO') continue;
        var info = trackInfo(tracks[i]);
        var width = Number(info.Width || info.width);
        var height = Number(info.Height || info.height);
        if (width > 0 && height > 0) return Math.min(width, height);
        return height > 0 ? height : 0;
      }
    } catch (e) { /* Stream metadata can be unavailable while buffering. */ }
    return 0;
  }

  root.StreamTubeMedia = {
    saveManifest: saveManifest,
    applyRussian: applyRussian,
    actualHeight: actualHeight
  };
}(typeof window === 'undefined' ? module.exports : window));
