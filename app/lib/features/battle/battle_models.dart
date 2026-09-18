import 'package:cloud_firestore/cloud_firestore.dart';

/// サーバーが解決したバトルの 1 イベント（functions/src/battle/engine.ts の BattleEvent）
class BattleEvent {
  BattleEvent({
    required this.duel,
    required this.turn,
    required this.side,
    required this.type,
    required this.text,
    required this.hpA,
    required this.hpB,
    required this.maxA,
    required this.maxB,
    this.damage,
    this.crit = false,
    this.typeMod,
  });

  final int duel;
  final int turn;
  final String? side; // A | B
  final String type;
  final String text;
  final int hpA;
  final int hpB;
  final int maxA;
  final int maxB;
  final int? damage;
  final bool crit;
  final double? typeMod;

  factory BattleEvent.fromJson(Map<dynamic, dynamic> j) => BattleEvent(
        duel: ((j['duel'] as num?) ?? 0).toInt(),
        turn: ((j['turn'] as num?) ?? 0).toInt(),
        side: j['side'] as String?,
        type: (j['type'] as String?) ?? 'move',
        text: (j['text'] as String?) ?? '',
        hpA: ((j['hpA'] as num?) ?? 0).toInt(),
        hpB: ((j['hpB'] as num?) ?? 0).toInt(),
        maxA: ((j['maxA'] as num?) ?? 1).toInt(),
        maxB: ((j['maxB'] as num?) ?? 1).toInt(),
        damage: (j['damage'] as num?)?.toInt(),
        crit: (j['crit'] as bool?) ?? false,
        typeMod: (j['typeMod'] as num?)?.toDouble(),
      );
}

class BattleRecord {
  BattleRecord({
    required this.id,
    required this.type,
    required this.attackerId,
    required this.defenderId,
    required this.attackerParty,
    required this.defenderParty,
    required this.winner,
    required this.events,
    required this.vp,
    required this.expPerMonster,
    required this.createdAt,
  });

  final String id;
  final String type; // friend | practice
  final String attackerId;
  final String defenderId;
  final List<String> attackerParty;
  final List<String> defenderParty;
  final String winner; // A | B | draw
  final List<BattleEvent> events;
  final int vp;
  final int expPerMonster;
  final DateTime? createdAt;

  bool attackerWon() => winner == 'A';

  factory BattleRecord.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final rewards = (d['rewards'] as Map?) ?? const {};
    return BattleRecord(
      id: doc.id,
      type: (d['type'] as String?) ?? 'practice',
      attackerId: (d['attackerId'] as String?) ?? '',
      defenderId: (d['defenderId'] as String?) ?? '',
      attackerParty: ((d['attackerParty'] as List?) ?? const []).cast<String>(),
      defenderParty: ((d['defenderParty'] as List?) ?? const []).cast<String>(),
      winner: (d['winner'] as String?) ?? 'draw',
      events: ((d['events'] as List?) ?? const []).map((e) => BattleEvent.fromJson(e as Map)).toList(),
      vp: ((rewards['vp'] as num?) ?? 0).toInt(),
      expPerMonster: ((rewards['expPerMonster'] as num?) ?? 0).toInt(),
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }

  /// startBattle のレスポンス（保存前の即時再生用）
  factory BattleRecord.fromStartResult(Map<dynamic, dynamic> j, String uid) {
    final result = j['result'] as Map;
    final rewards = (j['rewards'] as Map?) ?? const {};
    return BattleRecord(
      id: j['battleId'] as String,
      type: (j['type'] as String?) ?? 'practice',
      attackerId: uid,
      defenderId: '',
      attackerParty: const [],
      defenderParty: const [],
      winner: (j['winner'] as String?) ?? 'draw',
      events: ((result['events'] as List?) ?? const []).map((e) => BattleEvent.fromJson(e as Map)).toList(),
      vp: ((rewards['vp'] as num?) ?? 0).toInt(),
      expPerMonster: ((rewards['expPerMonster'] as num?) ?? 0).toInt(),
      createdAt: DateTime.now(),
    );
  }
}

class FriendEntry {
  FriendEntry({required this.uid, required this.displayName, required this.blocked, required this.addedAt});
  final String uid;
  final String? displayName;
  final bool blocked;
  final DateTime? addedAt;

  String get label => displayName ?? 'なまえなし';

  factory FriendEntry.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return FriendEntry(
      uid: doc.id,
      displayName: d['displayName'] as String?,
      blocked: (d['blocked'] as bool?) ?? false,
      addedAt: (d['addedAt'] as Timestamp?)?.toDate(),
    );
  }
}
