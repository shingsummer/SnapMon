import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../auth/auth_provider.dart';

/// S03 ホーム（企画書 §8.1）。P0 では枠だけ。数値は P1（撮影枠）・P2（歩数/VP）で接続する。
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider).state;
    final config = ref.watch(gameConfigProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('SnapMon'),
        actions: [
          IconButton(
            key: const Key('sign-out'),
            tooltip: 'サインアウト',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authProvider).signOut(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          config.when(
            loading: () => const _InfoCard(title: '設定を読み込み中…', body: ''),
            error: (e, _) => _InfoCard(title: '設定の読み込みに失敗', body: '$e'),
            data: (cfg) => _InfoCard(
              title: '今日の撮影枠',
              body: '残り ${cfg.constants['snapsPerDay']} / ${cfg.constants['snapsPerDay']} 枚',
            ),
          ),
          const _InfoCard(title: '今日の歩数', body: '0 歩 ・ 0 VP（P2 で接続）'),
          const _InfoCard(title: 'パートナー', body: 'まだいません。1枚撮ってみよう（P1 で接続）'),
          _InfoCard(title: 'ログイン中', body: auth.displayName ?? '-'),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: null, // P1: カメラ（S04）へ
        icon: const Icon(Icons.photo_camera),
        label: const Text('撮る'),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(title: Text(title), subtitle: Text(body)),
    );
  }
}
