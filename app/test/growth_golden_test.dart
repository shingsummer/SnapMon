// ゴールデンテスト: tools/growth_ref.py（参照実装）が生成した fixtures と一致すること。
// 実行: cd app && flutter test
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/domain/growth.dart';
import 'package:snapmon/domain/rng.dart';

const double eps = 1e-9;

Map<String, dynamic> _readJson(String rel) {
  // flutter test は app/ をカレントにして走る
  final f = File('../shared-config/$rel');
  return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
}

List<dynamic> _readJsonList(String rel) =>
    jsonDecode(File('../shared-config/$rel').readAsStringSync()) as List<dynamic>;

List<double> _arr(Map<dynamic, dynamic> m) => kStats.map((s) => (m[s] as num).toDouble()).toList();

Map<String, int> _intMap(Map<dynamic, dynamic> m) => m.map((k, v) => MapEntry(k as String, (v as num).toInt()));

void main() {
  final cfg = GameConfig(
    constants: _readJson('constants.json'),
    personalities: _readJsonList('personalities.json'),
    curves: _readJson('growth_curves.json'),
  );
  final fx = _readJson('fixtures/growth_golden.json');

  test('seedFromParts matches sha256 prefix', () {
    for (final c in fx['seeds'] as List) {
      expect(seedFromParts(c['label'], c['colorHex'], c['userId'], c['date'], c['nonce']), c['seedHex']);
    }
  });

  test('XorShift128 raw values', () {
    for (final c in fx['rng'] as List) {
      var r = XorShift128(c['seedHex']);
      for (final u in c['u32'] as List) {
        expect(r.nextU32(), u);
      }
      r = XorShift128(c['seedHex']);
      for (final d in c['doubles'] as List) {
        expect(r.nextDouble(), closeTo(d as num, eps));
      }
      r = XorShift128(c['seedHex']);
      for (final ri in c['randInt'] as List) {
        expect(r.randInt(ri['lo'], ri['hi']), ri['value']);
      }
      r = XorShift128(c['seedHex']);
      for (final rr in c['randRange'] as List) {
        expect(r.randRange((rr['lo'] as num).toDouble(), (rr['hi'] as num).toDouble()), closeTo(rr['value'] as num, eps));
      }
    }
  });

  test('talentFromRaw all combinations and statCap', () {
    for (final c in fx['talent'] as List) {
      expect(talentFromRaw(cfg, c['rawBase'], c['rawTalent']), c['talent']);
    }
    for (final c in fx['statCap'] as List) {
      expect(statCap(cfg, c['talent']), c['cap']);
    }
  });

  test('rollGrowth boundaries', () {
    for (final c in fx['growthRoll'] as List) {
      expect(rollGrowth(cfg, c['bst0'], (c['u'] as num).toDouble()), c['growth']);
    }
  });

  test('rollIndividual with and without mentor', () {
    for (final c in fx['individuals'] as List) {
      final mentor = c['mentorTalent'] == null ? null : _intMap(c['mentorTalent'] as Map);
      final ind = rollIndividual(cfg, XorShift128(c['seedHex']), mentorTalent: mentor, useCapsule: c['useCapsule'] as bool);
      final e = c['expected'] as Map;
      expect(ind.base, _intMap(e['base'] as Map));
      expect(ind.talent, _intMap(e['talent'] as Map));
      expect(ind.growth, e['growth']);
      expect(ind.personality, e['personality']);
      expect(ind.murmurRate, closeTo(e['murmurRate'] as num, eps));
      expect(ind.murmurWindowOffset, e['murmurWindowOffset']);
    }
  });

  test('levelUp Lv1->50 full history', () {
    for (final c in fx['levelUps'] as List) {
      final rng = XorShift128(c['seedHex']);
      final ind = rollIndividual(cfg, rng);
      var stats = ind.base.map((k, v) => MapEntry(k, v.toDouble()));
      final hist = c['statsByLevel'] as List;
      for (var L = 1; L < cfg.levelCap; L++) {
        stats = levelUp(cfg, stats, ind.talent, ind.growth, L, ind.personality, rng);
        final expected = (hist[L - 1] as List).cast<num>();
        final actual = _arr(stats);
        for (var i = 0; i < kStats.length; i++) {
          expect(actual[i], closeTo(expected[i], eps), reason: 'seed ${c['seedHex']} L$L ${kStats[i]}');
        }
      }
    }
  });

  test('train incl. cap clamp', () {
    for (final c in fx['training'] as List) {
      final rng = XorShift128(c['seedHex']);
      final ind = rollIndividual(cfg, rng);
      final before = (c['statsBefore'] as Map).map((k, v) => MapEntry(k as String, (v as num).toDouble()));
      final res = train(cfg, before, ind.talent, ind.personality, c['type'], c['fatigueBefore'], rng);
      final expected = _arr((c['expected'] as Map)['stats'] as Map);
      final actual = _arr(res.stats);
      for (var i = 0; i < kStats.length; i++) {
        expect(actual[i], closeTo(expected[i], eps));
      }
      expect(res.fatigue, (c['expected'] as Map)['fatigue']);
    }
  });

  test('exp table and applyExp', () {
    for (final c in fx['expToNext'] as List) {
      expect(expToNext(cfg, c['level']), c['exp']);
    }
    for (final c in fx['exp'] as List) {
      final r = applyExp(cfg, c['level'], c['exp'], c['gained']);
      final e = c['expected'] as Map;
      expect([r.level, r.exp, r.levelUps], [e['level'], e['exp'], e['levelUps']]);
    }
  });
}
