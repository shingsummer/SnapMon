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

/// トレーニング種別（shared-config/constants.json の trainings と対応）
const trainingJa = <String, ({String name, String main, String sub, String fatigue})>{
  'dash': (name: 'ダッシュ', main: 'spd', sub: 'atk', fatigue: '中'),
  'labor': (name: '力仕事', main: 'atk', sub: 'hp', fatigue: '高'),
  'meditate': (name: '瞑想', main: 'spa', sub: 'luk', fatigue: '低'),
  'endure': (name: '耐久', main: 'def', sub: 'hp', fatigue: '高'),
};

Map<String, int> _intStats(Map<dynamic, dynamic>? m) =>
    {for (final s in statOrder) s: ((m?[s] as num?) ?? 0).round()};

/// 端末側で適用する個体差（企画書 §3.6）
class ArtTint {
  const ArtTint({required this.hueShift, required this.satShift});
  final int hueShift; // 度（±8）
  final double satShift; // ±0.1
  static const none = ArtTint(hueShift: 0, satShift: 0);
}

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
    required this.artTint,
    required this.status,
    required this.fatigue,
    required this.personality,
    required this.personalityRevealed,
    required this.trainingCount,
    required this.inheritedMoveId,
    required this.mentorId,
    required this.lastMurmurTextId,
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
  final ArtTint artTint;
  final String status;
  final int fatigue;
  final int personality;
  final bool personalityRevealed;
  final int trainingCount;
  final String? inheritedMoveId;
  final String? mentorId;
  final String? lastMurmurTextId;
  final DateTime? createdAt;

  bool get isNamed => name.isNotEmpty;
  String get displayName => isNamed ? name : '${familyJa[family] ?? family}のこ';
  String get familyLabel =>
      subFamily == null ? (familyJa[family] ?? family) : '${familyJa[family] ?? family}／${familyJa[subFamily] ?? subFamily}';
  String get elementLabel => elementJa[element] ?? element;
  int get total => stats.values.fold(0, (a, b) => a + b);
  bool get isStored => status == 'stored';

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
      artTint: d['artTint'] is Map
          ? ArtTint(
              hueShift: (((d['artTint'] as Map)['hueShift'] as num?) ?? 0).toInt(),
              satShift: (((d['artTint'] as Map)['satShift'] as num?) ?? 0).toDouble(),
            )
          : ArtTint.none,
      status: (d['status'] as String?) ?? 'active',
      fatigue: ((d['fatigue'] as num?) ?? 0).toInt(),
      personality: ((d['personality'] as num?) ?? 0).toInt(),
      personalityRevealed: (d['personalityRevealed'] as bool?) ?? false,
      trainingCount: ((d['trainingCount'] as num?) ?? 0).toInt(),
      inheritedMoveId: (d['inheritedMove'] as Map?)?['moveId'] as String?,
      mentorId: d['mentorId'] as String?,
      lastMurmurTextId: d['lastMurmurTextId'] as String?,
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

  String get label => itemLabel(type);
}

String itemLabel(String type) {
  if (type.startsWith('food_')) return '${familyJa[type.substring(5)] ?? type}のエサ';
  if (type == 'fatigue_cure') return '疲労回復薬';
  if (type == 'bond_capsule') return '絆カプセル';
  return type;
}

/// submitSteps の戻り値
class SubmitStepsResult {
  SubmitStepsResult({
    required this.acceptedSteps,
    required this.stepsToday,
    required this.vpGained,
    required this.vpBalance,
    required this.walkBonusApplied,
    required this.partnerMonsterId,
    required this.partnerExp,
    required this.partnerLevelUps,
    required this.murmurTextId,
  });

  final int acceptedSteps;
  final int stepsToday;
  final int vpGained;
  final int vpBalance;
  final bool walkBonusApplied;
  final String? partnerMonsterId;
  final int partnerExp;
  final int partnerLevelUps;
  final String? murmurTextId;

  factory SubmitStepsResult.fromJson(Map<dynamic, dynamic> j) {
    final p = j['partner'] as Map?;
    return SubmitStepsResult(
      acceptedSteps: (j['acceptedSteps'] as num).toInt(),
      stepsToday: (j['stepsToday'] as num).toInt(),
      vpGained: (j['vpGained'] as num).toInt(),
      vpBalance: (j['vpBalance'] as num).toInt(),
      walkBonusApplied: (j['walkBonusApplied'] as bool?) ?? false,
      partnerMonsterId: p?['monsterId'] as String?,
      partnerExp: ((p?['exp'] as num?) ?? 0).toInt(),
      partnerLevelUps: ((p?['levelUps'] as num?) ?? 0).toInt(),
      murmurTextId: j['murmurTextId'] as String?,
    );
  }
}

/// train の戻り値
class TrainResult {
  TrainResult({
    required this.trained,
    required this.message,
    required this.statsDelta,
    required this.fatigue,
    required this.level,
    required this.levelUps,
    required this.vpBalance,
    required this.trainingsToday,
    required this.personalityRevealed,
    required this.murmurTextId,
  });

  final bool trained;
  final String? message;
  final Map<String, int> statsDelta;
  final int fatigue;
  final int level;
  final int levelUps;
  final int vpBalance;
  final int trainingsToday;
  final bool personalityRevealed;
  final String? murmurTextId;

  factory TrainResult.fromJson(Map<dynamic, dynamic> j) => TrainResult(
        trained: (j['trained'] as bool?) ?? false,
        message: j['message'] as String?,
        statsDelta: {for (final s in statOrder) s: ((j['statsDelta']?[s] as num?) ?? 0).round()},
        fatigue: (j['fatigue'] as num).toInt(),
        level: (j['level'] as num).toInt(),
        levelUps: ((j['levelUps'] as num?) ?? 0).toInt(),
        vpBalance: (j['vpBalance'] as num).toInt(),
        trainingsToday: (j['trainingsToday'] as num).toInt(),
        personalityRevealed: (j['personalityRevealed'] as bool?) ?? false,
        murmurTextId: j['murmurTextId'] as String?,
      );
}

class UseItemResult {
  UseItemResult({required this.itemType, required this.remaining, required this.levelUps, required this.fatigue});
  final String itemType;
  final int remaining;
  final int levelUps;
  final int fatigue;

  factory UseItemResult.fromJson(Map<dynamic, dynamic> j) => UseItemResult(
        itemType: j['itemType'] as String,
        remaining: (j['remaining'] as num).toInt(),
        levelUps: ((j['levelUps'] as num?) ?? 0).toInt(),
        fatigue: ((j['fatigue'] as num?) ?? 0).toInt(),
      );
}
