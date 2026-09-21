import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config.dart';
import '../monster/monster_repository.dart';
import 'purchase_gateway.dart';

/// S15 ショップ（企画書 §12、P6 で確定: 広告なし。撮影チケット・プレミアム・専用アート）。
class ShopScreen extends ConsumerStatefulWidget {
  const ShopScreen({super.key});

  @override
  ConsumerState<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends ConsumerState<ShopScreen> {
  late Future<ProductCatalog> _catalog = ref.read(monsterApiProvider).getProducts();
  String? _busyId;

  Future<void> _buy(Product p) async {
    setState(() => _busyId = p.id);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await ref.read(purchaseGatewayProvider).buy(p);
      if (r == null) return;
      messenger.showSnackBar(SnackBar(content: Text(r.alreadyGranted ? 'この購入はすでに反映されています' : '${p.name} を受け取りました')));
    } on MonsterApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('購入に失敗しました: $e')));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final user = ref.watch(userDocProvider).value;
    final inventory = ref.watch(inventoryProvider).value ?? const {};
    final constants = ref.watch(gameConfigProvider).value?.constants;
    final quota = snapQuota(user, inventory, constants);
    final premium = isPremium(user, DateTime.now());
    final premiumUntil = user?['premiumUntil'];

    return Scaffold(
      appBar: AppBar(title: const Text('ショップ')),
      body: FutureBuilder<ProductCatalog>(
        future: _catalog,
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('商品を読み込めませんでした\n${snap.error}', textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  OutlinedButton(onPressed: () => setState(() => _catalog = ref.read(monsterApiProvider).getProducts()), child: const Text('もう一度')),
                ],
              ),
            );
          }
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final catalog = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('いまの状態', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text('今日の無料枠: 残り ${quota.freeLeft} / ${quota.freeAllowance} 枚'),
                      Text('撮影チケット: ${quota.tickets} 枚（1 日の合計は ${quota.maxPerDay} 枚まで）'),
                      Text('専用アート券: ${inventory['art_upgrade'] ?? 0} 枚'),
                      Text(premium ? 'プレミアム: ${_date(premiumUntil)} まで' : 'プレミアム: なし'),
                    ],
                  ),
                ),
              ),
              if (!catalog.storeReady)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text('ストアでの購入はまだ準備中です。', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
                ),
              const SizedBox(height: 8),
              Text('広告は出しません。強さも売りません。', style: theme.textTheme.bodySmall),
              const SizedBox(height: 8),
              for (final p in catalog.products)
                Card(
                  key: Key('product-${p.id}'),
                  child: ListTile(
                    title: Text(p.name),
                    subtitle: Text(p.description),
                    isThreeLine: true,
                    trailing: FilledButton(
                      key: Key('buy-${p.id}'),
                      onPressed: _busyId != null ? null : () => _buy(p),
                      child: _busyId == p.id ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : Text('¥${p.priceJpy}'),
                    ),
                  ),
                ),
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.center,
                children: [
                  TextButton(onPressed: () => context.push('/legal/terms'), child: const Text('利用規約')),
                  TextButton(onPressed: () => context.push('/legal/tokusho'), child: const Text('特定商取引法に基づく表記')),
                ],
              ),
            ],
          );
        },
      ),
    );
  }

  static String _date(Object? ms) {
    if (ms is! num) return '-';
    final d = DateTime.fromMillisecondsSinceEpoch(ms.toInt());
    return '${d.year}/${d.month}/${d.day}';
  }
}
