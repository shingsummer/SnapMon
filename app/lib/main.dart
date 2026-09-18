import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router.dart';
import 'core/theme.dart';

void main() {
  // P0: Firebase.initializeApp() はプロジェクト設定ファイル配置後にここへ追加する。
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
