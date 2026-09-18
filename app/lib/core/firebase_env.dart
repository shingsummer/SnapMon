import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

/// Functions のリージョン（functions/src/index.ts の setGlobalOptions と一致させる）
const functionsRegion = 'asia-northeast1';

/// `flutter run --dart-define=USE_EMULATOR=true` でローカルの Firebase エミュレータに接続する。
/// Auth は本物を使う（Google サインインの動作確認のため）。エミュレータはトークン署名を検証しない。
const useEmulator = bool.fromEnvironment('USE_EMULATOR');

FirebaseFunctions functions() => FirebaseFunctions.instanceFor(region: functionsRegion);

void configureEmulatorsIfNeeded() {
  debugPrint('[SnapMon] USE_EMULATOR=$useEmulator');
  if (!useEmulator) return;
  final host = defaultTargetPlatform == TargetPlatform.android ? '10.0.2.2' : 'localhost';
  functions().useFunctionsEmulator(host, 5001);
  FirebaseFirestore.instance.useFirestoreEmulator(host, 8080);
  debugPrint('[SnapMon] using Firebase emulators at $host');
}
