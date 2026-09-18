import 'package:cloud_firestore/cloud_firestore.dart';

const familyJa = <String, String>{
  'beast': 'ビースト',
  'plant': 'プラント',
  'metal': 'メタル',
  'aqua': 'アクア',
  'rock': 'ロック',
  'spark': 'スパーク',
  'ghost': 'ゴースト',
  'food': 'フード',
  'paper': 'ペーパー',
  'cloth': 'クロス',
  'toy': 'トイ',
  'enigma': 'エニグマ',
};

const elementJa = <String, String>{
  'fire': '火',
  'water': '水',
  'grass': '草',
  'thunder': '雷',
  'light': '光',
  'dark': '闇',
  'neutral': '無',
};

const statOrder = ['hp', 'atk', 'def', 'spa', 'spd', 'luk'];
const statJa = <String, String>{'hp': '体力', 'atk': '攻撃', 'def': '防御', 'spa': '特攻', 'spd': '速さ', 'luk': '運'};

Map<String, int> _intStats(Map<dynamic, dynamic>? m) =>
    {for (final s in statOrder) s: ((m?[s] as num?) ?? 0).round()};

class StatSnapshot {
  StatSnapshot(this.level, this.stats);
  final int level;
  final Map<String, int> stats;
  int get total => stats.values.fold(0, (a, b) => a + b);
}

/// monsters/{id} の公開部分。隠し値（素質・成長タイプ）はサーバーが返さないので存在しない。
class Monster {
  Monster({
    required this.id,
    required this.name,
    required this.family,
    required this.subFamily,
    required this.element,
    required this.sourceLabel,
    required this.level,
    required this.exp,
    required this.stats,
    required this.base,
    required this.statHistory,
    required this.moves,
    required this.artBucketId,
    required this.status,
    required this.fatigue,
    required this.personalityRevealed,
    required this.inheritedMoveId,
    required this.mentorId,
    required this.createdAt,
  });

  final String id;
  final String name;
  final String family;
  final String? subFamily;
  final String element;
  final String sourceLabel;
  final int level;
  final int exp;
  final Map<String, int> stats;
  final Map<String, int> base;
  final List<StatSnapshot> statHistory;
  final List<String> moves;
  final String artBucketId;
  final String status;
  final int fatigue;
  final bool personalityRevealed;
  final String? inheritedMoveId;
  final String? mentorId;
  final DateTime? createdAt;

  bool get isNamed => name.isNotEmpty;
  String get displayName => isNamed ? name : '${familyJa[family] ?? family}のこ';
  String get familyLabel =>
      subFamily == null ? (familyJa[family] ?? family) : '${familyJa[family] ?? family}／${familyJa[subFamily] ?? subFamily}';
  String get elementLabel => elementJa[element] ?? element;
  int get total => stats.values.fold(0, (a, b) => a + b);

  /// P3 のアートバケットが ready になるまでのプレースホルダ（tools/gen_placeholder_art.py）
  String get placeholderAsset => 'assets/art/placeholder/${family}_$element.svg';

  factory Monster.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final hist = (d['statHistory'] as List?)
            ?.map((e) => StatSnapshot(((e as Map)['level'] as num).toInt(), _intStats(e['stats'] as Map?)))
            .toList() ??
        const <StatSnapshot>[];
    return Monster(
      id: doc.id,
      name: (d['name'] as String?) ?? '',
      family: (d['family'] as String?) ?? 'enigma',
      subFamily: d['subFamily'] as String?,
      element: (d['element'] as String?) ?? 'neutral',
      sourceLabel: (d['sourceLabel'] as String?) ?? '',
      level: ((d['level'] as num?) ?? 1).toInt(),
      exp: ((d['exp'] as num?) ?? 0).toInt(),
      stats: _intStats(d['stats'] as Map?),
      base: _intStats(d['base'] as Map?),
      statHistory: hist,
      moves: ((d['moves'] as List?) ?? const []).cast<String>(),
      artBucketId: (d['artBucketId'] as String?) ?? '',
      status: (d['status'] as String?) ?? 'active',
      fatigue: ((d['fatigue'] as num?) ?? 0).toInt(),
      personalityRevealed: (d['personalityRevealed'] as bool?) ?? false,
      inheritedMoveId: (d['inheritedMove'] as Map?)?['moveId'] as String?,
      mentorId: d['mentorId'] as String?,
      createdAt: (d['createdAt'] as Timestamp?)?.toDate(),
    );
  }
}

/// generateMonster の戻り値（企画書 §11）
class GenerateResult {
  GenerateResult({
    required this.monsterId,
    required this.family,
    required this.subFamily,
    required this.element,
    required this.sourceLabel,
    required this.base,
    required this.items,
    required this.snapsUsed,
    required this.snapsPerDay,
    required this.mentorId,
  });

  final String monsterId;
  final String family;
  final String? subFamily;
  final String element;
  final String sourceLabel;
  final Map<String, int> base;
  final List<ItemGrant> items;
  final int snapsUsed;
  final int snapsPerDay;
  final String? mentorId;

  factory GenerateResult.fromJson(Map<dynamic, dynamic> j) => GenerateResult(
        monsterId: j['monsterId'] as String,
        family: j['family'] as String,
        subFamily: j['subFamily'] as String?,
        element: j['element'] as String,
        sourceLabel: (j['sourceLabel'] as String?) ?? '',
        base: _intStats(j['base'] as Map?),
        items: ((j['items'] as List?) ?? const [])
            .map((e) => ItemGrant((e as Map)['type'] as String, (e['count'] as num).toInt()))
            .toList(),
        snapsUsed: (j['snapsUsed'] as num).toInt(),
        snapsPerDay: (j['snapsPerDay'] as num).toInt(),
        mentorId: j['mentorId'] as String?,
      );
}

class ItemGrant {
  ItemGrant(this.type, this.count);
  final String type;
  final int count;

  String get label {
    if (type.startsWith('food_')) return '${familyJa[type.substring(5)] ?? type}のエサ';
    return type;
  }
}
