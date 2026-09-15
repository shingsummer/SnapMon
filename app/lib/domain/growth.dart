// 成長式（企画書 v1.3 §4.3〜§4.5, §5.3）。
// サーバー側（functions/src/shared/growth.ts）が正。クライアントは表示用の予測にのみ使う。
// tools/growth_ref.py と同一入力で同一出力になることを test/growth_golden_test.dart で保証する。
// 純 Dart（Flutter 非依存）。
import 'rng.dart';

const List<String> kStats = ['hp', 'atk', 'def', 'spa', 'spd', 'luk'];

/// shared-config の constants.json / personalities.json / growth_curves.json を束ねたもの。
/// アプリ層が assets から読んで組み立てる。
class GameConfig {
  GameConfig({
    required this.constants,
    required this.personalities,
    required this.curves,
  });

  final Map<String, dynamic> constants;
  final List<dynamic> personalities;
  final Map<String, dynamic> curves;

  int get levelCap => constants['levelCap'] as int;
  List<String> get growthTypeOrder => (constants['growthTypeOrder'] as List).cast<String>();

  num _n(String key) => constants[key] as num;
  List<num> _range(String key) => (constants[key] as List).cast<num>();
}

class Individual {
  Individual({
    required this.base,
    required this.talent,
    required this.growth,
    required this.personality,
    required this.murmurRate,
    required this.murmurWindowOffset,
  });

  final Map<String, int> base;

  /// 隠し値。本番クライアントはこれを受け取らない（表示用シミュレーションのみ）。
  final Map<String, int> talent;
  final String growth;
  final int personality;
  final double murmurRate;
  final int murmurWindowOffset;
}

int talentFromRaw(GameConfig cfg, int rawBase, int rawTalent) {
  final v = rawTalent * 0.6 + (65 - rawBase) / 60 * 10 * 0.4;
  final r = cfg._range('talentRange');
  return floorHalfUp(v).clamp(r[0].toInt(), r[1].toInt());
}

int statCap(GameConfig cfg, int talent) =>
    cfg._n('statCapBase').toInt() + talent * cfg._n('statCapPerTalent').toInt();

double curve(GameConfig cfg, String growth, int level) {
  final table = (cfg.curves[growth] as List).cast<num>();
  return table[level - 1].toDouble();
}

String rollGrowth(GameConfig cfg, int bst0, double u) {
  List<num>? weights;
  for (final row in cfg.constants['growthTypeWeights'] as List) {
    if (bst0 >= (row['minBst0'] as num)) {
      weights = (row['weights'] as List).cast<num>();
      break;
    }
  }
  if (weights == null) throw StateError('growthTypeWeights has no matching row');
  final order = cfg.growthTypeOrder;
  var cum = 0.0;
  for (var i = 0; i < order.length; i++) {
    cum += weights[i];
    if (u < cum) return order[i];
  }
  return order.last;
}

Individual rollIndividual(GameConfig cfg, XorShift128 rng,
    {Map<String, int>? mentorTalent, bool useCapsule = false}) {
  final baseR = cfg._range('baseStatRange');
  final talR = cfg._range('talentRange');
  final base = <String, int>{};
  final talent = <String, int>{};
  for (final s in kStats) {
    final rb = rng.randInt(baseR[0].toInt(), baseR[1].toInt());
    final rt = rng.randInt(talR[0].toInt(), talR[1].toInt());
    base[s] = rb;
    talent[s] = talentFromRaw(cfg, rb, rt);
  }
  if (mentorTalent != null) {
    final rate = (useCapsule ? cfg._n('mentorInheritRateCapsule') : cfg._n('mentorInheritRate')).toDouble();
    for (final s in kStats) {
      final t = talent[s]! + floorHalfUp(mentorTalent[s]! * rate);
      talent[s] = t < talR[1].toInt() ? t : talR[1].toInt();
    }
  }
  final bst0 = kStats.fold<int>(0, (a, s) => a + base[s]!);
  final growth = rollGrowth(cfg, bst0, rng.nextDouble());
  final personality = rng.randInt(0, cfg.personalities.length - 1);
  final mr = cfg._range('murmurRateRange');
  final murmurRate = rng.randRange(mr[0].toDouble(), mr[1].toDouble());
  final j = cfg._n('murmurWindowJitterLevels').toInt();
  final murmurWindowOffset = rng.randInt(-j, j);
  return Individual(
    base: base,
    talent: talent,
    growth: growth,
    personality: personality,
    murmurRate: murmurRate,
    murmurWindowOffset: murmurWindowOffset,
  );
}

