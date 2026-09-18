import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'models.dart';
import 'monster_art.dart';
import 'monster_repository.dart';

/// S07 モンスター詳細。ステータス、成長グラフ（実測のみ・予測線なし §4.2）、技。
/// トレーニング／アイテム使用は P2、師匠・弟子は P5。
class MonsterDetailScreen extends ConsumerWidget {
  const MonsterDetailScreen({super.key, required this.monsterId});
  final String monsterId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(monsterProvider(monsterId));
    return Scaffold(
      appBar: AppBar(title: Text(async.value?.displayName ?? '')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('読み込みに失敗しました\n$e', textAlign: TextAlign.center)),
        data: (m) {
          if (m == null) return const Center(child: Text('見つかりません'));
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(child: MonsterArt(monster: m, size: 180)),
              const SizedBox(height: 8),
              Center(
                child: Wrap(
                  spacing: 8,
                  children: [
                    Chip(label: Text('Lv${m.level}')),
                    Chip(label: Text(m.familyLabel)),
                    Chip(label: Text('${m.elementLabel}属性')),
                    if (m.sourceLabel.isNotEmpty) Chip(label: Text('出自: ${m.sourceLabel}')),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text('ステータス（合計 ${m.total}）', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              for (final s in statOrder)
                Row(
                  children: [
                    SizedBox(width: 48, child: Text(statJa[s]!)),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(value: (m.stats[s]! / 999).clamp(0.0, 1.0), minHeight: 10),
                      ),
                    ),
                    SizedBox(width: 48, child: Text('${m.stats[s]}', textAlign: TextAlign.right)),
                  ],
                ),
              const SizedBox(height: 16),
              Text('成長グラフ（合計値）', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              SizedBox(
                height: 140,
                child: CustomPaint(
                  painter: _GrowthPainter(m.statHistory, theme.colorScheme.primary, theme.colorScheme.outlineVariant),
                  child: const SizedBox.expand(),
                ),
              ),
              Text('Lv1〜Lv${m.level} の実測。予測線は出ません。', style: theme.textTheme.bodySmall),
              const SizedBox(height: 16),
              Text('わざ', style: theme.textTheme.titleMedium),
              for (final id in m.moves) ListTile(dense: true, leading: const Icon(Icons.flash_on), title: Text(id)),
              if (m.inheritedMoveId != null)
                ListTile(dense: true, leading: const Icon(Icons.auto_awesome), title: Text('師匠の型: ${m.inheritedMoveId}')),
              const SizedBox(height: 16),
              Text('トレーニングは P2 で追加されます', style: theme.textTheme.bodySmall),
            ],
          );
        },
      ),
    );
  }
}

/// 実測値だけを折れ線で描く。上限線・予測線は描かない（企画書 §4.2）。
class _GrowthPainter extends CustomPainter {
  _GrowthPainter(this.history, this.color, this.grid);
  final List<StatSnapshot> history;
  final Color color;
  final Color grid;

  @override
  void paint(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = grid
      ..strokeWidth = 1;
    canvas.drawRect(Offset.zero & size, gridPaint..style = PaintingStyle.stroke);
    if (history.isEmpty) return;
    const maxLevel = 50;
    final maxTotal = (history.map((h) => h.total).reduce((a, b) => a > b ? a : b) * 1.2).clamp(100, 5994).toDouble();
    final path = Path();
    for (var i = 0; i < history.length; i++) {
      final h = history[i];
      final x = (h.level - 1) / (maxLevel - 1) * size.width;
      final y = size.height - h.total / maxTotal * size.height;
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );
    final last = history.last;
    final lx = (last.level - 1) / (maxLevel - 1) * size.width;
    final ly = size.height - last.total / maxTotal * size.height;
    canvas.drawCircle(Offset(lx, ly), 4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _GrowthPainter old) => old.history != history || old.color != color;
}
