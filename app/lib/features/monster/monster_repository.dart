import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/firebase_env.dart';
import '../auth/auth_provider.dart';
import '../steps/step_source.dart';
import 'models.dart';

/// Firestore 読み取り（自分のデータのみ、ルールで保証）。書き込みはすべて callable 経由。
final firestoreProvider = Provider<FirebaseFirestore>((ref) => FirebaseFirestore.instance);

final _uidProvider = Provider<String?>((ref) => ref.watch(authProvider).state.user?.uid);

/// users/{uid}
final userDocProvider = StreamProvider<Map<String, dynamic>?>((ref) {
  final uid = ref.watch(_uidProvider);
  if (uid == null) return Stream.value(null);
  return ref.watch(firestoreProvider).collection('users').doc(uid).snapshots().map((s) => s.data());
});

/// users/{uid}/inventory → { type: count }
final inventoryProvider = StreamProvider<Map<String, int>>((ref) {
  final uid = ref.watch(_uidProvider);
  if (uid == null) return Stream.value(const {});
  return ref.watch(firestoreProvider).collection('users').doc(uid).collection('inventory').snapshots().map(
        (q) => {for (final d in q.docs) d.id: ((d.data()['count'] as num?) ?? 0).toInt()},
      );
});

/// 自分のモンスター一覧（新しい順）
final monstersProvider = StreamProvider<List<Monster>>((ref) {
  final uid = ref.watch(_uidProvider);
  if (uid == null) return Stream.value(const []);
  return ref
      .watch(firestoreProvider)
      .collection('monsters')
      .where('ownerId', isEqualTo: uid)
      .orderBy('createdAt', descending: true)
      .snapshots()
      .map((q) => q.docs.map(Monster.fromDoc).toList());
});

final monsterProvider = StreamProvider.family<Monster?, String>((ref, id) {
  return ref
      .watch(firestoreProvider)
      .collection('monsters')
      .doc(id)
      .snapshots()
      .map((s) => s.exists ? Monster.fromDoc(s) : null);
});

/// つぶやきテキスト（id → 文言）。assets/config/murmurs.json
final murmurTextsProvider = FutureProvider<Map<String, String>>((ref) async {
  final j = jsonDecode(await rootBundle.loadString('assets/config/murmurs.json')) as Map<String, dynamic>;
  final out = <String, String>{};
  for (final key in ['hints', 'plain']) {
    for (final e in (j[key] as List? ?? const [])) {
      out[(e as Map)['id'] as String] = e['text'] as String;
    }
  }
  return out;
});

/// 技テーブル（id → 表示名など）。assets/config/moves.json
final moveTableProvider = FutureProvider<Map<String, Map<String, dynamic>>>((ref) async {
  final j = jsonDecode(await rootBundle.loadString('assets/config/moves.json')) as Map<String, dynamic>;
  return {for (final m in (j['moves'] as List)) (m as Map)['id'] as String: Map<String, dynamic>.from(m)};
});

/// 今日（JST）の撮影枠の残り
int remainingSnaps(Map<String, dynamic>? user, int snapsPerDay) {
  return snapsPerDay - todayValue(user, 'snapsUsed').clamp(0, snapsPerDay);
}

/// dailyState の値。日付が今日（JST）でなければ 0
int todayValue(Map<String, dynamic>? user, String key) {
  final daily = user?['dailyState'] as Map?;
  if (daily == null) return 0;
  if (daily['date'] != jstDateKey(DateTime.now())) return 0;
  return ((daily[key] as num?) ?? 0).toInt();
}

int vpBalanceOf(Map<String, dynamic>? user) => ((user?['vpBalance'] as num?) ?? 0).toInt();

String jstDateKey(DateTime now) {
  final jst = now.toUtc().add(const Duration(hours: 9));
  final m = jst.month.toString().padLeft(2, '0');
  final d = jst.day.toString().padLeft(2, '0');
  return '${jst.year}$m$d';
}

class MonsterApiException implements Exception {
  MonsterApiException(this.code, this.message, {this.reason});
  final String code;
  final String message;
  final String? reason;

  @override
  String toString() => message;
}

