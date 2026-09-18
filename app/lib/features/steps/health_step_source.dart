import 'package:flutter/foundation.dart';
import 'package:health/health.dart';

import 'step_source.dart';

/// Health Connect（Android）／ HealthKit（iOS）から歩数を取得する。
/// 起動時・復帰時に前回同期以降をまとめて読む（バックグラウンド処理なし、企画書 §5.2）。
/// アクティビティ種別は Health Connect から取れないので unknown（サーバーは物理妥当性のみで判定）。
class HealthStepSource implements StepSource {
  HealthStepSource([Health? health]) : _health = health ?? Health();

  final Health _health;
  bool _configured = false;

  Future<void> _ensureConfigured() async {
    if (_configured) return;
    await _health.configure();
    _configured = true;
  }

  @override
  Future<bool> requestPermission() async {
    await _ensureConfigured();
    try {
      final has = await _health.hasPermissions([HealthDataType.STEPS], permissions: [HealthDataAccess.READ]);
      if (has == true) return true;
      return await _health.requestAuthorization([HealthDataType.STEPS], permissions: [HealthDataAccess.READ]);
    } catch (e) {
      debugPrint('[SnapMon] health permission failed: $e');
      return false;
    }
  }

  @override
  Future<List<StepSegment>> fetchSegments(DateTime since, DateTime until) async {
    await _ensureConfigured();
    final points = await _health.getHealthDataFromTypes(types: [HealthDataType.STEPS], startTime: since, endTime: until);
    final records = <({DateTime from, DateTime to, int steps})>[];
    for (final p in _health.removeDuplicates(points)) {
      final v = p.value;
      if (v is! NumericHealthValue) continue;
      records.add((from: p.dateFrom.toUtc(), to: p.dateTo.toUtc(), steps: v.numericValue.round()));
    }
    return bucketize(records);
  }
}
