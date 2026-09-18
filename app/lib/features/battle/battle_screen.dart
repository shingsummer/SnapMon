import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'battle_models.dart';
import 'battle_repository.dart';

/// S11 バトル（企画書 §8.1）。サーバーが解決したログをターン順に再生する。
class BattleScreen extends ConsumerStatefulWidget {
  const BattleScreen({super.key, required this.battleId, this.record});
  final String battleId;
  final BattleRecord? record;

  @override
  ConsumerState<BattleScreen> createState() => _BattleScreenState();
}

class _BattleScreenState extends ConsumerState<BattleScreen> {
  int _shown = 0;
  Timer? _timer;
  bool _fast = false;
  final _scroll = ScrollController();

  BattleRecord? get _record => widget.record ?? ref.read(battleProvider(widget.battleId)).value;

  @override
  void initState() {
    super.initState();
    _start();
  }

  void _start() {
    _timer?.cancel();
    _timer = Timer.periodic(Duration(milliseconds: _fast ? 250 : 900), (t) {
      final r = _record;
      if (r == null) return;
      if (_shown >= r.events.length) {
        t.cancel();
        return;
      }
      setState(() => _shown++);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      });
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final r = widget.record ?? ref.watch(battleProvider(widget.battleId)).value;
    if (r == null) {
      return Scaffold(appBar: AppBar(title: const Text('バトル')), body: const Center(child: CircularProgressIndicator()));
    }
    final shown = r.events.take(_shown).toList();
    final last = shown.isEmpty ? r.events.first : shown.last;
    final finished = _shown >= r.events.length;
    return Scaffold(
      appBar: AppBar(
        title: Text(r.type == 'practice' ? '模擬戦' : 'フレンド戦'),
        actions: [
          TextButton(
            key: const Key('battle-fast'),
            onPressed: finished ? null : () => setState(() {
              _fast = true;
              _start();
            }),
            child: const Text('早送り'),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _HpBar(label: 'こちら', hp: last.hpA, max: last.maxA, color: theme.colorScheme.primary),
                const SizedBox(height: 8),
                _HpBar(label: 'あいて', hp: last.hpB, max: last.maxB, color: theme.colorScheme.error),
              ],
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              itemCount: shown.length,
              itemBuilder: (context, i) {
                final e = shown[i];
                final style = switch (e.type) {
                  'hit' => theme.textTheme.bodyMedium?.copyWith(fontWeight: e.crit ? FontWeight.bold : null),
                  'faint' || 'timeout' => theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.error),
                  'end' => theme.textTheme.titleMedium,
                  'start' || 'switch' => theme.textTheme.bodySmall,
                  _ => theme.textTheme.bodyMedium,
                };
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Text(e.side == 'B' && e.type != 'faint' ? '　${e.text}' : e.text, style: style),
                );
              },
            ),
          ),
          if (finished)
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(
                      r.winner == 'A' ? '勝利！' : r.winner == 'B' ? '敗北…' : '引き分け',
                      style: theme.textTheme.headlineSmall,
                    ),
                    if (r.expPerMonster > 0 || r.vp > 0)
                      Text('参加モンスターに +${r.expPerMonster} exp${r.vp > 0 ? ' ・ +${r.vp} VP' : ''}', style: theme.textTheme.bodyMedium),
                    const SizedBox(height: 8),
                    FilledButton(key: const Key('battle-done'), onPressed: () => context.pop(), child: const Text('もどる')),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _HpBar extends StatelessWidget {
  const _HpBar({required this.label, required this.hp, required this.max, required this.color});
  final String label;
  final int hp;
  final int max;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        SizedBox(width: 56, child: Text(label)),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: (hp / max).clamp(0.0, 1.0)),
              duration: const Duration(milliseconds: 400),
              builder: (_, v, __) => LinearProgressIndicator(value: v, minHeight: 12, color: color),
            ),
          ),
        ),
        SizedBox(width: 90, child: Text('$hp / $max', textAlign: TextAlign.right)),
      ],
    );
  }
}