/// callable のラッパ。テストではフェイクに差し替える。
abstract class MonsterApi {
  Future<GenerateResult> generate(Uint8List jpegBytes);
  Future<void> rename(String monsterId, String name);
  Future<SubmitStepsResult> submitSteps(List<StepSegment> segments);
  Future<TrainResult> train(String monsterId, String type);
  Future<void> setPartner(String monsterId);
  Future<UseItemResult> useItem(String monsterId, String itemType);
  Future<void> rest(String monsterId);
  Future<String> retryArtBucket(String bucketId);
  Future<String> retryMonsterArt(String monsterId);
  Future<void> setStorage(String monsterId, bool stored);
  Future<void> appointMentor(String monsterId, String mentorMoveId);
  Future<void> reserveDisciple(String mentorId, bool useCapsule);
  Future<void> cancelDisciple();

  /// 生年の自己申告（13 歳未満は reason 'under_13' の例外）
  Future<void> setBirthYear(int birthYear);

  /// アカウント削除。成功後は呼び出し側でサインアウトする
  Future<void> deleteAccount();

  /// 商品一覧（shared-config/products.json と同じ）と、ストア連携の準備状況
  Future<ProductCatalog> getProducts();

  /// ストアで購入したレシート（token）を送って付与してもらう。同じ注文は 1 回しか付与されない
  Future<RedeemResult> redeemPurchase({required String platform, required String productId, required String token});

  /// 専用アート券を 1 枚使って描き直す
  Future<void> applyArtUpgrade(String monsterId);
}

class ProductCatalog {
  ProductCatalog({required this.products, required this.storeReady});
  final List<Product> products;
  final bool storeReady;
}

class Product {
  Product({required this.id, required this.kind, required this.name, required this.description, required this.priceJpy});
  final String id;
  final String kind; // consumable | subscription
  final String name;
  final String description;
  final int priceJpy;

  factory Product.fromJson(Map<dynamic, dynamic> j) => Product(
        id: j['id'] as String,
        kind: j['kind'] as String,
        name: j['name'] as String,
        description: (j['description'] as String?) ?? '',
        priceJpy: ((j['priceJpy'] as num?) ?? 0).toInt(),
      );
}

class RedeemResult {
  RedeemResult({required this.productId, required this.alreadyGranted, this.premiumUntil});
  final String productId;
  final bool alreadyGranted;
  final int? premiumUntil;
}

/// 撮影枠の状態（サーバーの判定と同じ規則をクライアントで表示用に再現）
class SnapQuota {
  const SnapQuota({required this.usedToday, required this.freeAllowance, required this.tickets, required this.maxPerDay});
  final int usedToday;
  final int freeAllowance;
  final int tickets;
  final int maxPerDay;

  int get freeLeft => (freeAllowance - usedToday).clamp(0, freeAllowance);
  bool get willUseTicket => freeLeft == 0 && tickets > 0 && usedToday < maxPerDay;
  bool get canShoot => usedToday < maxPerDay && (freeLeft > 0 || tickets > 0);
  bool get dailyCapReached => usedToday >= maxPerDay;
}

bool isPremium(Map<String, dynamic>? user, DateTime now) {
  final until = user?['premiumUntil'];
  return until is num && until > now.millisecondsSinceEpoch;
}

SnapQuota snapQuota(Map<String, dynamic>? user, Map<String, int> inventory, Map<String, dynamic>? constants, {DateTime? now}) {
  final n = now ?? DateTime.now();
  final free = ((constants?['snapsPerDay'] as int?) ?? 1) + (isPremium(user, n) ? ((constants?['premiumExtraSnapsPerDay'] as int?) ?? 1) : 0);
  return SnapQuota(
    usedToday: todayValue(user, 'snapsUsed'),
    freeAllowance: free,
    tickets: inventory['snap_ticket'] ?? 0,
    maxPerDay: (constants?['snapsMaxPerDay'] as int?) ?? 3,
  );
}

class FirebaseMonsterApi implements MonsterApi {
  FirebaseMonsterApi([FirebaseFunctions? fns]) : _fns = fns ?? functions();
  final FirebaseFunctions _fns;

