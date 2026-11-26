import 'dart:async';

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import 'youtube.dart';

class WatchScreen extends StatefulWidget {
  const WatchScreen({
    super.key,
    required this.item,
    required this.youtube,
    required this.onStarted,
  });

  final VideoItem item;
  final Youtube youtube;
  final ValueChanged<VideoItem> onStarted;

  @override
  State<WatchScreen> createState() => _WatchScreenState();
}

class _WatchScreenState extends State<WatchScreen> {
  VideoPlayerController? _player;
  Object? _error;
  int _attempt = 0;
  late VideoItem _item;
  late Future<List<VideoItem>> _related;

  @override
  void initState() {
    super.initState();
    _item = widget.item;
    _related = widget.youtube.related(_item.id);
    unawaited(_load());
  }

  Future<void> _load() async {
    final attempt = ++_attempt;
    final previous = _player;
    setState(() {
      _player = null;
      _error = null;
    });
    if (previous != null) await previous.dispose();
    VideoPlayerController? candidate;
    try {
      final uri = await widget.youtube.resolve(_item.id);
      if (!mounted || attempt != _attempt) return;
      candidate = VideoPlayerController.networkUrl(
        uri,
        formatHint: VideoFormat.hls,
      );
      await candidate.initialize().timeout(const Duration(seconds: 20));
      if (!mounted || attempt != _attempt) return;
      await candidate.play();
      if (!mounted || attempt != _attempt) return;
      final ready = candidate;
      setState(() => _player = ready);
      candidate = null;
      widget.onStarted(_item);
    } on Exception catch (error) {
      if (mounted && attempt == _attempt) setState(() => _error = error);
    } finally {
      if (candidate != null) await candidate.dispose();
    }
  }

  void _changeVideo(VideoItem item) {
    setState(() {
      _item = item;
      _related = widget.youtube.related(item.id);
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _attempt++;
    final player = _player;
    if (player != null) unawaited(player.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final player = _player;
    return Scaffold(
      appBar: AppBar(title: const Text('Просмотр')),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            if (player != null)
              ValueListenableBuilder(
                valueListenable: player,
                builder: (context, value, _) => value.hasError
                    ? _VideoFrame(
                        child: LoadError(
                          error: const YoutubeException(
                            'Воспроизведение прервано.',
                          ),
                          onRetry: _load,
                        ),
                      )
                    : _PlayerControls(player: player, value: value),
              )
            else
              _VideoFrame(
                child: ColoredBox(
                  color: Colors.black,
                  child: _error == null
                      ? const Center(child: CircularProgressIndicator())
                      : LoadError(error: _error!, onRetry: _load),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  _item.title,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ),
            Expanded(
              child: FutureBuilder(
                future: _related,
                builder: (context, snapshot) {
                  if (snapshot.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  if (snapshot.hasError) {
                    return LoadError(
                      error: snapshot.error!,
                      onRetry: () => setState(
                        () => _related = widget.youtube.related(_item.id),
                      ),
                    );
                  }
                  final items = snapshot.data ?? [];
                  if (items.isEmpty) return const SizedBox.shrink();
                  return VideoList(
                    items: items,
                    onOpen: _changeVideo,
                    heading: 'Смотреть далее',
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlayerControls extends StatelessWidget {
  const _PlayerControls({required this.player, required this.value});

  final VideoPlayerController player;
  final VideoPlayerValue value;

  @override
  Widget build(BuildContext context) {
    final duration = value.duration.inMilliseconds;
    final position = value.position.inMilliseconds;
    return Column(
      children: [
        _VideoFrame(
          child: ColoredBox(
            color: Colors.black,
            child: Stack(
              fit: StackFit.expand,
              children: [
                Center(
                  child: AspectRatio(
                    aspectRatio: value.aspectRatio,
                    child: VideoPlayer(player),
                  ),
                ),
                if (value.isBuffering)
                  const Center(child: CircularProgressIndicator()),
              ],
            ),
          ),
        ),
        Row(
          children: [
            IconButton(
              tooltip: value.isPlaying ? 'Пауза' : 'Воспроизвести',
              onPressed: () => value.isPlaying ? player.pause() : player.play(),
              icon: Icon(value.isPlaying ? Icons.pause : Icons.play_arrow),
            ),
            Expanded(
              child: Slider(
                value: duration > 0
                    ? position.clamp(0, duration) / duration
                    : 0,
                onChanged: duration > 0
                    ? (ratio) => player.seekTo(
                        Duration(milliseconds: (ratio * duration).round()),
                      )
                    : null,
              ),
            ),
            PopupMenuButton<double>(
              tooltip: 'Скорость',
              initialValue: value.playbackSpeed,
              onSelected: player.setPlaybackSpeed,
              itemBuilder: (_) => [
                for (final rate in [0.75, 1.0, 1.25, 1.5, 2.0])
                  PopupMenuItem(
                    value: rate,
                    child: Text('${_speedLabel(rate)}×'),
                  ),
              ],
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text('${_speedLabel(value.playbackSpeed)}×'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  String _speedLabel(double rate) =>
      rate == rate.roundToDouble() ? rate.toStringAsFixed(0) : '$rate';
}

class VideoList extends StatelessWidget {
  const VideoList({
    super.key,
    required this.items,
    required this.onOpen,
    this.heading,
  });

  final List<VideoItem> items;
  final ValueChanged<VideoItem> onOpen;
  final String? heading;

  @override
  Widget build(BuildContext context) {
    final hasHeading = heading != null;
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      itemCount: items.length + (hasHeading ? 1 : 0),
      itemBuilder: (context, index) {
        if (hasHeading && index == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              heading!,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          );
        }
        final item = items[index - (hasHeading ? 1 : 0)];
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () => onOpen(item),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                SizedBox(
                  width: MediaQuery.sizeOf(context).width < 400 ? 130 : 160,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: AspectRatio(
                      aspectRatio: 16 / 9,
                      child: Image.network(
                        item.thumbnail.toString(),
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, trace) =>
                            const ColoredBox(
                              color: Colors.black,
                              child: Icon(Icons.play_arrow),
                            ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (item.channel.isNotEmpty || item.duration.isNotEmpty)
                        Text(
                          [
                            item.channel,
                            item.duration,
                          ].where((part) => part.isNotEmpty).join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _VideoFrame extends StatelessWidget {
  const _VideoFrame({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * .48,
      ),
      child: AspectRatio(aspectRatio: 16 / 9, child: child),
    );
  }
}

class LoadError extends StatelessWidget {
  const LoadError({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final message = error is YoutubeException
        ? (error as YoutubeException).message
        : 'Не удалось загрузить. Попробуйте ещё раз.';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            TextButton(onPressed: onRetry, child: const Text('Повторить')),
          ],
        ),
      ),
    );
  }
}