/// level → level+1 のレベルアップ後ステータス。
Map<String, double> levelUp(GameConfig cfg, Map<String, double> stats, Map<String, int> talent,
    String growth, int level, int personality, XorShift128 rng) {
  final mods = (cfg.personalities[personality]['levelGainMod'] as Map).cast<String, num>();
  final rr = cfg._range('levelGainRandRange');
  final gainBase = cfg._n('levelGainBase').toDouble();
  final gainPerTalent = cfg._n('levelGainPerTalent').toDouble();
  final out = <String, double>{};
  for (final s in kStats) {
    final r = rng.randRange(rr[0].toDouble(), rr[1].toDouble());
    final gain = (gainBase + gainPerTalent * talent[s]!) * curve(cfg, growth, level) * mods[s]!.toDouble() * r;
    final cap = statCap(cfg, talent[s]!).toDouble();
    final v = stats[s]! + gain;
    out[s] = v < cap ? v : cap;
  }
  return out;
}

double trainingMod(GameConfig cfg, int personality, String type) {
  final p = cfg.personalities[personality] as Map;
  final b = cfg._n('personalityTrainingBonus').toDouble();
  if (p['likes'] == type) return 1.0 + b;
  if (p['dislikes'] == type) return 1.0 - b;
  return 1.0;
}

class TrainResult {
  TrainResult(this.stats, this.fatigue);
  final Map<String, double> stats;
  final int fatigue;
}

TrainResult train(GameConfig cfg, Map<String, double> stats, Map<String, int> talent, int personality,
    String type, int fatigue, XorShift128 rng) {
  final t = (cfg.constants['trainings'] as Map)[type] as Map;
  final main = t['main'] as String;
  final sub = t['sub'] as String?;
  final gr = cfg._range('trainingGainRange');
  final mainGain = (rng.randRange(gr[0].toDouble(), gr[1].toDouble()) +
          cfg._n('trainingGainPerTalent').toDouble() * talent[main]!) *
      trainingMod(cfg, personality, type);
  final out = Map<String, double>.from(stats);
  final capMain = statCap(cfg, talent[main]!).toDouble();
  final vm = stats[main]! + mainGain;
  out[main] = vm < capMain ? vm : capMain;
  if (sub != null) {
    final capSub = statCap(cfg, talent[sub]!).toDouble();
    final vs = stats[sub]! + mainGain * cfg._n('trainingSubRatio').toDouble();
    out[sub] = vs < capSub ? vs : capSub;
  }
  return TrainResult(out, fatigue + (t['fatigue'] as num).toInt());
}

int expToNext(GameConfig cfg, int level) =>
    cfg._n('expBase').toInt() + cfg._n('expPerLevel').toInt() * level;

class ExpResult {
  ExpResult(this.level, this.exp, this.levelUps);
  final int level;
  final int exp;
  final int levelUps;
}

ExpResult applyExp(GameConfig cfg, int level, int exp, int gained) {
  final cap = cfg.levelCap;
  if (level >= cap) return ExpResult(cap, 0, 0);
  var levelUps = 0;
  exp += gained;
  while (level < cap && exp >= expToNext(cfg, level)) {
    exp -= expToNext(cfg, level);
    level += 1;
    levelUps += 1;
  }
  if (level >= cap) exp = 0;
  return ExpResult(level, exp, levelUps);
}