  @override
  Future<GenerateResult> generate(Uint8List jpegBytes) async {
    final res = await _call('generateMonster', {'imageBase64': base64Encode(jpegBytes)});
    return GenerateResult.fromJson(res['data'] as Map);
  }

  @override
  Future<void> rename(String monsterId, String name) async {
    await _call('renameMonster', {'monsterId': monsterId, 'name': name});
  }

  @override
  Future<SubmitStepsResult> submitSteps(List<StepSegment> segments) async {
    final res = await _call('submitSteps', {'segments': segments.map((s) => s.toJson()).toList()});
    return SubmitStepsResult.fromJson(res['data'] as Map);
  }

  @override
  Future<TrainResult> train(String monsterId, String type) async {
    final res = await _call('train', {'monsterId': monsterId, 'type': type});
    return TrainResult.fromJson(res['data'] as Map);
  }

  @override
  Future<void> setPartner(String monsterId) async {
    await _call('setPartner', {'monsterId': monsterId});
  }

  @override
  Future<UseItemResult> useItem(String monsterId, String itemType) async {
    final res = await _call('useItem', {'monsterId': monsterId, 'itemType': itemType});
    return UseItemResult.fromJson(res['data'] as Map);
  }

  @override
  Future<void> rest(String monsterId) async {
    await _call('rest', {'monsterId': monsterId});
  }

  @override
  Future<void> setStorage(String monsterId, bool stored) => _call('setStorage', {'monsterId': monsterId, 'stored': stored});

  @override
  Future<void> appointMentor(String monsterId, String mentorMoveId) => _call('appointMentor', {'monsterId': monsterId, 'mentorMoveId': mentorMoveId});

  @override
  Future<void> reserveDisciple(String mentorId, bool useCapsule) => _call('reserveDisciple', {'mentorId': mentorId, 'useCapsule': useCapsule});

  @override
  Future<void> cancelDisciple() => _call('cancelDisciple', {});
  @override
  Future<void> setBirthYear(int birthYear) => _call('setBirthYear', {'birthYear': birthYear});
  @override
  Future<void> deleteAccount() => _call('deleteAccount', {});
  @override
  Future<ProductCatalog> getProducts() async {
    final res = await _call('getProducts', {});
    return ProductCatalog(
      products: ((res['products'] as List?) ?? const []).map((e) => Product.fromJson(e as Map)).toList(),
      storeReady: (res['storeReady'] as bool?) ?? false,
    );
  }

  @override
  Future<RedeemResult> redeemPurchase({required String platform, required String productId, required String token}) async {
    final res = await _call('redeemPurchase', {'platform': platform, 'productId': productId, 'token': token});
    return RedeemResult(productId: res['productId'] as String, alreadyGranted: (res['alreadyGranted'] as bool?) ?? false, premiumUntil: (res['premiumUntil'] as num?)?.toInt());
  }

  @override
  Future<void> applyArtUpgrade(String monsterId) => _call('applyArtUpgrade', {'monsterId': monsterId});

  @override
  Future<String> retryMonsterArt(String monsterId) async {
    final res = await _call('retryMonsterArt', {'monsterId': monsterId});
    return ((res['data'] as Map)['outcome'] as String?) ?? 'unknown';
  }

  @override
  Future<String> retryArtBucket(String bucketId) async {
    final res = await _call('retryArtBucket', {'bucketId': bucketId});
    return ((res['data'] as Map)['outcome'] as String?) ?? 'unknown';
  }

  Future<Map<dynamic, dynamic>> _call(String name, Map<String, dynamic> data) async {
    try {
      final r = await _fns.httpsCallable(name, options: HttpsCallableOptions(timeout: const Duration(seconds: 70))).call(data);
      return r.data as Map;
    } on FirebaseFunctionsException catch (e) {
      final reason = (e.details is Map) ? (e.details as Map)['reason'] as String? : null;
      throw MonsterApiException(e.code, e.message ?? '通信に失敗しました', reason: reason);
    }
  }
}

final monsterApiProvider = Provider<MonsterApi>((ref) => FirebaseMonsterApi());
