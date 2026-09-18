import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../monster/models.dart';
import '../monster/monster_art.dart';
import '../monster/monster_repository.dart';

/// 3 体を選ぶ（対戦パーティ）。選び終わると Navigator.pop で id リストを返す。
class PartyPickerScreen extends ConsumerStatefulWidget {
  const PartyPickerScreen({super.key, this.title = 'パーティを選ぶ', this.initial = const [], this.exclude = const []});
  final String title;
  final List<String> initial;
  final List<String> exclude;

  @override
  ConsumerState<PartyPickerScreen> createState() => _PartyPickerScreenState();
}

class _PartyPickerScreenState extends ConsumerState<PartyPickerScreen> {
  late final List<String> _selected = [...widget.initial];

  @override
  Widget build(BuildContext context) {
    final monsters = ref.watch(monstersProvider).value ?? const <Monster>[];
    final candidates = monsters.where((m) => !m.isStored && !widget.exclude.contains(m.id)).toList();
    return Scaffold(
      appBar: AppBar(title: Text('${widget.title}（${_selected.length}/3）')),
      body: candidates.isEmpty
          ? const Center(child: Text('出せるモンスターがいません'))
          : ListView.builder(
              itemCount: candidates.length,
              itemBuilder: (context, i) {
                final m = candidates[i];
                final idx = _selected.indexOf(m.id);
                return CheckboxListTile(
                  key: Key('pick-${m.id}'),
                  value: idx >= 0,
                  secondary: MonsterArt(monster: m, size: 44),
                  title: Text(idx >= 0 ? '${idx + 1}. ${m.displayName}' : m.displayName),
                  subtitle: Text('Lv${m.level} ・ ${m.familyLabel} ・ ${m.elementLabel} ・ 合計 ${m.total}'),
                  onChanged: (v) => setState(() {
                    if (v == true) {
                      if (_selected.length < 3) _selected.add(m.id);
                    } else {
                      _selected.remove(m.id);
                    }
                  }),
                );
              },
            ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            key: const Key('party-confirm'),
            onPressed: _selected.length == 3 ? () => Navigator.of(context).pop(List<String>.from(_selected)) : null,
            child: const Text('このパーティで'),
          ),
        ),
      ),
    );
  }
}
