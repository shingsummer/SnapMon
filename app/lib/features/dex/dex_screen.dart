import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../monster/models.dart';
import '../monster/monster_repository.dart';

/// S12 図鑑（企画書 §8.1）: 発見したファミリー×属性の組み合わせと、被写体ラベルの履歴。
/// 自分のモンスター（保管中も含む）から端末側で集計する。
class DexScreen extends ConsumerWidget {
  const DexScreen({super.key});

  static const families = ['beast', 'plant', 'metal', 'aqua', 'rock', 'spark', 'ghost', 'food', 'paper', 'cloth', 'toy', 'enigma'];
  static const elements = ['fire', 'water', 'grass', 'thunder', 'light', 'dark', 'neutral'];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final monsters = ref.watch(monstersProvider).value ?? const <Monster>[];
    final found = <String, int>{};
    final labels = <String, int>{};
    for (final m in monsters) {
      found['${m.family}_${m.element}'] = (found['${m.family}_${m.element}'] ?? 0) + 1;
      if (m.sourceLabel.isNotEmpty) labels[m.sourceLabel] = (labels[m.sourceLabel] ?? 0) + 1;
    }
    final total = families.length * elements.length;
    final sortedLabels = labels.entries.toList()..sort((a, b) => b.value.compareTo(a.value));

    return Scaffold(
      appBar: AppBar(title: Text('図鑑 ${found.length} / $total')),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          Row(
            children: [
              const SizedBox(width: 64),
              for (final e in elements) Expanded(child: Center(child: Text(elementJa[e]!, style: theme.textTheme.bodySmall))),
            ],
          ),
          for (final f in families)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(
                children: [
                  SizedBox(width: 64, child: Text(familyJa[f]!, style: theme.textTheme.bodySmall)),
                  for (final e in elements)
                    Expanded(
                      child: AspectRatio(
                        aspectRatio: 1,
                        child: Padding(
                          padding: const EdgeInsets.all(2),
                          child: found.containsKey('${f}_$e')
                              ? Tooltip(
                                  message: '${familyJa[f]}・${elementJa[e]} ×${found['${f}_$e']}',
                                  child: SvgPicture.asset('assets/art/placeholder/${f}_$e.svg'),
                                )
                              : DecoratedBox(
                                  decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(6)),
                                  child: const Center(child: Text('?', style: TextStyle(color: Colors.grey))),
                                ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          Text('撮ったもの', style: theme.textTheme.titleMedium),
          if (sortedLabels.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('まだありません')),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [for (final e in sortedLabels) Chip(label: Text('${e.key} ×${e.value}'))],
          ),
        ],
      ),
    );
  }
}
