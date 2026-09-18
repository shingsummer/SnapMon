import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'monster_art.dart';
import 'monster_repository.dart';

/// S06 牧場（一覧）。P1 ではアクティブのみ・新しい順。ソート／保管切替は P5。
class RanchScreen extends ConsumerWidget {
  const RanchScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final monsters = ref.watch(monstersProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('牧場')),
      body: monsters.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('読み込みに失敗しました\n$e', textAlign: TextAlign.center)),
        data: (list) => list.isEmpty
            ? const Center(child: Text('まだ誰もいません。写真を撮ってみよう'))
            : ListView.builder(
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final m = list[i];
                  return ListTile(
                    leading: MonsterArt(monster: m, size: 48),
                    title: Text(m.displayName),
                    subtitle: Text('Lv${m.level} ・ ${m.familyLabel} ・ ${m.elementLabel} ・ 合計 ${m.total}'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.push('/monster/${m.id}'),
                  );
                },
              ),
      ),
    );
  }
}
