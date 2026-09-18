import 'step_source.dart';

/// 疑似歩数（`--dart-define=FAKE_STEPS=true`）。エミュレータには歩数センサーが無いため。
/// 「直近 40 分、5 分ごとに 400〜500 歩の歩行」を返す。30 分連続ボーナスの検証もできる。
class FakeStepSource implements StepSource {
  FakeStepSource({this.minutes = 40, this.stepsPerBucket = 450});

  final int minutes;
  final int stepsPerBucket;

  @override
  Future<bool> requestPermission() async => true;

  @override
  Future<List<StepSegment>> fetchSegments(DateTime since, DateTime until) async {
    final end = DateTime.fromMillisecondsSinceEpoch(
      (until.millisecondsSinceEpoch ~/ stepBucket.inMilliseconds) * stepBucket.inMilliseconds,
      isUtc: true,
    );
    final out = <StepSegment>[];
    for (var i = minutes ~/ 5; i >= 1; i--) {
      final start = end.subtract(stepBucket * i);
      if (!start.isAfter(since)) continue;
      out.add(StepSegment(
        startAt: start,
        endAt: start.add(stepBucket),
        steps: stepsPerBucket + (i * 17) % 60,
        activity: StepActivity.walking,
      ));
    }
    return out;
  }
}
