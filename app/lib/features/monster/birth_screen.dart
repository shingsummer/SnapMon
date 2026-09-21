import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'models.dart';
import 'idle_monster_art.dart';
import 'monster_art.dart';
import 'monster_repository.dart';

/// S05 誕生演出（企画書 §8.1）。リビール → 初期ステータス → アイテム → 名前付け。
class BirthScreen extends ConsumerStatefulWidget {
  const BirthScreen({super.key, required this.monsterId, this.result});

  final String monsterId;
  final GenerateResult? result;

  @override
  ConsumerState<BirthScreen> createState() => _BirthScreenState();
}

class _BirthScreenState extends ConsumerState<BirthScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _reveal = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..forward();
  final _nameCtrl = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _reveal.dispose();
    _nameCtrl.dispose();
    super.dispose();
  }

  /// ホームを土台にして詳細を積む（端末の戻るでアプリが終了しないように）
  void _openDetail() {
    context.go('/home');
    context.push('/monster/${widget.monsterId}');
  }

  Future<void> _submit() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(monsterApiProvider).rename(widget.monsterId, _nameCtrl.text);
      if (!mounted) return;
      _openDetail();
    } on MonsterApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = '名前をつけられませんでした');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final r = widget.result;
    final monster = ref.watch(monsterProvider(widget.monsterId)).value;
    final family = monster?.family ?? r?.family ?? 'enigma';
    final element = monster?.element ?? r?.element ?? 'neutral';
    final base = monster?.base ?? r?.base ?? const <String, int>{};
    final familyLabel = monster?.familyLabel ?? (familyJa[family] ?? family);

    return Scaffold(
      appBar: AppBar(title: Text(monster != null && monster.isHatching ? '卵が…' : '生まれた！'), automaticallyImplyLeading: false),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Center(
            child: ScaleTransition(
              scale: CurvedAnimation(parent: _reveal, curve: Curves.elasticOut),
              child: FadeTransition(
                opacity: _reveal,
                child: monster == null
                    ? FamilyArt(family: family, element: element, size: 220)
                    : IdleMonsterArt(monster: monster, size: 220, showPendingBadge: true),
              ),
            ),
          ),
          if (monster != null && monster.isHatching)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('撮った写真から、この子だけの姿を描いています（30〜60 秒）', textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
            ),
          const SizedBox(height: 16),
          Center(
            child: Wrap(
              spacing: 8,
              children: [
                Chip(label: Text(familyLabel)),
                Chip(label: Text('${elementJa[element] ?? element}属性')),
                if (r?.sourceLabel.isNotEmpty ?? false) Chip(label: Text('出自: ${r!.sourceLabel}')),
              ],
            ),
          ),
          const SizedBox(height: 24),
          Text('はじめのステータス', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          _StatTable(stats: base),
          if (r != null && r.items.isNotEmpty) ...[
            const SizedBox(height: 24),
            Text('いっしょに見つけたもの', style: theme.textTheme.titleMedium),
            for (final it in r.items) ListTile(leading: const Icon(Icons.card_giftcard), title: Text('${it.label} ×${it.count}')),
          ],
          if (r?.mentorId != null) ...[
            const SizedBox(height: 8),
            const ListTile(leading: Icon(Icons.auto_awesome), title: Text('師匠の力が受け継がれた')),
          ],
          const SizedBox(height: 24),
          Text('なまえをつけよう', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(
            key: const Key('name-field'),
            controller: _nameCtrl,
            maxLength: 12,
            enabled: !_saving,
            decoration: InputDecoration(border: const OutlineInputBorder(), hintText: '${familyJa[family] ?? family}のこ', errorText: _error),
            onSubmitted: (_) => _submit(),
          ),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('name-submit'),
            onPressed: _saving ? null : _submit,
            child: _saving ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('けってい'),
          ),
          TextButton(
            onPressed: _saving ? null : _openDetail,
            child: const Text('あとでつける'),
          ),
          if (r != null) ...[
            const SizedBox(height: 8),
            Center(child: Text('今日の撮影枠 残り ${r.snapsPerDay - r.snapsUsed} / ${r.snapsPerDay}', style: theme.textTheme.bodySmall)),
          ],
        ],
      ),
    );
  }
}

class _StatTable extends StatelessWidget {
  const _StatTable({required this.stats});
  final Map<String, int> stats;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final s in statOrder)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(
              children: [
                SizedBox(width: 48, child: Text(statJa[s]!)),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: LinearProgressIndicator(value: ((stats[s] ?? 0) / 60).clamp(0.0, 1.0), minHeight: 10),
                  ),
                ),
                SizedBox(width: 44, child: Text('${stats[s] ?? 0}', textAlign: TextAlign.right)),
              ],
            ),
          ),
      ],
    );
  }
}
