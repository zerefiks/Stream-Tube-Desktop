# Stream Tube Mobile (draft)

Experimental Flutter client for Android and iOS in this fork. The desktop and Tizen clients are developed independently.

The draft includes anonymous YouTube search, opening video URLs or IDs, topic browsing, local watch history, related videos, and HLS playback with seek and playback-speed controls. The Home tab uses related videos from local watch history when available. The player uses the platform HLS engine through the Flutter `video_player` plugin.

## Run locally

Use Flutter 3.47.4 / Dart 3.13.3 or a compatible newer release. Android needs the Android SDK and a JDK compatible with the generated Android Gradle project. Building or signing iOS requires macOS and Xcode.

```sh
cd packaging/mobile
flutter pub get
flutter analyze
flutter run
```

Build a debug Android APK using `flutter build apk --debug`. On a Mac, use `flutter build ios --simulator` for the iOS simulator. Install on a physical iPhone using your Xcode signing team.

## Draft scope

Playback currently uses adaptive HLS. Manual quality selection, preferred audio language, account sign-in, downloads, and store distribution have yet to be implemented. YouTube's internal endpoints may change. Local watch history is stored on the device.
