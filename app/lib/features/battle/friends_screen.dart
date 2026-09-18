import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../monster/monster_repository.dart';
import 'battle_models.dart';
import 'battle_repository.dart';
import 'party_picker.dart';

/// S16 フレンド（企画書 §8.1）: コード表示・入力、一覧、対戦、通報・ブロック（§14.3 UGC 要件）。模擬戦もここから。
class FriendsScreen extends ConsumerStatefulWidget {
  const FriendsScreen({super.key});

  @override
  ConsumerState<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends ConsumerState<FriendsScreen> {
  String? _code;
  final _input = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadCode();
  }

  Future<void> _loadCode() async {
    try {
      final c = await ref.read(battleApiProvider).getFriendCode();
      if (mounted) setState(() => _code = c);
    } catch (_) {}
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _snack(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
    } on MonsterApiException catch (e) {
      _snack(e.message);
    } catch (_) {
      _snack('うまくいきませんでした');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<List<String>?> _pickParty(BuildContext context, {List<String> exclude = const []}) {
    final user = ref.read(userDocProvider).value;
    final initial = ((user?['battleParty'] as List?) ?? const []).cast<String>();
    return Navigator.of(context).push<List<String>>(
      MaterialPageRoute(builder: (_) => PartyPickerScreen(initial: initial.where((id) => !exclude.contains(id)).toList(), exclude: exclude)),
    );
  }

  Future<void> _battle(BuildContext context, {required String type, String? targetId}) async {
    final party = await _pickParty(context);
    if (party == null || !context.mounted) return;
    await _run(() async {
      final api = ref.read(battleApiProvider);
      if (type == 'friend') await api.setBattleParty(party);
      final r = await api.startBattle(type: type, targetId: targetId, party: party);
      if (context.mounted) context.push('/battle/${r.id}', extra: r);
    });
  }

  Future<void> _report(BuildContext context, FriendEntry f) async {
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => SimpleDialog(
        title: Text('${f.label} を通報'),
        children: [
          for (final r in const ['不適切な名前', 'いやがらせ', 'その他'])
            SimpleDialogOption(onPressed: () => Navigator.of(context).pop(r), child: Text(r)),
        ],
      ),
    );
    if (reason == null) return;
    await _run(() async {
      await ref.read(battleApiProvider).reportUser(f.uid, reason, '');
      _snack('通報しました。確認します');
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final friends = ref.watch(friendsProvider).value ?? const <FriendEntry>[];
    final battles = ref.watch(battlesProvider).value ?? const <BattleRecord>[];
    return Scaffold(
      appBar: AppBar(title: const Text('フレンド・対戦')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              title: const Text('あなたのフレンドコード'),
              subtitle: Text(_code ?? '取得中…', style: theme.textTheme.headlineSmall),
              trailing: IconButton(
                icon: const Icon(Icons.copy),
                onPressed: _code == null
                    ? null
                    : () {
                        Clipboard.setData(ClipboardData(text: _code!));
                        _snack('コピーしました');
                      },
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('friend-code-input'),
                  controller: _input,
                  textCapitalization: TextCapitalization.characters,
                  decoration: const InputDecoration(border: OutlineInputBorder(), labelText: '相手のコード（例: ABCD-2345）'),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                key: const Key('add-friend'),
                onPressed: _busy
                    ? null
                    : () => _run(() async {
                          final name = await ref.read(battleApiProvider).addFriend(_input.text);
                          _input.clear();
                          _snack('${name ?? 'フレンド'} を追加しました');
                        }),
                child: const Text('追加'),
              ),
            ],
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            key: const Key('practice-battle'),
            onPressed: _busy ? null : () => _battle(context, type: 'practice'),
            icon: const Icon(Icons.sports_kabaddi),
            label: const Text('模擬戦（自分のモンスター同士・報酬なし）'),
          ),
          const SizedBox(height: 16),
          Text('フレンド', style: theme.textTheme.titleMedium),
          if (friends.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('まだいません。コードを交換しよう')),
          for (final f in friends)
            Card(
              child: ListTile(
                title: Text(f.label),
                subtitle: Text(f.uid.substring(0, 6)),
                trailing: Wrap(
                  spacing: 4,
                  children: [
                    IconButton(tooltip: '対戦', icon: const Icon(Icons.sports_mma), onPressed: _busy ? null : () => _battle(context, type: 'friend', targetId: f.uid)),
                    PopupMenuButton<String>(
                      onSelected: (v) {
                        if (v == 'remove') _run(() => ref.read(battleApiProvider).removeFriend(f.uid));
                        if (v == 'block') _run(() => ref.read(battleApiProvider).blockUser(f.uid));
                        if (v == 'report') _report(context, f);
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'remove', child: Text('フレンド解除')),
                        PopupMenuItem(value: 'block', child: Text('ブロック')),
                        PopupMenuItem(value: 'report', child: Text('通報')),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: 16),
          Text('最近のバトル', style: theme.textTheme.titleMedium),
          if (battles.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Text('まだありません')),
          for (final b in battles)
            ListTile(
              dense: true,
              leading: Icon(b.attackerWon() ? Icons.emoji_events : Icons.remove_circle_outline),
              title: Text('${b.type == 'practice' ? '模擬戦' : 'フレンド戦'} ・ ${b.attackerWon() ? '勝ち' : b.winner == 'draw' ? '引き分け' : '負け'}'),
              subtitle: Text(b.createdAt?.toLocal().toString().substring(0, 16) ?? ''),
              onTap: () => context.push('/battle/${b.id}', extra: b),
            ),
        ],
      ),
    );
  }
}
