import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'models.dart';
import 'monster_art.dart';
import 'monster_repository.dart';

enum _Sort { newest, level, total, family }

/// S06 牧場（企画書 §8.1）。アクティブ／保管の切替、ソート（レベル／合計値／誕生日／ファミリー）。
/// 成長タイプ・素質ではソートできない（§4.2）。保管ボタンは目立たせない（§7.1）。
class RanchScreen extends ConsumerStatefulWidget {
  const RanchScreen({super.key});

  @override
  ConsumerState<RanchScreen> createState() => _RanchScreenState();
}

class _RanchScreenState extends ConsumerState<RanchScreen> {
  bool _showStored = false;
  _Sort _sort = _Sort.newest;

  @override
  Widget build(BuildContext context) {
    final monsters = ref.watch(monstersProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(_showStored ? '保管牧場' : '牧場'),
        actions: [
          PopupMenuButton<_Sort>(
            icon: const Icon(Icons.sort),
            onSelected: (v) => setState(() => _sort = v),
            itemBuilder: (_) => const [
              PopupMenuItem(value: _Sort.newest, child: Text('誕生日順')),
              PopupMenuItem(value: _Sort.level, child: Text('レベル順')),
              PopupMenuItem(value: _Sort.total, child: Text('合計値順')),
              PopupMenuItem(value: _Sort.family, child: Text('ファミリー順')),
            ],
          ),
          IconButton(
            key: const Key('toggle-stored'),
            tooltip: _showStored ? '育成中を見る' : '保管牧場を見る',
            icon: Icon(_showStored ? Icons.grass : Icons.inventory_2_outlined),
            onPressed: () => setState(() => _showStored = !_showStored),
          ),
        ],
      ),
      body: monsters.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('読み込みに失敗しました\n$e', textAlign: TextAlign.center)),
        data: (all) {
          final list = all.where((m) => m.isStored == _showStored).toList();
          switch (_sort) {
            case _Sort.newest:
              break;
            case _Sort.level:
              list.sort((a, b) => b.level.compareTo(a.level));
            case _Sort.total:
              list.sort((a, b) => b.total.compareTo(a.total));
            case _Sort.family:
              list.sort((a, b) => a.family.compareTo(b.family));
          }
          if (list.isEmpty) {
            return Center(child: Text(_showStored ? '保管中のモンスターはいません' : 'まだ誰もいません。写真を撮ってみよう'));
          }
          return ListView.builder(
            itemCount: list.length,
            itemBuilder: (context, i) {
              final m = list[i];
              return ListTile(
                leading: MonsterArt(monster: m, size: 48),
                title: Row(
                  children: [
                    Expanded(child: Text(m.displayName)),
                    if (m.isMentor) const Icon(Icons.school, size: 16),
                  ],
                ),
                subtitle: Text('Lv${m.level} ・ ${m.familyLabel} ・ ${m.elementLabel} ・ 合計 ${m.total}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/monster/${m.id}'),
                onLongPress: () => _storageMenu(context, m),
              );
            },
          );
        },
      ),
    );
  }

  Future<void> _storageMenu(BuildContext context, Monster m) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (_) => SafeArea(
        child: Wrap(
          children: [
            ListTile(title: Text(m.displayName), subtitle: Text(m.isStored ? '保管中' : '育成中')),
            ListTile(
              leading: Icon(m.isStored ? Icons.grass : Icons.inventory_2_outlined),
              title: Text(m.isStored ? '育成中に戻す' : '保管牧場へ（トレーニング・バトル不可、いつでも戻せる）'),
              onTap: () => Navigator.of(context).pop('toggle'),
            ),
          ],
        ),
      ),
    );
    if (action != 'toggle' || !context.mounted) return;
    try {
      await ref.read(monsterApiProvider).setStorage(m.id, !m.isStored);
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m.isStored ? '${m.displayName} が戻ってきた' : '${m.displayName} を保管した')));
    } on MonsterApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}
