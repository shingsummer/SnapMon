// モンスターのアイドルアニメ（P6、しぴさん要望「本当に生きてるみたいに動く」の第一歩）。
// 絵は 1 枚のまま、呼吸（縦の伸び縮み）・上下の揺れ・左右の傾き・跳ねを性格ごとに変える。
// 性格が公開される前（トレーニング 3 回未満）は共通の「呼吸」だけにして、動きから性格が分からないようにする。
// 純 Dart（Flutter 非依存）。idle_motion_test.dart で検証。
import 'dart:math' as math;

/// 動きのパラメータ。振幅は絵の大きさに対する割合、角度はラジアン。
class IdleMotion {
  const IdleMotion({
    required this.periodMs,
    this.breathe = 0.02,
    this.bob = 0.0,
    this.sway = 0.0,
    this.hop = 0.0,
    this.hopEvery = 1,
    this.shiver = 0.0,
  });

  /// 1 周期（ミリ秒）
  final int periodMs;

  /// 呼吸: 縦方向の拡大率の振幅（0.02 = ±2%）。横は半分だけ逆に縮めて体積感を出す
  final double breathe;

  /// 上下の揺れ: 絵の高さに対する割合
  final double bob;

  /// 左右の傾き: ラジアン
  final double sway;

  /// 跳ね: 絵の高さに対する割合。周期の一部だけ放物線で跳ぶ
  final double hop;

  /// 跳ねる頻度: n 周期に 1 回
  final int hopEvery;

  /// 小刻みな震え: 横方向、絵の幅に対する割合
  final double shiver;

  /// 性格未公開のときの共通の動き
  static const IdleMotion neutral = IdleMotion(periodMs: 2600, breathe: 0.02);

  /// 性格ごとの動き（personalities.json の id 順: 0 のんき 1 まじめ 2 やんちゃ 3 おくびょう 4 ねぼう 5 がんばりや 6 きまぐれ 7 おっとり）
  static const List<IdleMotion> byPersonality = [
    IdleMotion(periodMs: 3400, breathe: 0.025, sway: 0.03), // のんき: ゆっくり呼吸、少し揺れる
    IdleMotion(periodMs: 2000, breathe: 0.012), // まじめ: 小さく規則正しい呼吸だけ
    IdleMotion(periodMs: 1500, breathe: 0.02, hop: 0.10, hopEvery: 2), // やんちゃ: 時々ぴょんと跳ねる
    IdleMotion(periodMs: 2200, breathe: 0.015, shiver: 0.006, bob: -0.01), // おくびょう: 少し縮こまって小刻みに震える
    IdleMotion(periodMs: 4200, breathe: 0.035, sway: 0.02, bob: 0.01), // ねぼう: 深くゆっくり、こっくり
    IdleMotion(periodMs: 900, breathe: 0.02, bob: 0.03), // がんばりや: 小刻みに弾む
    IdleMotion(periodMs: 2800, breathe: 0.02, sway: 0.07), // きまぐれ: 大きく左右に傾く
    IdleMotion(periodMs: 3600, breathe: 0.022, sway: 0.015), // おっとり: 静かに呼吸、わずかに揺れる
  ];

  static IdleMotion forMonster({required int personality, required bool revealed}) {
    if (!revealed || personality < 0 || personality >= byPersonality.length) return neutral;
    return byPersonality[personality];
  }
}

/// 時刻 t（周期を 0..1 に正規化）と周期番号 cycle から、絵に掛ける変形を返す。
class IdlePose {
  const IdlePose({this.scaleX = 1, this.scaleY = 1, this.dx = 0, this.dy = 0, this.angle = 0});

  final double scaleX;
  final double scaleY;

  /// 絵の幅に対する割合
  final double dx;

  /// 絵の高さに対する割合（負が上）
  final double dy;
  final double angle;

  static IdlePose at(IdleMotion m, double t, int cycle) {
    final phase = 2 * math.pi * t;
    final s = math.sin(phase);
    final scaleY = 1 + m.breathe * s;
    final scaleX = 1 - m.breathe * 0.5 * s;
    var dy = m.bob * (0.5 - 0.5 * math.cos(phase)); // 0..bob
    // 跳ね: 周期の前半 40% で放物線
    if (m.hop > 0 && cycle % m.hopEvery == 0 && t < 0.4) {
      final u = t / 0.4; // 0..1
      dy -= m.hop * 4 * u * (1 - u);
    }
    final angle = m.sway * math.sin(phase * 0.5 + 0.3) * math.sin(phase);
    final dx = m.shiver == 0 ? 0.0 : m.shiver * math.sin(phase * 9);
    return IdlePose(scaleX: scaleX, scaleY: scaleY, dx: dx, dy: dy, angle: angle);
  }
}

/// タップしたときの反応（なでる）。0..1 で一度だけ再生。ぷるんと弾んで戻る。
IdlePose reactPose(double t) {
  if (t <= 0 || t >= 1) return const IdlePose();
  final damp = (1 - t);
  final wob = math.sin(t * math.pi * 4) * damp;
  return IdlePose(scaleX: 1 + 0.08 * wob, scaleY: 1 - 0.08 * wob, dy: -0.06 * math.sin(t * math.pi) * damp, angle: 0.05 * wob);
}
