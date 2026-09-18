import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/firebase_env.dart';
import '../auth/auth_provider.dart';
import '../monster/monster_repository.dart';
import 'battle_models.dart';

final _uidProvider = Provider<String?>((ref) => ref.watch(authProvider).state.user?.uid);

/// friends/{uid}/list（ブロック済みは除く）
final friendsProvider = StreamProvider<List<FriendEntry>>((ref) {
  final uid = ref.watch(_uidProvider);
  if (uid == null) return Stream.value(const []);
  return ref
      .watch(firestoreProvider)
      .collection('friends')
      .doc(uid)
      .collection('list')
      .snapshots()
      .map((q) => q.docs.map(FriendEntry.fromDoc).where((f) => !f.blocked).toList());
});

/// 自分が関わったバトル（新しい順、最大 20）
final battlesProvider = StreamProvider<List<BattleRecord>>((ref) {
  final uid = ref.watch(_uidProvider);
  if (uid == null) return Stream.value(const []);
  return ref
      .watch(firestoreProvider)
      .collection('battles')
      .where('participants', arrayContains: uid)
      .orderBy('createdAt', descending: true)
      .limit(20)
      .snapshots()
      .map((q) => q.docs.map(BattleRecord.fromDoc).toList());
});

final battleProvider = StreamProvider.family<BattleRecord?, String>((ref, id) {
  return ref.watch(firestoreProvider).collection('battles').doc(id).snapshots().map((s) => s.exists ? BattleRecord.fromDoc(s) : null);
});

abstract class BattleApi {
  Future<String> getFriendCode();
  Future<String?> addFriend(String code);
  Future<void> removeFriend(String targetId);
  Future<void> blockUser(String targetId);
  Future<void> reportUser(String targetId, String reason, String detail);
  Future<void> setBattleParty(List<String> party);
  Future<BattleRecord> startBattle({required String type, String? targetId, required List<String> party});
}

class FirebaseBattleApi implements BattleApi {
  FirebaseBattleApi(this._uid, [FirebaseFunctions? fns]) : _fns = fns ?? functions();
  final String? _uid;
  final FirebaseFunctions _fns;

  Future<Map<dynamic, dynamic>> _call(String name, [Map<String, dynamic> data = const {}]) async {
    try {
      final r = await _fns.httpsCallable(name, options: HttpsCallableOptions(timeout: const Duration(seconds: 70))).call(data);
      return r.data as Map;
    } on FirebaseFunctionsException catch (e) {
      final reason = (e.details is Map) ? (e.details as Map)['reason'] as String? : null;
      throw MonsterApiException(e.code, e.message ?? '通信に失敗しました', reason: reason);
    }
  }

  @override
  Future<String> getFriendCode() async => ((await _call('getFriendCode'))['data'] as Map)['friendCode'] as String;

  @override
  Future<String?> addFriend(String code) async => ((await _call('addFriendFn', {'code': code}))['data'] as Map)['displayName'] as String?;

  @override
  Future<void> removeFriend(String targetId) => _call('removeFriendFn', {'targetId': targetId});

  @override
  Future<void> blockUser(String targetId) => _call('blockUserFn', {'targetId': targetId});

  @override
  Future<void> reportUser(String targetId, String reason, String detail) => _call('reportUserFn', {'targetId': targetId, 'reason': reason, 'detail': detail});

  @override
  Future<void> setBattleParty(List<String> party) => _call('setBattleParty', {'party': party});

  @override
  Future<BattleRecord> startBattle({required String type, String? targetId, required List<String> party}) async {
    final res = await _call('startBattle', {'type': type, if (targetId != null) 'targetId': targetId, 'party': party});
    return BattleRecord.fromStartResult(res['data'] as Map, _uid ?? '');
  }
}

final battleApiProvider = Provider<BattleApi>((ref) => FirebaseBattleApi(ref.watch(_uidProvider)));
