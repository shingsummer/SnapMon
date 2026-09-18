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
