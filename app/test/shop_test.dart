// 課金（P6）: 撮影枠の表示ロジック、ショップ画面の購入導線、詳細画面の専用アート導線。
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/core/config.dart';
import 'package:snapmon/domain/growth.dart';
import 'package:snapmon/features/monster/monster_repository.dart';
import 'package:snapmon/features/shop/purchase_gateway.dart';
import 'package:snapmon/features/shop/shop_screen.dart';

class _Api implements MonsterApi {
  final redeemed = <String>[];
  bool storeReady = true;
  @override
  Future<ProductCatalog> getProducts() async => ProductCatalog(
        storeReady: storeReady,
        products: [
          Product(id: 'snap_ticket_5', kind: 'consumable', name: '撮影チケット 5 枚', description: 'd', priceJpy: 250),
          Product(id: 'premium_monthly', kind: 'subscription', name: 'プレミアム（30 日）', description: 'd', priceJpy: 480),
        ],
      );

  @override
  Future<RedeemResult> redeemPurchase({required String platform, required String productId, required String token}) async {
    redeemed.add('$platform:$productId');
    return RedeemResult(productId: productId, alreadyGranted: false);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

void main() {
  group('snapQuota', () {
    final today = _jstToday();
    final constants = {'snapsPerDay': 1, 'snapsMaxPerDay': 3, 'premiumExtraSnapsPerDay': 1};

    test('free first, then tickets, then daily cap', () {
      final used0 = snapQuota({'dailyState': {'date': today, 'snapsUsed': 0}}, const {}, constants);
      expect(used0.freeLeft, 1);
      expect(used0.canShoot, true);
      expect(used0.willUseTicket, false);

      final used1NoTicket = snapQuota({'dailyState': {'date': today, 'snapsUsed': 1}}, const {}, constants);
      expect(used1NoTicket.canShoot, false);

      final used1Ticket = snapQuota({'dailyState': {'date': today, 'snapsUsed': 1}}, const {'snap_ticket': 2}, constants);
      expect(used1Ticket.canShoot, true);
      expect(used1Ticket.willUseTicket, true);

      final used3 = snapQuota({'dailyState': {'date': today, 'snapsUsed': 3}}, const {'snap_ticket': 9}, constants);
      expect(used3.canShoot, false);
      expect(used3.dailyCapReached, true);
    });

    test('premium adds one free snap; expired premium does not', () {
      final future = DateTime.now().add(const Duration(days: 10)).millisecondsSinceEpoch;
      final past = DateTime.now().subtract(const Duration(days: 1)).millisecondsSinceEpoch;
      expect(snapQuota({'premiumUntil': future}, const {}, constants).freeAllowance, 2);
      expect(snapQuota({'premiumUntil': past}, const {}, constants).freeAllowance, 1);
    });

    test('yesterday\'s usage does not count', () {
      expect(snapQuota({'dailyState': {'date': '20200101', 'snapsUsed': 3}}, const {}, constants).freeLeft, 1);
    });
  });

  testWidgets('shop lists products and a purchase goes through the gateway', (tester) async {
    final api = _Api();
    await tester.pumpWidget(ProviderScope(
      overrides: [
        monsterApiProvider.overrideWithValue(api),
        purchaseGatewayProvider.overrideWithValue(DevPurchaseGateway(api)),
        userDocProvider.overrideWith((ref) => Stream.value({'birthYear': 1990})),
        inventoryProvider.overrideWith((ref) => Stream.value(const {'snap_ticket': 3})),
        gameConfigProvider.overrideWith((ref) async => GameConfig(constants: const {'snapsPerDay': 1, 'snapsMaxPerDay': 3}, personalities: const [], curves: const {})),
      ],
      child: const MaterialApp(home: ShopScreen()),
    ));
    await tester.pumpAndSettle();
    expect(find.text('撮影チケット 5 枚'), findsOneWidget);
    expect(find.textContaining('撮影チケット: 3 枚'), findsOneWidget);
    await tester.tap(find.byKey(const Key('buy-snap_ticket_5')));
    await tester.pumpAndSettle();
    expect(api.redeemed, ['dev:snap_ticket_5']);
    expect(find.textContaining('受け取りました'), findsOneWidget);
  });
}

String _jstToday() {
  final jst = DateTime.now().toUtc().add(const Duration(hours: 9));
  return '${jst.year}${jst.month.toString().padLeft(2, '0')}${jst.day.toString().padLeft(2, '0')}';
}
