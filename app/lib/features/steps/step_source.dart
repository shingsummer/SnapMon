/// 歩数の取得元の抽象（企画書 §5.2）。
/// 本番は Health Connect（Android）／ CMPedometer（iOS）。エミュレータ・テストは疑似歩数。
library;

enum StepActivity { walking, running, cycling, automotive, stationary, unknown }

class StepSegment {
  const StepSegment({required this.startAt, required this.endAt, required this.steps, required this.activity});

  final DateTime startAt;
  final DateTime endAt;
  final int steps;
  final StepActivity activity;

  Map<String, dynamic> toJson() => {
        'startAt': startAt.millisecondsSinceEpoch,
        'endAt': endAt.millisecondsSinceEpoch,
        'steps': steps,
        'activity': activity.name,
      };
}

abstract class StepSource {
  /// 権限を求める。false なら取得できない（UI で案内する）
  Future<bool> requestPermission();

  /// [since] 以降 [until] までの歩数を 5 分区間に分けて返す。
  /// サーバー側で lastStepSyncAt より前の区間は「同期済み」として弾かれるので、多少重なってもよい。
  Future<List<StepSegment>> fetchSegments(DateTime since, DateTime until);
}

const stepBucket = Duration(minutes: 5);

/// 任意の期間の歩数を 5 分バケットに按分する（Health Connect のレコードは長さがまちまちなため）。
/// 純 Dart。テスト対象。
List<StepSegment> bucketize(List<({DateTime from, DateTime to, int steps})> records, {StepActivity activity = StepActivity.unknown}) {
  final acc = <int, double>{}; // bucketStartMs -> steps
  for (final r in records) {
    final total = r.to.difference(r.from).inMilliseconds;
    if (total <= 0 || r.steps <= 0) continue;
    var cursor = r.from;
    while (cursor.isBefore(r.to)) {
      final bucketStart = DateTime.fromMillisecondsSinceEpoch(
        (cursor.millisecondsSinceEpoch ~/ stepBucket.inMilliseconds) * stepBucket.inMilliseconds,
        isUtc: true,
      );
      final bucketEnd = bucketStart.add(stepBucket);
      final sliceEnd = r.to.isBefore(bucketEnd) ? r.to : bucketEnd;
      final part = sliceEnd.difference(cursor).inMilliseconds / total;
      acc[bucketStart.millisecondsSinceEpoch] = (acc[bucketStart.millisecondsSinceEpoch] ?? 0) + r.steps * part;
      cursor = sliceEnd;
    }
  }
  final keys = acc.keys.toList()..sort();
  final out = <StepSegment>[];
  var carry = 0.0;
  for (final k in keys) {
    final v = acc[k]! + carry;
    final n = v.floor();
    carry = v - n;
    if (n <= 0) continue;
    final start = DateTime.fromMillisecondsSinceEpoch(k, isUtc: true);
    out.add(StepSegment(startAt: start, endAt: start.add(stepBucket), steps: n, activity: activity));
  }
  return out;
}
