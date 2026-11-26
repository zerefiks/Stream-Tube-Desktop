import 'dart:convert';
import 'dart:io';

class VideoItem {
  const VideoItem(this.id, this.title, {this.channel = '', this.duration = ''});

  final String id;
  final String title;
  final String channel;
  final String duration;

  Uri get thumbnail => Uri.https('i.ytimg.com', '/vi/$id/mqdefault.jpg');

  Map<String, String> toJson() => {
    'id': id,
    'title': title,
    'channel': channel,
    'duration': duration,
  };

  static VideoItem? fromJson(Object? value) {
    if (value is! Map<String, dynamic>) return null;
    final id = value['id'];
    final title = value['title'];
    if (id is! String ||
        !Youtube.videoIdPattern.hasMatch(id) ||
        title is! String) {
      return null;
    }
    return VideoItem(
      id,
      title,
      channel: value['channel'] is String ? value['channel'] as String : '',
      duration: value['duration'] is String ? value['duration'] as String : '',
    );
  }
}

class YoutubeException implements Exception {
  const YoutubeException(this.message);
  final String message;
}

/// Anonymous browsing and HLS resolution adapted from Stream Tube Desktop.
class Youtube {
  Youtube() {
    _http.connectionTimeout = _timeout;
  }

  static final videoIdPattern = RegExp(r'^[A-Za-z0-9_-]{11}$');
  static const _timeout = Duration(seconds: 8);
  static const _web = {
    'clientName': 'WEB',
    'clientVersion': '2.20251120.01.00',
    'hl': 'ru',
  };
  static const _vision = {
    'clientName': 'VISIONOS',
    'clientVersion': '1.02',
    'deviceMake': 'Apple',
    'deviceModel': 'RealityDevice17,1',
    'osName': 'visionOS',
    'osVersion': '26.5.23O471',
    'userAgent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    'hl': 'ru',
  };
  static const _ios = {
    'clientName': 'IOS',
    'clientVersion': '20.10.4',
    'deviceMake': 'Apple',
    'deviceModel': 'iPhone16,2',
    'osName': 'iOS',
    'osVersion': '18.3.2.22D82',
    'userAgent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    'hl': 'ru',
  };

  final _http = HttpClient();
  Future<String?>? _visitor;

  void close() => _http.close(force: true);

  static String? parseVideoId(String input) {
    final value = input.trim();
    if (videoIdPattern.hasMatch(value)) return value;
    final uri = Uri.tryParse(value.contains('://') ? value : 'https://$value');
    if (uri == null || !{'http', 'https'}.contains(uri.scheme)) return null;
    final parts = uri.pathSegments;
    if (parts.isEmpty) return null;
    String? id;
    if (uri.host == 'youtu.be') {
      id = parts.first;
    } else if ({
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
    }.contains(uri.host)) {
      if (parts.first == 'watch') {
        id = uri.queryParameters['v'];
      } else if (parts.length >= 2 &&
          {'shorts', 'live', 'embed'}.contains(parts.first)) {
        id = parts[1];
      }
    }
    return id != null && videoIdPattern.hasMatch(id) ? id : null;
  }

  Future<List<VideoItem>> search(String query) async =>
      collectVideos(await _post('search', _web, {'query': query}));

  Future<List<VideoItem>> related(String id) async =>
      collectVideos(await _post('next', _web, {'videoId': id}))
          .where((item) => item.id != id)
          .toList();

  Future<Uri> resolve(String id) async {
    if (!videoIdPattern.hasMatch(id)) {
      throw const YoutubeException('Некорректный идентификатор видео.');
    }
    final visitor = await (_visitor ??= _fetchVisitor());
    if (visitor == null) _visitor = null;
    var reason = 'YouTube не предоставил поток для этого видео.';
    for (final client in [
      {..._vision, 'visitorData': ?visitor},
      _ios,
    ]) {
      try {
        final data = await _post('player', client, {'videoId': id});
        final stream = _map(data['streamingData'])['hlsManifestUrl'];
        final uri = stream is String ? Uri.tryParse(stream) : null;
        if (uri != null && _isMediaUri(uri)) return uri;
        final message = _map(data['playabilityStatus'])['reason'];
        if (message is String && message.isNotEmpty) reason = message;
      } on YoutubeException catch (error) {
        reason = error.message;
      }
    }
    throw YoutubeException(reason);
  }

