import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../auth/auth_provider.dart';
import '../monster/monster_art.dart';
import '../monster/monster_repository.dart';

/// S03 ホーム（企画書 §8.1）。撮影枠・歩数/VP・パートナー。歩数は P2 で接続。
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider).state;
    final config = ref.watch(gameConfigProvider);
    final user = ref.watch(userDocProvider).value;
    final snapsPerDay = (config.value?.constants['snapsPerDay'] as int?) ?? 3;
    final remaining = remainingSnaps(user, snapsPerDay);
    final partnerId = user?['partnerMonsterId'] as String?;
    final partner = partnerId == null ? null : ref.watch(monsterProvider(partnerId)).value;

    return Scaffold(
      appBar: AppBar(
        title: const Text('SnapMon'),
        actions: [
          IconButton(
            key: const Key('ranch'),
            tooltip: '牧場',
            icon: const Icon(Icons.grass),
            onPressed: () => context.push('/ranch'),
          ),
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
            data: (_) => _InfoCard(title: '今日の撮影枠', body: '残り $remaining / $snapsPerDay 枚'),
          ),
          const _InfoCard(title: '今日の歩数', body: '0 歩 ・ 0 VP（P2 で接続）'),
          Card(
            child: ListTile(
              leading: partner == null ? const Icon(Icons.egg_outlined, size: 40) : MonsterArt(monster: partner, size: 48),
              title: const Text('パートナー'),
              subtitle: Text(partner == null ? 'まだいません。1枚撮ってみよう' : '${partner.displayName} ・ Lv${partner.level}'),
              onTap: partner == null ? null : () => context.push('/monster/${partner.id}'),
            ),
          ),
          _InfoCard(title: 'ログイン中', body: auth.displayName ?? '-'),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('shoot'),
        onPressed: remaining > 0 ? () => context.push('/camera') : null,
        icon: const Icon(Icons.photo_camera),
        label: Text(remaining > 0 ? '撮る' : '今日はおしまい'),
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
