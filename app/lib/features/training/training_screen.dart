import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config.dart';
import '../monster/models.dart';
import '../monster/idle_monster_art.dart';
import '../monster/monster_repository.dart';

/// S08 トレーニング（企画書 §8.1, §5.3）。4 種選択、VP 残高、疲労ゲージ、結果演出、休息。
class TrainingScreen extends ConsumerStatefulWidget {
  const TrainingScreen({super.key, required this.monsterId});
  final String monsterId;

  @override
  ConsumerState<TrainingScreen> createState() => _TrainingScreenState();
}

class _TrainingScreenState extends ConsumerState<TrainingScreen> {
  bool _busy = false;

  Future<void> _train(String type) async {
    setState(() => _busy = true);
    try {
      final r = await ref.read(monsterApiProvider).train(widget.monsterId, type);
      if (!mounted) return;
      final murmurs = ref.read(murmurTextsProvider).value ?? const {};
      await showDialog<void>(
        context: context,
        builder: (_) => _ResultDialog(result: r, type: type, murmur: r.murmurTextId == null ? null : murmurs[r.murmurTextId!]),
      );
    } on MonsterApiException catch (e) {
      _snack(e.message);
    } catch (_) {
      _snack('トレーニングに失敗しました');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _rest() async {
    setState(() => _busy = true);
    try {
      await ref.read(monsterApiProvider).rest(widget.monsterId);
      _snack('ぐっすり休んだ。疲労が回復した');
    } on MonsterApiException catch (e) {
      _snack(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _snack(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final m = ref.watch(monsterProvider(widget.monsterId)).value;
    final user = ref.watch(userDocProvider).value;
    final cfg = ref.watch(gameConfigProvider).value;
    final cost = (cfg?.constants['trainingCostVp'] as int?) ?? 10;
    final perDay = (cfg?.constants['trainingsPerDay'] as int?) ?? 8;
    final fatigueMax = (cfg?.constants['fatigueMax'] as int?) ?? 100;
    final vp = vpBalanceOf(user);
    final used = todayValue(user, 'trainingsToday');
    final canTrain = !_busy && m != null && vp >= cost && used < perDay && m.fatigue <= fatigueMax;

    return Scaffold(
      appBar: AppBar(title: Text(m == null ? 'トレーニング' : '${m.displayName} のトレーニング')),
      body: m == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Center(child: IdleMonsterArt(monster: m, size: 120)),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _Stat(label: '活力ポイント', value: '$vp VP'),
                    _Stat(label: '今日の回数', value: '$used / $perDay'),
                    _Stat(label: 'Lv', value: '${m.level}'),
                  ],
                ),
                const SizedBox(height: 12),
                Text('疲労 ${m.fatigue} / $fatigueMax', style: theme.textTheme.bodyMedium),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: (m.fatigue / fatigueMax).clamp(0.0, 1.0),
                    minHeight: 10,
                    color: m.fatigue > fatigueMax ? theme.colorScheme.error : theme.colorScheme.tertiary,
                  ),
                ),
                if (m.fatigue > fatigueMax)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('疲れきっている。休息するか、明日まで待とう', style: TextStyle(color: theme.colorScheme.error)),
                  ),
                const SizedBox(height: 16),
                Text('トレーニング（1回 $cost VP）', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final e in trainingJa.entries)
                  Card(
                    child: ListTile(
                      key: Key('train-${e.key}'),
                      title: Text(e.value.name),
                      subtitle: Text('${statJa[e.value.main]} が伸びる（${statJa[e.value.sub]} も少し）・疲労 ${e.value.fatigue}'),
                      trailing: const Icon(Icons.fitness_center),
                      enabled: canTrain,
                      onTap: canTrain ? () => _train(e.key) : null,
                    ),
                  ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  key: const Key('rest'),
                  onPressed: _busy ? null : _rest,
                  icon: const Icon(Icons.bedtime),
                  label: const Text('休息する（VP 不要・1日1回）'),
                ),
                if (!m.personalityRevealed)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text('あと ${(3 - m.trainingCount).clamp(0, 3)} 回トレーニングすると性格がわかる', style: theme.textTheme.bodySmall),
                  ),
              ],
            ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Text(label, style: theme.textTheme.bodySmall),
        Text(value, style: theme.textTheme.titleMedium),
      ],
    );
  }
}

class _ResultDialog extends StatelessWidget {
  const _ResultDialog({required this.result, required this.type, required this.murmur});
  final TrainResult result;
  final String type;
  final String? murmur;

  @override
  Widget build(BuildContext context) {
    final t = trainingJa[type]!;
    if (!result.trained) {
      return AlertDialog(
        title: Text(t.name),
        content: Text(result.message ?? 'もう伸びないようだ'),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
      );
    }
    final ups = statOrder.where((s) => result.statsDelta[s]! > 0).toList();
    return AlertDialog(
      title: Text('${t.name} をした！'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final s in ups) Text('${statJa[s]} +${result.statsDelta[s]}'),
          if (result.levelUps > 0) Padding(padding: const EdgeInsets.only(top: 8), child: Text('レベルアップ！ Lv${result.level}')),
          if (result.personalityRevealed) const Padding(padding: EdgeInsets.only(top: 8), child: Text('性格がわかった')),
          if (murmur != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text('「$murmur」', style: const TextStyle(fontStyle: FontStyle.italic))),
          Padding(padding: const EdgeInsets.only(top: 12), child: Text('疲労 ${result.fatigue} ・ 残り ${result.vpBalance} VP')),
        ],
      ),
      actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('OK'))],
    );
  }
}
