(function () {
  'use strict';
  var api = window.StreamTubeYouTube;
  var media = window.StreamTubeMedia;
  var webVideo = document.getElementById('web-video');
  var nativeVideo = document.getElementById('av');
  var auth = window.StreamTubeAuth;
  var browse = document.getElementById('browse');
  var player = document.getElementById('player');
  var results = document.getElementById('results');
  var query = document.getElementById('query');
  var status = document.getElementById('status');
  var playStatus = document.getElementById('play-status');
  var back = document.getElementById('back');
  var pause = document.getElementById('pause');
  var quality = document.getElementById('quality');
  var qualityMenu = document.getElementById('quality-menu');
  var resolutionStatus = document.getElementById('resolution-status');
  var speed = document.getElementById('speed');
  var related = document.getElementById('related');
  var channel = document.getElementById('channel');
  var chat = document.getElementById('chat');
  var panel = document.getElementById('watch-panel');
  var panelItems = document.getElementById('watch-panel-items');
  var panelClose = document.getElementById('watch-panel-close');
  var panelStatus = document.getElementById('watch-panel-status');
  var panelTitle = document.getElementById('watch-panel-title');
  var filters = document.getElementById('filters');
  var preferences = document.getElementById('preferences');
  var autoplay = document.getElementById('autoplay');
  var cloudHistory = document.getElementById('cloud-history');
  var login = document.getElementById('login');
  var account = document.getElementById('account');
  var loginClose = document.getElementById('login-close');
  var signout = document.getElementById('signout');
  var sectionTitle = document.getElementById('section-title');
  var sponsor = document.getElementById('sponsor');
  var overlay = player.querySelector('.overlay');
  var nativePlayer = window.webapis && window.webapis.avplay;
  var av = nativePlayer;
  var generation = 0;
  var searchGeneration = 0;
  var previousFocus;
  var overlayTimer;
  var prepareTimer;
  var cancelLogin;
  var nextItems = [];
  var chatToken;
  var panelMode = '';
  var panelRevision = 0;
  var chatTimer;
  var watchLoaded = false;
  var watchError = '';
  var lastSearch = '';
  var playbackRate = 1;
  var history = [];
  var sponsorEnabled = false;
  var autoplayEnabled = false;
  try {
    sponsorEnabled = localStorage.getItem('streamtube-sponsor') === 'on';
    autoplayEnabled = localStorage.getItem('streamtube-autoplay') === 'on';
    history = JSON.parse(localStorage.getItem('streamtube-history') || '[]');
  }
  catch (e) { history = []; }
  if (!Array.isArray(history)) history = [];

  function remember(item) {
    history = [item].concat(history.filter(function (old) { return old.id !== item.id; })).slice(0, 30);
    try { localStorage.setItem('streamtube-history', JSON.stringify(history)); }
    catch (e) { /* Playback stays available when storage is full. */ }
  }

  function render(items, target) {
    target = target || results;
    target.textContent = '';
    items.forEach(function (item) {
      var button = document.createElement('button');
      var image = document.createElement('img');
      var label = document.createElement('span');
      button.className = 'card';
      image.alt = '';
      label.textContent = item.title;
      if (item.playlist || item.channel) {
        button.className += ' playlist';
      } else {
        image.src = 'https://i.ytimg.com/vi/' + item.id + '/mqdefault.jpg';
        button.appendChild(image);
      }
      button.appendChild(label);
      if (target === results && (item.byline || item.duration)) {
        var meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = [item.byline, item.duration].filter(Boolean).join(' · ');
        button.appendChild(meta);
      }
      button.onclick = function () {
        if (item.channel) {
          query.focus();
          showVideos(item.title, function (done) { api.channel(item.id, done); }, true);
          return;
        }
        if (!item.playlist) { openVideo(item); return; }
        query.focus();
        showVideos(item.title, function (done) {
          if (auth.signedIn()) privateFeed('VL' + item.id, done);
          else api.channel('VL' + item.id, done);
        }, true);
      };
      target.appendChild(button);
    });
  }

  function controls() {
    clearTimeout(overlayTimer);
    overlay.classList.remove('dormant');
    if (panel.hidden && qualityMenu.hidden && !playStatus.textContent && av && av.getState() === 'PLAYING') {
      overlayTimer = setTimeout(function () { overlay.classList.add('dormant'); }, 4000);
    }
  }

  function resizeVideo() {
    player.classList.toggle('with-panel', !panel.hidden);
    if (!av || av !== nativePlayer || av.getState() === 'NONE') return;
    try {
      if (panel.hidden) av.setDisplayRect(0, 0, 1920, 1080);
      else av.setDisplayRect(0, 173, 1306, 734);
    } catch (e) { /* AVPlay may be changing state during preparation. */ }
  }

  function closePanel(restoreFocus) {
    panelRevision += 1;
    clearTimeout(chatTimer);
    panel.hidden = true;
    panelMode = '';
    resizeVideo();
    if (restoreFocus) related.focus();
  }

  function updateNextPanel() {
    render(nextItems.slice(0, 14), panelItems);
    panelStatus.textContent = watchError || (!watchLoaded ? 'Загрузка…' : nextItems.length ? '' : 'Нет рекомендаций.');
  }

  function showPanel(mode) {
    panelMode = mode;
    var revision = ++panelRevision;
    clearTimeout(chatTimer);
    panel.hidden = false;
    panelTitle.textContent = mode === 'chat' ? 'Чат эфира' : 'Смотреть далее';
    resizeVideo();
    controls();
    if (mode === 'next') {
      updateNextPanel();
      (panelItems.firstChild || panelClose).focus();
      return;
    }
    panelItems.textContent = '';
    panelStatus.textContent = 'Загрузка…';
    panelClose.focus();
    function poll(token) {
      api.chat(token, function (error, batch) {
        if (revision !== panelRevision) return;
        panelStatus.textContent = error || '';
        if (error) return;
        batch.messages.forEach(function (entry) {
          var line = document.createElement('p');
          line.className = 'chat-line';
          line.textContent = entry.author + ' · ' + entry.text;
          panelItems.appendChild(line);
        });
        while (panelItems.children.length > 25) panelItems.removeChild(panelItems.firstChild);
        if (batch.token) {
          chatTimer = setTimeout(function () { poll(batch.token); }, Math.max(3000, Number(batch.delay) || 5000));
        }
      });
    }
    poll(chatToken);
  }

  function closeEngine() {
    clearTimeout(prepareTimer);
    if (!av) return;
    try { if (av.getState() !== 'NONE') av.close(); }
    catch (e) { /* The engine may already have closed after an error. */ }
  }

  function returnToBrowse() {
    generation += 1;
    closeEngine();
    closePanel(false);
    clearTimeout(overlayTimer);
    player.hidden = true;
    browse.hidden = false;
    document.body.classList.remove('playing');
    quality.onclick = null;
    qualityMenu.hidden = true;
    (previousFocus && document.contains(previousFocus) ? previousFocus : query).focus();
  }

  function openVideo(item) {
    if (player.hidden) previousFocus = document.activeElement;
    var attempt = ++generation;
    closeEngine();
    closePanel(false);
    qualityMenu.hidden = true;
    browse.hidden = true;
    player.hidden = false;
    document.body.classList.add('playing');
    back.focus();
    document.getElementById('title').textContent = item.title;
    playStatus.textContent = 'Получаем поток…';
    controls();
    nextItems = [];
    watchLoaded = false;
    watchError = '';
    chatToken = '';
    chat.hidden = true;
    var available = [{ height: 0, bitrate: 0 }];
    var selected = 0;
    var engineRun = 0;
    playbackRate = 1;
    speed.textContent = 'Скорость · 1×';
    channel.hidden = true;
    quality.textContent = 'Качество · Авто';
    quality.disabled = true;
    resolutionStatus.textContent = '';
    var segments = [];
    var skipped = {};
    function fail(message) {
      if (attempt !== generation) return;
      closeEngine();
      playStatus.textContent = message;
      controls();
    }
    if (!nativePlayer && !(window.Hls && window.MediaSource)) {
      fail('AVPlay доступен только в приложении на Samsung TV.');
      return;
    }
    api.watch(item.id, function (error, watch) {
      if (attempt !== generation) return;
      watchLoaded = true;
      watchError = error || '';
      if (!error) {
        nextItems = watch.items;
        chatToken = watch.chat;
        chat.hidden = !chatToken;
      }
      if (panelMode === 'next') updateNextPanel();
    });
    api.resolve(item.id, function (error, info) {
      if (attempt !== generation) return;
      if (error) { fail(error); return; }
      var name = info.title || item.title;
      document.getElementById('title').textContent = name;
      channel.hidden = !/^UC[A-Za-z0-9_-]{22}$/.test(info.channelId || '');
      channel.onclick = function () {
        returnToBrowse();
        activeSection('');
        query.focus();
        showVideos(info.author || 'Канал', function (done) { api.channel(info.channelId, done); }, true);
      };
      quality.onclick = function () {
        var state = av.getState();
        if (state !== 'PLAYING' && state !== 'PAUSED') return;
        qualityMenu.textContent = '';
        var focused;
        available.forEach(function (option, index) {
          var entry = document.createElement('button');
          entry.textContent = option.height ? option.height + 'p' : 'Авто';
          entry.setAttribute('aria-pressed', String(selected === index));
          entry.onclick = function () {
            qualityMenu.hidden = true;
            quality.focus();
            controls();
            if (selected === index) return;
            var state = av.getState();
            if (state !== 'PLAYING' && state !== 'PAUSED') return;
            selected = index;
            startEngine(av.getCurrentTime(), state === 'PAUSED', false, false);
          };
          qualityMenu.appendChild(entry);
          if (selected === index) focused = entry;
        });
        qualityMenu.hidden = false;
        (focused || qualityMenu.firstChild).focus();
        controls();
      };
      var sponsorRequested = false;
      api.loadVariants(info.url, function (variants) {
        if (attempt !== generation) return;
        available = available.concat(variants);
        selected = variants.length ? 1 : 0;
        startEngine(0, false, false, true);
      });
      function startEngine(time, wasPaused, remote, preferHigh, skipWeb) {
        var run = ++engineRun;
        var lastTime = time;
        var lastReport = 0;
        var checkedAudio = false;
        var local = false;
        var web = null;
        function isCurrent() { return attempt === generation && run === engineRun; }
        function reportHeight() {
          var height = media.actualHeight(av);
          var requested = available[selected].height;
          resolutionStatus.textContent = (height ? 'Фактическое разрешение · ' + height + 'p' : 'Фактическое разрешение недоступно') +
            (height && requested && height !== requested ? ' (выбрано ' + requested + 'p)' : '') +
            (web ? ' · HLS' : ' · AVPlay');
        }
        function engineError(message) {
          if (!isCurrent()) return;
          if (web && nativePlayer) {
            startEngine(lastTime, wasPaused, false, preferHigh, true);
            return;
          }
          if (local) {
            startEngine(lastTime, wasPaused, true, preferHigh, true);
            return;
          }
          if (selected) {
            selected = preferHigh && selected + 1 < available.length ? selected + 1 : 0;
            startEngine(lastTime, wasPaused, false, preferHigh);
            return;
          }
          engineRun += 1;
          fail(message);
        }
        closeEngine();
        var variant = available[selected];
        if (variant.manifest && !skipWeb && window.StreamTubeWebPlayer) {
          try { web = window.StreamTubeWebPlayer.create(webVideo, variant); }
          catch (e) { web = null; }
        }
        av = web || nativePlayer;
        nativeVideo.hidden = !!web;
        if (!av) { fail('Для этого потока нет доступного декодера.'); return; }
        quality.textContent = 'Качество · ' + (variant.height ? variant.height + 'p' : 'Авто');
        resolutionStatus.textContent = '';
        playStatus.textContent = 'Буферизация…';
        controls();
        function launch(url) {
          if (!isCurrent()) return;
          local = !!url;
          try {
            av.open(url || info.url);
            if (!web && !local && (variant.bitrate || preferHigh)) {
              var settings = variant.bitrate ? 'BITRATES=' + variant.bitrate + '|STARTBITRATE=HIGHEST' : 'STARTBITRATE=HIGHEST';
              try { av.setStreamingProperty('ADAPTIVE_INFO', settings); }
              catch (e) { if (variant.bitrate) throw e; }
            }
            resizeVideo();
            av.setListener({
              onstreamcompleted: function () {
                if (!isCurrent()) return;
                if (autoplayEnabled && nextItems.length) openVideo(nextItems[0]);
                else returnToBrowse();
              },
              oncurrentplaytime: function (ms) {
                if (!isCurrent()) return;
                lastTime = ms;
                if (Date.now() - lastReport > 2500) {
                  lastReport = Date.now();
                  reportHeight();
                  if (!web && !checkedAudio) {
                    checkedAudio = true;
                    media.applyRussian(av, api.mediaLanguage);
                  }
                }
                segments.some(function (pair, index) {
                  var end = Math.floor(pair[1] * 1000);
                  if (skipped[index] || ms < pair[0] * 1000 || end - ms < 500) return false;
                  skipped[index] = true;
                  try {
                    if (end < av.getDuration()) av.seekTo(end, function () {}, function () {});
                  } catch (e) { /* Seeking can fail on live streams. */ }
                  return true;
                });
              },
              onerror: function (code) { engineError('Ошибка AVPlay: ' + code); },
              onbufferingstart: function () {
                if (isCurrent()) { playStatus.textContent = 'Буферизация…'; controls(); }
              },
              onbufferingcomplete: function () {
                if (isCurrent()) { reportHeight(); playStatus.textContent = ''; controls(); }
              }
            });
            if (web || local) prepareTimer = setTimeout(function () { engineError('Истекло время открытия HLS.'); }, 9000);
            av.prepareAsync(function () {
              if (!isCurrent()) return;
              clearTimeout(prepareTimer);
              try {
                av.play();
                if (!web) media.applyRussian(av, api.mediaLanguage);
                reportHeight();
                quality.disabled = false;
                function restorePlayback() {
                  if (!isCurrent()) return;
                  try {
                    if (playbackRate !== 1) av.setSpeed(playbackRate);
                    if (wasPaused && av.getState() === 'PLAYING') av.pause();
                  } catch (e) {
                    playbackRate = 1;
                    speed.textContent = 'Скорость · 1×';
                  }
                  controls();
                }
                if (time > 0 && time < av.getDuration()) {
                  try { av.seekTo(time, restorePlayback, restorePlayback); }
                  catch (e) { restorePlayback(); }
                } else restorePlayback();
                remember({ id: item.id, title: name });
                playStatus.textContent = '';
                controls();
                if (sponsorEnabled && !sponsorRequested) {
                  sponsorRequested = true;
                  try {
                    api.sponsorSegments(item.id, function (items) {
                      if (attempt === generation) segments = items;
                    });
                  } catch (e) { /* SponsorBlock is optional. */ }
                }
              } catch (e) { engineError('AVPlay не смог запустить видео: ' + e.name); }
            }, function (e) { engineError('AVPlay не смог открыть HLS: ' + e.name); });
          } catch (e) { engineError('Не удалось настроить AVPlay: ' + e.name); }
        }
        if (!web && variant.manifest && !remote) media.saveManifest(variant.manifest, launch);
        else launch('');
      }
    });
  }

  speed.onclick = function () {
    if (!av) return;
    var state = av.getState();
    if (state !== 'PLAYING' && state !== 'PAUSED') return;
    var rate = playbackRate === 1 ? 2 : 1;
    try {
      av.setSpeed(rate);
      playbackRate = rate;
      speed.textContent = 'Скорость · ' + rate + '×';
      playStatus.textContent = '';
    } catch (e) { playStatus.textContent = 'Смена скорости недоступна для этого потока.'; }
    controls();
  };

  function toggle() {
    if (!av) return;
    try {
      var state = av.getState();
      if (state === 'PLAYING') av.pause();
      if (state === 'PAUSED') av.play();
      controls();
    } catch (e) { playStatus.textContent = 'Пауза недоступна.'; controls(); }
  }

  function showVideos(name, load, focusResults) {
    var attempt = ++searchGeneration;
    sectionTitle.textContent = name;
    preferences.hidden = true;
    filters.hidden = true;
    render([]);
    status.textContent = 'Загрузка…';
    load(function (error, items) {
      if (attempt !== searchGeneration) return;
      if (error) { status.textContent = error; return; }
      render(items);
      status.textContent = items.length ? '' : 'Видео не найдены.';
      if (items.length && focusResults && !browse.hidden) results.firstChild.focus();
    });
  }

  function activeSection(id) {
    var buttons = document.querySelectorAll('#nav [aria-current]');
    for (var i = 0; i < buttons.length; i += 1) buttons[i].removeAttribute('aria-current');
    if (id) document.getElementById(id).setAttribute('aria-current', 'page');
  }

  function search(value, name, filter, showFilters) {
    showVideos(name, function (done) { api.search(value, done, filter || 'all'); }, true);
    filters.hidden = !showFilters;
    var options = filters.querySelectorAll('button');
    for (var i = 0; i < options.length; i += 1) {
      options[i].setAttribute('aria-pressed', String(options[i].getAttribute('data-filter') === (filter || '')));
    }
  }

  function privateFeed(id, done) {
    auth.token(function (error, token) {
      if (error) { updateAccount(); done(error); }
      else api.feed(id, token, done);
    });
  }

  function home() {
    activeSection('home');
    if (auth.signedIn()) {
      showVideos('Рекомендации YouTube', function (done) { privateFeed('FEwhat_to_watch', done); });
    } else if (history.length) {
      showVideos('Рекомендации по просмотрам', function (done) {
        api.related(history[0].id, function (error, items) {
          var unseen = (items || []).filter(function (item) {
            return !history.some(function (watched) { return watched.id === item.id; });
          });
          if (!error && unseen.length) done(null, unseen);
          else api.search('наука технологии документальный фильм', done, 'video');
        });
      });
    } else {
      showVideos('Подборка видео', function (done) { api.search('наука технологии документальный фильм', done, 'video'); });
    }
  }

  function subscriptions() {
    if (!auth.signedIn()) { showLogin(); return; }
    activeSection('subscriptions');
    showVideos('Подписки', function (done) { privateFeed('FEsubscriptions', done); });
  }

  document.getElementById('home').onclick = home;
  document.getElementById('subscriptions').onclick = subscriptions;
  document.getElementById('playlists').onclick = function () {
    if (!auth.signedIn()) { showLogin(); return; }
    activeSection('playlists');
    showVideos('Плейлисты YouTube', function (done) { privateFeed('FEplaylist_aggregation', done); }, true);
  };
  var topics = document.querySelectorAll('#nav [data-query]');
  for (var i = 0; i < topics.length; i += 1) {
    topics[i].onclick = function () {
      activeSection(this.id);
      if (!this.id) this.setAttribute('aria-current', 'page');
      search(this.getAttribute('data-query'), this.textContent, this.getAttribute('data-filter') || 'video', false);
    };
  }
  var searchFilters = filters.querySelectorAll('button');
  for (var j = 0; j < searchFilters.length; j += 1) {
    searchFilters[j].onclick = function () {
      if (lastSearch) search(lastSearch, 'Результаты поиска', this.getAttribute('data-filter'), true);
    };
  }
  document.getElementById('search').onsubmit = function (event) {
    event.preventDefault();
    var value = query.value.trim();
    if (!value) { query.focus(); return; }
    var id = api.parseId(value);
    if (id) {
      searchGeneration += 1;
      status.textContent = '';
      openVideo({ id: id, title: id });
    } else {
      lastSearch = value;
      activeSection('');
      search(value, 'Результаты поиска', '', true);
    }
  };
  document.getElementById('history').onclick = function () {
    activeSection('history');
    showVideos('История на телевизоре', function (done) { done(null, history); }, true);
  };
  cloudHistory.onclick = function () {
    activeSection('cloud-history');
    showVideos('История YouTube', function (done) { privateFeed('FEhistory', done); }, true);
  };
  related.onclick = function () { showPanel('next'); };
  chat.onclick = function () { if (chatToken) showPanel('chat'); };
  panelClose.onclick = function () { closePanel(true); controls(); };
  document.getElementById('settings').onclick = function () {
    searchGeneration += 1;
    activeSection('settings');
    sectionTitle.textContent = 'Настройки';
    filters.hidden = true;
    status.textContent = '';
    render([]);
    preferences.hidden = false;
  };

  var accountFocus;
  function updateAccount() {
    account.textContent = auth.signedIn() ? 'Аккаунт' : 'Войти';
    cloudHistory.hidden = !auth.signedIn();
  }
  function closeLogin() {
    if (cancelLogin) cancelLogin();
    cancelLogin = null;
    login.hidden = true;
    browse.hidden = false;
    (accountFocus || account).focus();
  }
  function showLogin() {
    var message = document.getElementById('login-message');
    var code = document.getElementById('login-code');
    accountFocus = document.activeElement;
    browse.hidden = true;
    login.hidden = false;
    code.textContent = '';
    signout.hidden = !auth.signedIn();
    loginClose.focus();
    if (auth.signedIn()) { message.textContent = 'Аккаунт YouTube подключён.'; return; }
    message.textContent = 'Запрашиваем код входа…';
    cancelLogin = auth.signIn(function (url, value) {
      message.textContent = 'Откройте ' + url + ' на телефоне и введите код.';
      code.textContent = value;
    }, function (error) {
      code.textContent = '';
      if (error) { message.textContent = error; return; }
      updateAccount();
      closeLogin();
      home();
    });
  }
  account.onclick = showLogin;
  document.getElementById('preferences-account').onclick = showLogin;
  loginClose.onclick = closeLogin;
  signout.onclick = function () {
    auth.signOut();
    updateAccount();
    closeLogin();
    home();
  };
  updateAccount();
  back.onclick = returnToBrowse;
  pause.onclick = toggle;
  function updateSponsor() {
    sponsor.textContent = 'SponsorBlock ' + (sponsorEnabled ? 'вкл.' : 'выкл.');
    sponsor.setAttribute('aria-pressed', String(sponsorEnabled));
  }
  sponsor.onclick = function () {
    sponsorEnabled = !sponsorEnabled;
    try { localStorage.setItem('streamtube-sponsor', sponsorEnabled ? 'on' : 'off'); }
    catch (e) { /* The setting still applies for this session. */ }
    updateSponsor();
  };
  updateSponsor();
  function updateAutoplay() {
    autoplay.textContent = 'Автовоспроизведение · ' + (autoplayEnabled ? 'вкл.' : 'выкл.');
    autoplay.setAttribute('aria-pressed', String(autoplayEnabled));
  }
  autoplay.onclick = function () {
    autoplayEnabled = !autoplayEnabled;
    try { localStorage.setItem('streamtube-autoplay', autoplayEnabled ? 'on' : 'off'); }
    catch (e) { /* The setting still applies for this session. */ }
    updateAutoplay();
  };
  updateAutoplay();

  function moveFocus(code) {
    var current = document.activeElement;
    var here = current.getBoundingClientRect();
    var x = (here.left + here.right) / 2;
    var y = (here.top + here.bottom) / 2;
    var buttons = browse.querySelectorAll('input, button');
    var best;
    var distance = Infinity;
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i] === current || buttons[i].hidden || buttons[i].disabled || !buttons[i].offsetWidth) continue;
      var rect = buttons[i].getBoundingClientRect();
      var dx = (rect.left + rect.right) / 2 - x;
      var dy = (rect.top + rect.bottom) / 2 - y;
      var forward = { 37: -dx, 38: -dy, 39: dx, 40: dy }[code];
      if (forward < 5) continue;
      var across = code === 37 || code === 39 ? Math.abs(dy) : Math.abs(dx);
      var score = forward + across * 3;
      if (score < distance) { distance = score; best = buttons[i]; }
    }
    if (best) best.focus();
  }

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (code === 10009 || code === 27) {
      if (!login.hidden) closeLogin();
      else if (!qualityMenu.hidden) { qualityMenu.hidden = true; quality.focus(); controls(); }
      else if (!player.hidden && !panel.hidden) { closePanel(true); controls(); }
      else if (!player.hidden) returnToBrowse();
      else if (document.activeElement === query) query.blur();
      else if (window.tizen) window.tizen.application.getCurrentApplication().exit();
      event.preventDefault();
      return;
    }
    if (!login.hidden) {
      if (code >= 37 && code <= 40 && !signout.hidden) {
        (document.activeElement === signout ? loginClose : signout).focus();
        event.preventDefault();
      }
      return;
    }
    if (!player.hidden) {
      if (!qualityMenu.hidden) {
        if (code === 38 || code === 40) {
          var options = Array.prototype.slice.call(qualityMenu.querySelectorAll('button'));
          var selectedOption = options.indexOf(document.activeElement) + (code === 38 ? -1 : 1);
          if (options[selectedOption]) options[selectedOption].focus();
          event.preventDefault();
        } else if (code === 37 || code === 39) {
          event.preventDefault();
        }
        return;
      }
      if (!panel.hidden && panel.contains(document.activeElement) && code >= 37 && code <= 40) {
        if (code === 37) related.focus();
        if (code === 38 || code === 40) {
          var entries = Array.prototype.slice.call(panelItems.querySelectorAll('button')).concat(panelClose);
          var next = entries.indexOf(document.activeElement) + (code === 38 ? -1 : 1);
          if (entries[next]) entries[next].focus();
          else panel.scrollTop += code === 38 ? -220 : 220;
        }
        event.preventDefault();
        return;
      }
      if (code === 10252 || code === 415 || code === 19) {
        toggle();
      } else if (code === 37 || code === 39) {
        try {
          var state = av && av.getState();
          if (state === 'PLAYING' || state === 'PAUSED') {
            if (code === 37) av.jumpBackward(10000);
            else av.jumpForward(10000);
          }
        } catch (e) { /* Some streams cannot seek. */ }
      } else if (code === 38 || code === 40) {
        var buttons = [back, pause, quality, speed, related, chat, channel].filter(function (button) { return !button.disabled && !button.hidden; });
        var step = code === 38 ? -1 : 1;
        buttons[(buttons.indexOf(document.activeElement) + step + buttons.length) % buttons.length].focus();
      } else return;
      controls();
      event.preventDefault();
      return;
    }
    if (code >= 37 && code <= 40) {
      if (document.activeElement === query && (code === 37 || code === 39)) return;
      moveFocus(code);
      event.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !player.hidden) returnToBrowse();
  });
  if (window.tizen && window.tizen.tvinputdevice) {
    ['MediaPlayPause', 'MediaPlay', 'MediaPause'].forEach(function (key) {
      try { window.tizen.tvinputdevice.registerKey(key); }
      catch (e) { /* Some remotes do not expose all three keys. */ }
    });
  }
  document.getElementById('home').focus();
  home();
}());
