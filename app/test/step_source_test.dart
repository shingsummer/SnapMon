import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/features/steps/fake_step_source.dart';
import 'package:snapmon/features/steps/step_source.dart';

void main() {
  final t0 = DateTime.utc(2026, 9, 18, 3, 0);

  test('bucketize splits a long record across 5-minute buckets proportionally', () {
    final segs = bucketize([(from: t0, to: t0.add(const Duration(minutes: 15)), steps: 300)]);
    expect(segs.length, 3);
    expect(segs.map((s) => s.steps).toList(), [100, 100, 100]);
    expect(segs.first.startAt, t0);
    expect(segs.last.endAt, t0.add(const Duration(minutes: 15)));
    expect(segs.first.activity, StepActivity.unknown);
  });

  test('bucketize aligns to bucket boundaries and merges overlapping records', () {
    final segs = bucketize([
      (from: t0.add(const Duration(minutes: 2)), to: t0.add(const Duration(minutes: 7)), steps: 100), // 2..7 → 3/5 in bucket0, 2/5 in bucket1
      (from: t0.add(const Duration(minutes: 5)), to: t0.add(const Duration(minutes: 10)), steps: 50),
    ]);
    expect(segs.length, 2);
    expect(segs[0].steps + segs[1].steps, 150);
    expect(segs[0].steps, 60);
    expect(segs[1].steps, 90);
  });

  test('bucketize ignores empty or inverted records', () {
    expect(bucketize([(from: t0, to: t0, steps: 10), (from: t0, to: t0.subtract(const Duration(minutes: 1)), steps: 10)]), isEmpty);
  });

  test('FakeStepSource returns contiguous walking segments after since', () async {
    final src = FakeStepSource(minutes: 40, stepsPerBucket: 450);
    final until = t0.add(const Duration(hours: 1));
    final all = await src.fetchSegments(DateTime.utc(2000), until);
    expect(all.length, 8);
    for (var i = 1; i < all.length; i++) {
      expect(all[i].startAt, all[i - 1].endAt);
    }
    final later = await src.fetchSegments(until.subtract(const Duration(minutes: 12)), until);
    expect(later.length, 2);
    expect(later.every((s) => s.activity == StepActivity.walking), isTrue);
  });
}
