import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'watch.dart';
import 'youtube.dart';

void main() => runApp(const StreamTube());

class StreamTube extends StatelessWidget {
  const StreamTube({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Stream Tube',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xffff4b61),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xff13141a),
      ),
      home: const LibraryScreen(),
    );
  }
}

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  static const _historyKey = 'streamtube.mobile.history';
  static const _topics = {
    'Рекомендации': 'наука технологии документальные фильмы',
    'Музыка': 'новые музыкальные клипы',
    'Наука': 'научно популярные видео',
    'Игры': 'новинки видеоигр обзор',
  };

  final _youtube = Youtube();
  final _storage = SharedPreferencesAsync();
  final _search = TextEditingController();
  List<VideoItem> _history = [];
  int _tab = 0;
  String _topic = _topics.keys.first;
  Future<List<VideoItem>>? _discover;
  Future<List<VideoItem>>? _results;

  @override
  void initState() {
    super.initState();
    _discover = _loadDiscover();
  }

  Future<List<VideoItem>> _loadDiscover() async {
    try {
      final raw = await _storage.getStringList(_historyKey) ?? [];
      final recent = <VideoItem>[];
      for (final entry in raw) {
        final item = VideoItem.fromJson(jsonDecode(entry));
        if (item != null) recent.add(item);
      }
      if (!mounted) return [];
      setState(() => _history = recent);
    } on Exception {
      // A damaged local history does not prevent browsing.
    }
    return _discoverTopic(_topic);
  }

  Future<List<VideoItem>> _discoverTopic(String topic) async {
    if (topic == _topics.keys.first && _history.isNotEmpty) {
      try {
        final watched = _history.map((item) => item.id).toSet();
        final related = await _youtube.related(_history.first.id);
        final unseen = related
            .where((item) => !watched.contains(item.id))
            .toList();
        if (unseen.isNotEmpty) return unseen;
      } on YoutubeException {
        // Use the default topic when YouTube cannot return recommendations.
      }
    }
    return _youtube.search(_topics[topic]!);
  }

  Future<void> _remember(VideoItem item) async {
    if (!mounted) return;
    final entries = [item, ..._history.where((entry) => entry.id != item.id)];
    setState(() => _history = entries.take(30).toList());
    try {
      await _storage.setStringList(
        _historyKey,
        _history.map((entry) => jsonEncode(entry.toJson())).toList(),
      );
    } on Exception {
      // Keep the in-memory history if preferences are unavailable.
    }
  }

  void _open(VideoItem item) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => WatchScreen(
          item: item,
          youtube: _youtube,
          onStarted: (video) => unawaited(_remember(video)),
        ),
      ),
    );
  }

  void _submit(String input) {
    final query = input.trim();
    if (query.isEmpty) return;
    FocusScope.of(context).unfocus();
    final id = Youtube.parseVideoId(query);
    if (id != null) {
      _open(VideoItem(id, id));
      return;
    }
    setState(() => _results = _youtube.search(query));
  }

  @override
  void dispose() {
    _search.dispose();
    _youtube.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(
              Icons.play_circle_fill,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: 9),
            const Text(
              'Stream Tube',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
        ),
      ),
      body: SafeArea(
        top: false,
        child: switch (_tab) {
          0 => Column(
            children: [
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(
                  children: [
                    for (final topic in _topics.keys)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(topic),
                          selected: _topic == topic,
                          onSelected: (_) => setState(() {
                            _topic = topic;
                            _discover = _discoverTopic(topic);
                          }),
                        ),
                      ),
                  ],
                ),
              ),
              Expanded(
                child: _videoResults(_discover, () {
                  setState(() => _discover = _discoverTopic(_topic));
                }),
              ),
            ],
          ),
          1 => Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  controller: _search,
                  textInputAction: TextInputAction.search,
                  onSubmitted: _submit,
                  decoration: InputDecoration(
                    labelText: 'Запрос или ссылка YouTube',
                    border: const OutlineInputBorder(),
                    suffixIcon: IconButton(
                      tooltip: 'Найти',
                      onPressed: () => _submit(_search.text),
                      icon: const Icon(Icons.search),
                    ),
                  ),
                ),
              ),
              Expanded(
                child: _results == null
                    ? const Center(
                        child: Text('Введите запрос или вставьте ссылку'),
                      )
                    : _videoResults(_results, () => _submit(_search.text)),
              ),
            ],
          ),
          _ =>
            _history.isEmpty
                ? const Center(child: Text('История просмотров пока пуста'))
                : VideoList(items: _history, onOpen: _open),
        },
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (index) => setState(() => _tab = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.explore_outlined),
            label: 'Главная',
          ),
          NavigationDestination(icon: Icon(Icons.search), label: 'Поиск'),
          NavigationDestination(icon: Icon(Icons.history), label: 'История'),
        ],
      ),
    );
  }

  Widget _videoResults(Future<List<VideoItem>>? future, VoidCallback retry) {
    return FutureBuilder(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return LoadError(error: snapshot.error!, onRetry: retry);
        }
        final items = snapshot.data ?? [];
        return items.isEmpty
            ? const Center(child: Text('Видео не найдены'))
            : VideoList(items: items, onOpen: _open);
      },
    );
  }
}
