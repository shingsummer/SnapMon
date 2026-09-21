import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../auth/auth_provider.dart';
import '../monster/idle_monster_art.dart';
import '../monster/monster_repository.dart';
import '../profile/birth_year_screen.dart';
import '../steps/steps_sync.dart';

/// S03 ホーム（企画書 §8.1）。撮影枠・歩数/VP・パートナー（つぶやき）。
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // 起動時に歩数を取り込む（バックグラウンド処理はしない、§5.2）
    WidgetsBinding.instance.addPostFrameCallback((_) => ref.read(stepsSyncProvider.notifier).sync());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) ref.read(stepsSyncProvider.notifier).sync();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// アカウント削除（利用規約 第 12 条）。確認 → サーバーで削除 → サインアウト
  Future<void> _confirmDeleteAccount(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('アカウントを削除しますか？'),
        content: const Text('モンスター、出自の写真、歩数の記録、アイテム、フレンドがすべて消えます。この操作は取り消せません。'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('やめる')),
          FilledButton(
            key: const Key('delete-account-confirm'),
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('削除する'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    try {
      await ref.read(monsterApiProvider).deleteAccount();
      await ref.read(authProvider).signOut();
    } catch (e) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('削除に失敗しました: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider).state;
    final config = ref.watch(gameConfigProvider);
    final userAsync = ref.watch(userDocProvider);
    final user = userAsync.value;
    // 年齢確認（§14.3）: users.birthYear が無い間はホームの代わりに生年の申告を出す（ドキュメント未作成の新規ユーザーも）
    if (userAsync.hasValue && user?['birthYear'] == null) return const BirthYearGate();
    final sync = ref.watch(stepsSyncProvider);
    final murmurs = ref.watch(murmurTextsProvider).value ?? const {};
    final snapsPerDay = (config.value?.constants['snapsPerDay'] as int?) ?? 3;
    final remaining = remainingSnaps(user, snapsPerDay);
    final stepsToday = todayValue(user, 'stepsToday');
    final vp = vpBalanceOf(user);
    final partnerId = user?['partnerMonsterId'] as String?;
    final partner = partnerId == null ? null : ref.watch(monsterProvider(partnerId)).value;
    final murmur = partner?.lastMurmurTextId == null ? null : murmurs[partner!.lastMurmurTextId!];

    ref.listen(stepsSyncProvider, (prev, next) {
      final text = next.error ?? next.message;
      if (text != null && text != (prev?.error ?? prev?.message) && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(onLongPress: () => context.push('/admin'), child: const Text('SnapMon')),
        actions: [
          IconButton(key: const Key('dex'), tooltip: '図鑑', icon: const Icon(Icons.menu_book), onPressed: () => context.push('/dex')),
          IconButton(key: const Key('items'), tooltip: 'アイテム', icon: const Icon(Icons.backpack_outlined), onPressed: () => context.push('/items')),
          IconButton(key: const Key('friends'), tooltip: 'フレンド・対戦', icon: const Icon(Icons.sports_mma), onPressed: () => context.push('/friends')),
          IconButton(key: const Key('ranch'), tooltip: '牧場', icon: const Icon(Icons.grass), onPressed: () => context.push('/ranch')),
          IconButton(
            key: const Key('sign-out'),
            tooltip: 'サインアウト',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authProvider).signOut(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          config.when(
            loading: () => const _InfoCard(title: '設定を読み込み中…', body: ''),
            error: (e, _) => _InfoCard(title: '設定の読み込みに失敗', body: '$e'),
            data: (_) => _InfoCard(title: '今日の撮影枠', body: '残り $remaining / $snapsPerDay 枚'),
          ),
          Card(
            child: ListTile(
              key: const Key('steps-card'),
              title: const Text('今日の歩数'),
              subtitle: Text('$stepsToday 歩 ・ 活力ポイント $vp VP'),
              trailing: sync.syncing
                  ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                  : IconButton(
                      key: const Key('sync-steps'),
                      tooltip: '歩数を同期',
                      icon: const Icon(Icons.sync),
                      onPressed: () => ref.read(stepsSyncProvider.notifier).sync(force: true),
                    ),
            ),
          ),
          Card(
            child: ListTile(
              leading: partner == null ? const Icon(Icons.egg_outlined, size: 40) : IdleMonsterArt(monster: partner, size: 48, reactToTap: false),
              title: const Text('パートナー'),
              subtitle: Text(
                partner == null
                    ? 'まだいません。1枚撮ってみよう'
                    : '${partner.displayName} ・ Lv${partner.level}${murmur != null ? '\n「$murmur」' : ''}',
              ),
              isThreeLine: murmur != null,
              onTap: partner == null ? null : () => context.push('/monster/${partner.id}'),
            ),
          ),
          _InfoCard(title: 'ログイン中', body: auth.displayName ?? '-'),
          Card(
            child: Column(
              children: [
                ListTile(key: const Key('legal-terms'), dense: true, leading: const Icon(Icons.description_outlined), title: const Text('利用規約'), onTap: () => context.push('/legal/terms')),
                ListTile(key: const Key('legal-privacy'), dense: true, leading: const Icon(Icons.privacy_tip_outlined), title: const Text('プライバシーポリシー'), onTap: () => context.push('/legal/privacy')),
                ListTile(
                  key: const Key('delete-account'),
                  dense: true,
                  leading: Icon(Icons.delete_forever_outlined, color: Theme.of(context).colorScheme.error),
                  title: const Text('アカウントを削除'),
                  onTap: () => _confirmDeleteAccount(context),
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('shoot'),
        onPressed: remaining > 0 ? () => context.push('/camera') : null,
        icon: const Icon(Icons.photo_camera),
        label: Text(remaining > 0 ? '撮る' : '今日はおしまい'),
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(title: Text(title), subtitle: Text(body)),
    );
  }
}
