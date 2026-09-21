import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../monster/monster_repository.dart';

/// ストア決済の入口。
/// - 本番: Google Play / App Store で購入 → レシートをサーバー（redeemPurchase）へ → 付与。ストア連携は未設定（P6 で後述）
/// - デバッグ（エミュレータ）: ストアを通さず、疑似レシートで redeemPurchase を呼ぶ（platform: dev）
abstract class PurchaseGateway {
  /// 購入して付与まで終わったら RedeemResult。ユーザーが途中でやめたら null
  Future<RedeemResult?> buy(Product product);

  /// 復元（サブスクの再インストール時など）。今は何もしない
  Future<void> restore() async {}
}

class DevPurchaseGateway implements PurchaseGateway {
  DevPurchaseGateway(this.api);
  final MonsterApi api;
  int _seq = 0;

  @override
  Future<RedeemResult?> buy(Product product) async {
    final token = 'dev-${DateTime.now().millisecondsSinceEpoch}-${_seq++}';
    return api.redeemPurchase(platform: 'dev', productId: product.id, token: token);
  }

  @override
  Future<void> restore() async {}
}

/// ストア連携が入るまでの本番用: 購入は「準備中」として何もしない
class NotReadyPurchaseGateway implements PurchaseGateway {
  @override
  Future<RedeemResult?> buy(Product product) async => throw MonsterApiException('failed-precondition', '購入はまだ準備中です', reason: 'store_not_configured');

  @override
  Future<void> restore() async {}
}

final purchaseGatewayProvider = Provider<PurchaseGateway>((ref) {
  final api = ref.watch(monsterApiProvider);
  return kDebugMode ? DevPurchaseGateway(api) : NotReadyPurchaseGateway();
});
