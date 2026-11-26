/* YouTube TV device authorization adapted from Stream Tube (MIT). */
(function (root) {
  'use strict';
  var clientId = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com';
  var clientSecret = 'SboVhoG9s0rNafixCSGGKXAT';
  var storageKey = 'streamtube-tv-session';
  var session;
  var revision = 0;
  try { session = JSON.parse(root.localStorage.getItem(storageKey) || 'null'); }
  catch (e) { session = null; }

  function persist(value) {
    session = value;
    try {
      if (value) root.localStorage.setItem(storageKey, JSON.stringify(value));
      else root.localStorage.removeItem(storageKey);
    } catch (e) { /* This session still works until the application closes. */ }
  }

  function post(path, data, done) {
    var xhr = new XMLHttpRequest();
    data.client_id = clientId;
    try {
      xhr.open('POST', 'https://www.youtube.com/o/oauth2/' + path, true);
      xhr.timeout = 12000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        var value;
        try { value = JSON.parse(xhr.responseText); }
        catch (e) { done('Ответ Google недоступен (HTTP ' + xhr.status + ').'); return; }
        done(null, value);
      };
      xhr.ontimeout = xhr.onerror = function () { done('Нет связи с сервером входа Google.'); };
      xhr.send(JSON.stringify(data));
    } catch (e) { done('Не удалось отправить запрос входа.'); }
  }

  function accept(data, refresh) {
    var now = Date.now();
    persist({
      access: data.access_token,
      refresh: data.refresh_token || refresh || '',
      expires: now + Math.max(0, (Number(data.expires_in) || 3600) - 60) * 1000
    });
  }

  function signIn(showCode, done) {
    var cancelled = false;
    var timer;
    var deviceId = '';
    var bytes = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    for (var n = 0; n < bytes.length; n += 1) deviceId += ('0' + bytes[n].toString(16)).slice(-2);
    post('device/code', { scope: 'http://gdata.youtube.com', device_id: deviceId, device_model: 'ytlr::' }, function (error, data) {
      if (cancelled) return;
      if (error || !data || !data.device_code || !data.user_code) {
        done(error || 'Google не предоставил код входа.');
        return;
      }
      var verification = data.verification_url || data.verification_uri;
      if (!/^https:\/\/(?:www\.)?google\.com\/device(?:[?#]|$)/i.test(verification || '')) {
        verification = 'https://www.google.com/device';
      }
      showCode(verification, data.user_code);
      var interval = Math.max(5, Number(data.interval) || 5) * 1000;
      var deadline = Date.now() + (Number(data.expires_in) || 1800) * 1000;
      function poll() {
        if (Date.now() >= deadline) { done('Код истёк. Начните вход заново.'); return; }
        post('token', {
          client_secret: clientSecret, code: data.device_code,
          grant_type: 'http://oauth.net/grant_type/device/1.0'
        }, function (failure, result) {
          if (cancelled) return;
          if (result && result.access_token) { accept(result); done(null); return; }
          var code = result && result.error;
          if (code === 'slow_down') interval += 5000;
          if (code === 'authorization_pending' || code === 'slow_down') {
            timer = setTimeout(poll, interval);
          } else {
            done(failure || (code === 'access_denied' ? 'Вход отменён.' : 'Google не завершил вход. Начните заново.'));
          }
        });
      }
      timer = setTimeout(poll, interval);
    });
    return function () { cancelled = true; clearTimeout(timer); };
  }

  function token(done) {
    if (!session) { done('Войдите в аккаунт YouTube.'); return; }
    if (session.expires > Date.now()) { done(null, session.access); return; }
    if (!session.refresh) { persist(null); done('Сеанс истёк. Войдите снова.'); return; }
    var initial = revision;
    post('token', {
      client_secret: clientSecret, refresh_token: session.refresh, grant_type: 'refresh_token'
    }, function (error, data) {
      if (initial !== revision || !session) { done('Сеанс завершён.'); return; }
      if (error) { done(error); return; }
      if (!data.access_token) {
        if (data.error === 'invalid_grant') persist(null);
        done('Google не обновил сеанс. Войдите снова.');
        return;
      }
      accept(data, session.refresh);
      done(null, session.access);
    });
  }

  root.StreamTubeAuth = {
    signIn: signIn,
    signedIn: function () { return !!session; },
    signOut: function () { revision += 1; persist(null); },
    token: token
  };
}(window));
