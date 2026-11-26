(function (root) {
  'use strict';

  function create(video, variant) {
    var Hls = root.Hls;
    if (!video || !Hls || !variant.manifest || !root.MediaSource || !Hls.isSupported()) return null;
    if (variant.codec && !root.MediaSource.isTypeSupported('video/mp4; codecs="' + variant.codec + '"')) return null;

    var hls;
    var source;
    var listener;
    var events = [];
    var state = 'NONE';

    function on(name, callback) {
      video.addEventListener(name, callback);
      events.push([name, callback]);
    }

    function seek(ms, done, failed) {
      try {
        video.currentTime = Math.max(0, ms / 1000);
        if (done) done();
      } catch (e) { if (failed) failed(e); }
    }

    return {
      getState: function () { return state; },
      open: function () {
        state = 'IDLE';
        video.hidden = false;
        hls = new Hls({ enableWorker: false, startLevel: 0, capLevelToPlayerSize: false, lowLatencyMode: false });
        source = root.URL.createObjectURL(new Blob([variant.manifest], { type: 'application/vnd.apple.mpegurl' }));
      },
      close: function () {
        state = 'NONE';
        events.forEach(function (entry) { video.removeEventListener(entry[0], entry[1]); });
        events = [];
        if (hls) { hls.destroy(); hls = null; }
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.hidden = true;
        if (source) { root.URL.revokeObjectURL(source); source = null; }
      },
      setListener: function (value) { listener = value; },
      prepareAsync: function (done, failed) {
        function error(code) {
          if (state === 'IDLE') failed({ name: code });
          else if (state !== 'NONE') listener.onerror(code);
        }
        on('canplay', function () {
          if (state !== 'IDLE') return;
          state = 'READY';
          done();
        });
        on('waiting', function () { if (state === 'PLAYING') listener.onbufferingstart(); });
        on('playing', function () { listener.onbufferingcomplete(); });
        on('timeupdate', function () { listener.oncurrentplaytime(video.currentTime * 1000); });
        on('ended', function () { listener.onstreamcompleted(); });
        on('error', function () { error('HTMLVideoElement'); });
        hls.on(Hls.Events.ERROR, function (event, data) {
          if (data.fatal) error(data.details || 'HLS');
        });
        hls.attachMedia(video);
        hls.loadSource(source);
      },
      play: function () {
        state = 'PLAYING';
        var result = video.play();
        if (result && result.catch) result.catch(function () {
          if (state === 'PLAYING') listener.onerror('HTMLVideoElement play');
        });
      },
      pause: function () { state = 'PAUSED'; video.pause(); },
      setSpeed: function (rate) { video.playbackRate = rate; },
      getCurrentTime: function () { return Math.round(video.currentTime * 1000); },
      getDuration: function () { return Math.round(video.duration * 1000); },
      getCurrentStreamInfo: function () {
        return [{ type: 'VIDEO', extra_info: { Width: video.videoWidth, Height: video.videoHeight } }];
      },
      seekTo: seek,
      jumpForward: function (ms) { seek(video.currentTime * 1000 + ms); },
      jumpBackward: function (ms) { seek(video.currentTime * 1000 - ms); }
    };
  }

  root.StreamTubeWebPlayer = { create: create };
}(typeof window === 'undefined' ? module.exports : window));
