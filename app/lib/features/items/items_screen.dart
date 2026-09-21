import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../monster/models.dart';
import '../monster/monster_art.dart';
import '../monster/monster_repository.dart';

/// S13 アイテム（企画書 §8.1, §5.4）。所持一覧と使用。VP 交換は P6。
class ItemsScreen extends ConsumerWidget {
  const ItemsScreen({super.key});

  static String _describe(String type) {
    if (type.startsWith('food_')) return '対応ファミリーのモンスターにあげると経験値 +30';
    if (type == 'fatigue_cure') return '疲労を 0 にする（1 日 1 個まで）';
    if (type == 'bond_capsule') return '弟子を予約するときに使うと継承率アップ';
    if (type == 'snap_ticket') return '無料枠を使い切った日に、撮るとき自動で 1 枚使われる（1 日 3 枚まで）';
    if (type == 'art_upgrade') return 'モンスターの詳細画面から、その子を高品質で描き直す';
    return '';
  }

  static bool _usableOn(String type, Monster m) {
    if (m.isStored) return false;
    if (type.startsWith('food_')) return type == 'food_${m.family}' || (m.subFamily != null && type == 'food_${m.subFamily}');
    if (type == 'fatigue_cure') return true;
    return false;
  }

  Future<void> _use(BuildContext context, WidgetRef ref, String type) async {
    final monsters = (ref.read(monstersProvider).value ?? const <Monster>[]).where((m) => _usableOn(type, m)).toList();
    if (monsters.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('このアイテムを使えるモンスターがいません')));
      return;
    }
    final target = await showModalBottomSheet<Monster>(
      context: context,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const ListTile(title: Text('だれに使う？')),
            for (final m in monsters)
              ListTile(
                leading: MonsterArt(monster: m, size: 40),
                title: Text(m.displayName),
                subtitle: Text('Lv${m.level} ・ 疲労 ${m.fatigue}'),
                onTap: () => Navigator.of(context).pop(m),
              ),
          ],
        ),
      ),
    );
    if (target == null || !context.mounted) return;
    try {
      final r = await ref.read(monsterApiProvider).useItem(target.id, type);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${target.displayName} に ${itemLabel(type)} を使った${r.levelUps > 0 ? '。レベルアップ！' : ''}')));
      }
    } on MonsterApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final inventory = ref.watch(inventoryProvider).value ?? const <String, int>{};
    final items = inventory.entries.where((e) => e.value > 0).toList()..sort((a, b) => a.key.compareTo(b.key));
    return Scaffold(
      appBar: AppBar(title: const Text('アイテム')),
      body: items.isEmpty
          ? const Center(child: Text('アイテムはありません。写真を撮ると見つかることがある'))
          : ListView(
              children: [
                for (final e in items)
                  ListTile(
                    leading: Icon(e.key.startsWith('food_') ? Icons.restaurant : e.key == 'bond_capsule' ? Icons.link : Icons.healing),
                    title: Text('${itemLabel(e.key)} ×${e.value}'),
                    subtitle: Text(_describe(e.key)),
                    trailing: e.key == 'bond_capsule' ? null : TextButton(onPressed: () => _use(context, ref, e.key), child: const Text('使う')),
                  ),
              ],
            ),
    );
  }
}
