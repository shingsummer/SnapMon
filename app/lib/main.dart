import 'package:firebase_app_check/firebase_app_check.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/firebase_env.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  // 企画書 §7.2: すべての callable は App Check 必須。
  // デバッグビルドはデバッグプロバイダ（コンソールにトークンが出るので Firebase コンソールに登録する）。
  await FirebaseAppCheck.instance.activate(
    providerAndroid: kDebugMode ? const AndroidDebugProvider() : const AndroidPlayIntegrityProvider(),
    providerApple: kDebugMode ? const AppleDebugProvider() : const AppleDeviceCheckProvider(),
  );
  // `--dart-define=USE_EMULATOR=true` のときだけローカルエミュレータへ
  configureEmulatorsIfNeeded();
  runApp(const ProviderScope(child: SnapMonApp()));
}

class SnapMonApp extends ConsumerWidget {
  const SnapMonApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'SnapMon',
      theme: buildTheme(),
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
