import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../monster/models.dart';
import '../monster/monster_art.dart';
import '../monster/monster_repository.dart';

/// S14 家系図（企画書 §5.5）。師匠 → 弟子 → 孫弟子… を一本の系譜として表示。各世代の「師匠の型」も出す。
class LineageScreen extends ConsumerWidget {
  const LineageScreen({super.key, required this.monsterId});
  final String monsterId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final all = ref.watch(monstersProvider).value ?? const <Monster>[];
    final moves = ref.watch(moveTableProvider).value ?? const {};
    final byId = {for (final m in all) m.id: m};
    final me = byId[monsterId];
    if (me == null) {
      return Scaffold(appBar: AppBar(title: const Text('家系図')), body: const Center(child: CircularProgressIndicator()));
    }
    // 始祖までさかのぼる
    var root = me;
    final seen = <String>{me.id};
    while (root.mentorId != null && byId[root.mentorId!] != null && !seen.contains(root.mentorId!)) {
      root = byId[root.mentorId!]!;
      seen.add(root.id);
    }
    // 始祖から弟子をたどる
    final chain = <Monster>[root];
    var cur = root;
    while (cur.discipleId != null && byId[cur.discipleId!] != null && chain.length < 50) {
      cur = byId[cur.discipleId!]!;
      chain.add(cur);
    }
    String moveName(String? id) => id == null ? '' : ((moves[id]?['name'] as String?) ?? id);

    return Scaffold(
      appBar: AppBar(title: Text('${root.displayName} の家系')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (var i = 0; i < chain.length; i++) ...[
            Card(
              color: chain[i].id == me.id ? theme.colorScheme.primaryContainer : null,
              child: ListTile(
                leading: MonsterArt(monster: chain[i], size: 48),
                title: Text('${i == 0 ? '始祖' : '$i 代目'} ${chain[i].displayName}'),
                subtitle: Text([
                  'Lv${chain[i].level} ・ ${chain[i].familyLabel} ・ ${chain[i].elementLabel}',
                  if (chain[i].inheritedMoveId != null) '受け継いだ型: ${moveName(chain[i].inheritedMoveId)}${chain[i].inheritedGeneration >= 3 ? '・伝承' : ''}',
                  if (chain[i].isMentor) '師匠の型: ${moveName(chain[i].mentorMoveId)}',
                ].join('\n')),
                isThreeLine: true,
                onTap: () => context.push('/monster/${chain[i].id}'),
              ),
            ),
            if (i < chain.length - 1) const Center(child: Icon(Icons.arrow_downward)),
          ],
          if (chain.length == 1)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(
                me.isMentor ? '弟子を予約すると、次に生まれる 1 体がこの子の弟子になります' : 'Lv50 になると師匠になれます。弟子に素質の一部と技を 1 つ受け継げます',
                style: theme.textTheme.bodyMedium,
              ),
            ),
        ],
      ),
    );
  }
}