  Future<String?> _fetchVisitor() async {
    try {
      final data = await _post('visitor_id', _web, {});
      final visitor = _map(data['responseContext'])['visitorData'];
      return visitor is String && visitor.isNotEmpty ? visitor : null;
    } on YoutubeException {
      return null;
    }
  }

  Future<Map<String, dynamic>> _post(
    String endpoint,
    Map<String, String> client,
    Map<String, String> body,
  ) async {
    try {
      return await (() async {
        final request = await _http.postUrl(
          Uri.https('www.youtube.com', '/youtubei/v1/$endpoint', {
            'prettyPrint': 'false',
          }),
        );
        request.headers.contentType = ContentType.json;
        request.write(
          jsonEncode({
            'context': {'client': client},
            ...body,
          }),
        );
        final response = await request.close();
        if (response.statusCode != HttpStatus.ok) {
          await response.drain<void>();
          throw YoutubeException('YouTube вернул HTTP ${response.statusCode}.');
        }
        return _map(jsonDecode(await utf8.decoder.bind(response).join()));
      })().timeout(_timeout);
    } on YoutubeException {
      rethrow;
    } on Exception {
      throw const YoutubeException(
        'Не удалось получить ответ YouTube. Проверьте подключение.',
      );
    }
  }

  static bool _isMediaUri(Uri uri) =>
      uri.scheme == 'https' &&
      uri.userInfo.isEmpty &&
      (uri.host == 'youtube.com' ||
          uri.host.endsWith('.youtube.com') ||
          uri.host == 'googlevideo.com' ||
          uri.host.endsWith('.googlevideo.com'));

  static List<VideoItem> collectVideos(Object? data) {
    final items = <String, VideoItem>{};
    void walk(Object? node) {
      if (items.length >= 30) return;
      if (node is List) {
        for (final item in node) {
          walk(item);
        }
      } else if (node is Map<String, dynamic>) {
        final video = _map(
          node['videoRenderer'] ??
              node['compactVideoRenderer'] ??
              node['gridVideoRenderer'],
        );
        final lockup = _map(node['lockupViewModel']);
        final isVideo = lockup['contentType'] == 'LOCKUP_CONTENT_TYPE_VIDEO';
        final id = video['videoId'] ?? (isVideo ? lockup['contentId'] : null);
        if (id is String && videoIdPattern.hasMatch(id)) {
          final metadata = _map(
            _map(lockup['metadata'])['lockupMetadataViewModel'],
          );
          final title = _text(video['title'] ?? metadata['title']);
          items.putIfAbsent(
            id,
            () => VideoItem(
              id,
              title.isEmpty ? id : title,
              channel: _text(video['ownerText'] ?? video['shortBylineText']),
              duration: _text(video['lengthText']),
            ),
          );
          return;
        }
        for (final entry in node.entries) {
          if (!RegExp(
            r'adSlot|promoted|frameworkUpdates|topbar|menu',
            caseSensitive: false,
          ).hasMatch(entry.key)) {
            walk(entry.value);
          }
        }
      }
    }

    walk(data);
    return items.values.toList();
  }

  static Map<String, dynamic> _map(Object? value) =>
      value is Map<String, dynamic> ? value : const {};

  static String _text(Object? value) {
    final map = _map(value);
    final simple = map['simpleText'] ?? map['content'];
    if (simple is String) return simple;
    final runs = map['runs'];
    return runs is List
        ? runs.map((run) => _map(run)['text']).whereType<String>().join()
        : '';
  }
}
