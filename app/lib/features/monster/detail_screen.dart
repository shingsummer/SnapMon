import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../../domain/growth.dart' as growth;
import 'models.dart';
import 'monster_art.dart';
import 'monster_repository.dart';

/// S07 モンスター詳細。ステータス、成長グラフ（実測のみ・予測線なし §4.2）、技、
/// トレーニング／パートナー指名／エサ。師匠・弟子は P5。
class MonsterDetailScreen extends ConsumerWidget {
  const MonsterDetailScreen({super.key, required this.monsterId});
  final String monsterId;

  Future<void> _run(BuildContext context, Future<void> Function() action, String okMessage) async {
    try {
      await action();
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(okMessage)));
    } on MonsterApiException catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _appointMentor(BuildContext context, WidgetRef ref, Monster m) async {
    final moves = ref.read(moveTableProvider).value ?? const {};
    final chosen = await showDialog<String>(
      context: context,
      builder: (_) => SimpleDialog(
        title: const Text('師匠の型にする技を選ぶ（変更不可）'),
        children: [
          for (final id in m.allMoves)
            SimpleDialogOption(onPressed: () => Navigator.of(context).pop(id), child: Text((moves[id]?['name'] as String?) ?? id)),
        ],
      ),
    );
    if (chosen == null || !context.mounted) return;
    await _run(context, () => ref.read(monsterApiProvider).appointMentor(m.id, chosen), '${m.displayName} は師匠になった');
  }

  Future<void> _reserveDisciple(BuildContext context, WidgetRef ref, Monster m, bool hasCapsule) async {
    var useCapsule = false;
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('弟子を予約'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('次に生まれる 1 体が弟子になり、素質の一部と師匠の型を受け継ぎます。'),
              if (hasCapsule)
                CheckboxListTile(
                  value: useCapsule,
                  onChanged: (v) => setState(() => useCapsule = v ?? false),
                  title: const Text('絆カプセルを使う（継承率アップ）'),
                  contentPadding: EdgeInsets.zero,
                ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('やめる')),
            FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('予約する')),
          ],
        ),
      ),
    );
    if (ok != true || !context.mounted) return;
    await _run(context, () => ref.read(monsterApiProvider).reserveDisciple(m.id, useCapsule), '次に生まれる子が弟子になります');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final async = ref.watch(monsterProvider(monsterId));
    final user = ref.watch(userDocProvider).value;
    final inventory = ref.watch(inventoryProvider).value ?? const {};
    final murmurs = ref.watch(murmurTextsProvider).value ?? const {};
    final cfg = ref.watch(gameConfigProvider).value;
    final personalities = cfg?.personalities;
    final moveTable = ref.watch(moveTableProvider).value ?? const <String, Map<String, dynamic>>{};
    final api = ref.read(monsterApiProvider);

    return Scaffold(
      appBar: AppBar(title: Text(async.value?.displayName ?? '')),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text('読み込みに失敗しました\n$e', textAlign: TextAlign.center)),
        data: (m) {
          if (m == null) return const Center(child: Text('見つかりません'));
          final isPartner = user?['partnerMonsterId'] == m.id;
          final expNext = cfg == null ? null : growth.expToNext(cfg, m.level);
          final murmur = m.lastMurmurTextId == null ? null : murmurs[m.lastMurmurTextId!];
          final foods = inventory.entries.where((e) => e.value > 0 && (e.key == 'food_${m.family}' || (m.subFamily != null && e.key == 'food_${m.subFamily}'))).toList();
          final personalityName = m.personalityRevealed && personalities != null && m.personality < personalities.length
              ? (personalities[m.personality] as Map)['name'] as String?
              : null;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(child: MonsterArt(monster: m, size: 180, showPendingBadge: true)),
              const SizedBox(height: 8),
              Center(
                child: Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  alignment: WrapAlignment.center,
                  children: [
                    Chip(label: Text('Lv${m.level}')),
                    Chip(label: Text(m.familyLabel)),
                    Chip(label: Text('${m.elementLabel}属性')),
                    if (personalityName != null) Chip(label: Text(personalityName)),
                    if (isPartner) const Chip(avatar: Icon(Icons.favorite, size: 16), label: Text('パートナー')),
                    if (m.sourceLabel.isNotEmpty) Chip(label: Text('出自: ${m.sourceLabel}')),
                  ],
                ),
              ),
              if (murmur != null) ...[
                const SizedBox(height: 8),
                Center(child: Text('「$murmur」', style: theme.textTheme.bodyMedium?.copyWith(fontStyle: FontStyle.italic))),
              ],
              const SizedBox(height: 12),
              if (expNext != null && m.level < 50) ...[
                Text('経験値 ${m.exp} / $expNext', style: theme.textTheme.bodySmall),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(value: (m.exp / expNext).clamp(0.0, 1.0), minHeight: 8),
                ),
                const SizedBox(height: 8),
              ],
              Text('疲労 ${m.fatigue}', style: theme.textTheme.bodySmall),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: LinearProgressIndicator(value: (m.fatigue / 100).clamp(0.0, 1.0), minHeight: 8, color: theme.colorScheme.tertiary),
              ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton.icon(
                    key: const Key('go-train'),
                    onPressed: m.isStored ? null : () => context.push('/train/${m.id}'),
                    icon: const Icon(Icons.fitness_center),
                    label: const Text('トレーニング'),
                  ),
                  if (!isPartner)
                    OutlinedButton.icon(
                      key: const Key('set-partner'),
                      onPressed: m.isStored ? null : () => _run(context, () => api.setPartner(m.id), '${m.displayName} をパートナーにした'),
                      icon: const Icon(Icons.favorite_border),
                      label: const Text('パートナーにする'),
                    ),
                  for (final f in foods)
                    OutlinedButton.icon(
                      key: Key('feed-${f.key}'),
                      onPressed: () => _run(context, () => api.useItem(m.id, f.key), '${itemLabel(f.key)} をあげた'),
                      icon: const Icon(Icons.restaurant),
                      label: Text('${itemLabel(f.key)} ×${f.value}'),
                    ),
                  if (m.canBecomeMentor)
                    OutlinedButton.icon(
                      key: const Key('appoint-mentor'),
                      onPressed: () => _appointMentor(context, ref, m),
                      icon: const Icon(Icons.school),
                      label: const Text('師匠に任命'),
                    ),
                  if (m.isMentor && !m.mentorUsed && user?['pendingDisciple'] == null)
                    OutlinedButton.icon(
                      key: const Key('reserve-disciple'),
                      onPressed: () => _reserveDisciple(context, ref, m, (inventory['bond_capsule'] ?? 0) > 0),
                      icon: const Icon(Icons.child_care),
                      label: const Text('弟子を予約'),
                    ),
                  if (m.isMentor && !m.mentorUsed && (user?['pendingDisciple'] as Map?)?['mentorId'] == m.id)
                    OutlinedButton.icon(
                      onPressed: () => _run(context, () => api.cancelDisciple(), '弟子の予約を取り消した'),
                      icon: const Icon(Icons.cancel_outlined),
                      label: const Text('弟子の予約中（取り消す）'),
                    ),
                  if (m.isMentor || m.mentorId != null)
                    OutlinedButton.icon(
                      key: const Key('lineage'),
                      onPressed: () => context.push('/lineage/${m.id}'),
                      icon: const Icon(Icons.account_tree),
                      label: const Text('家系図'),
                    ),
                ],
              ),
              if (m.isMentor)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(m.mentorUsed ? '師匠（弟子あり）' : '師匠（弟子はまだ）', style: theme.textTheme.bodySmall),
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
              for (final id in m.moves) ListTile(dense: true, leading: const Icon(Icons.flash_on), title: Text((moveTable[id]?['name'] as String?) ?? id)),
              if (m.inheritedMoveId != null)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.auto_awesome),
                  title: Text('師匠の型: ${(moveTable[m.inheritedMoveId]?['name'] as String?) ?? m.inheritedMoveId}${m.inheritedGeneration >= 3 ? '・伝承（威力 +10%）' : ''}'),
                ),
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
      ..strokeWidth = 1
      ..style = PaintingStyle.stroke;
    canvas.drawRect(Offset.zero & size, gridPaint);
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
