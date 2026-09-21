// アイドルアニメの動きが「小さく、周期的で、性格未公開なら共通」であること。
import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/features/monster/idle_motion.dart';

void main() {
  test('unrevealed personality always uses the neutral motion', () {
    for (var p = 0; p < IdleMotion.byPersonality.length; p++) {
      expect(IdleMotion.forMonster(personality: p, revealed: false), same(IdleMotion.neutral));
    }
    expect(IdleMotion.forMonster(personality: 99, revealed: true), same(IdleMotion.neutral));
    expect(IdleMotion.forMonster(personality: 2, revealed: true), same(IdleMotion.byPersonality[2]));
  });

  test('poses stay within small bounds for every personality and phase', () {
    final motions = [IdleMotion.neutral, ...IdleMotion.byPersonality];
    for (final m in motions) {
      for (var cycle = 0; cycle < 4; cycle++) {
        for (var i = 0; i <= 100; i++) {
          final pose = IdlePose.at(m, i / 100, cycle);
          expect(pose.scaleX, inInclusiveRange(0.9, 1.1));
          expect(pose.scaleY, inInclusiveRange(0.9, 1.1));
          expect(pose.dx.abs(), lessThanOrEqualTo(0.02));
          expect(pose.dy, inInclusiveRange(-0.15, 0.05)); // 上には跳ねる、下にはほぼ沈まない
          expect(pose.angle.abs(), lessThanOrEqualTo(0.1));
        }
      }
    }
  });

  test('a cycle starts and ends at rest (no visible jump when looping)', () {
    for (final m in [IdleMotion.neutral, ...IdleMotion.byPersonality]) {
      final start = IdlePose.at(m, 0, 1);
      final end = IdlePose.at(m, 1, 1);
      expect((start.scaleY - end.scaleY).abs(), lessThan(1e-9));
      expect((start.dy - end.dy).abs(), lessThan(1e-9));
      expect((start.angle - end.angle).abs(), lessThan(1e-6));
    }
  });

  test('やんちゃ hops on every other cycle only', () {
    final m = IdleMotion.byPersonality[2];
    expect(IdlePose.at(m, 0.2, 0).dy, lessThan(-0.05));
    expect(IdlePose.at(m, 0.2, 1).dy, greaterThan(-0.01));
  });

  test('tap reaction is a one-shot that returns to rest', () {
    expect(reactPose(0).scaleX, 1);
    expect(reactPose(1).scaleX, 1);
    expect(reactPose(0.12).scaleX, isNot(1));
    expect(reactPose(0.5).dy, lessThan(0));
  });
}
