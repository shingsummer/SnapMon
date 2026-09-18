import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../auth/auth_provider.dart';
import '../monster/models.dart';
import '../monster/monster_repository.dart';
import 'fake_step_source.dart';
import 'health_step_source.dart';
import 'step_source.dart';

/// `--dart-define=FAKE_STEPS=true` で疑似歩数（エミュレータ用）
const useFakeSteps = bool.fromEnvironment('FAKE_STEPS');

final stepSourceProvider = Provider<StepSource>((ref) => useFakeSteps ? FakeStepSource() : HealthStepSource());

@immutable
class StepsSyncState {
  const StepsSyncState({this.syncing = false, this.message, this.error, this.last, this.permissionDenied = false});

  final bool syncing;
  final String? message;
  final String? error;
  final SubmitStepsResult? last;
  final bool permissionDenied;

  StepsSyncState copyWith({bool? syncing, String? message, String? error, SubmitStepsResult? last, bool? permissionDenied}) =>
      StepsSyncState(
        syncing: syncing ?? this.syncing,
        message: message,
        error: error,
        last: last ?? this.last,
        permissionDenied: permissionDenied ?? this.permissionDenied,
      );
}

/// 起動時・復帰時・手動で、前回同期以降の歩数を取り込んでサーバーへ送る（企画書 §5.2）。
class StepsSyncNotifier extends Notifier<StepsSyncState> {
  static const _minInterval = Duration(minutes: 5);
  static const _lookback = Duration(days: 7);
  DateTime? _lastAttempt;

  @override
  StepsSyncState build() => const StepsSyncState();

  String? get _uid => ref.read(authProvider).state.user?.uid;

  Future<void> sync({bool force = false}) async {
    final uid = _uid;
    if (uid == null || uid == 'dev-user' || state.syncing) return;
    final now = DateTime.now().toUtc();
    if (!force && _lastAttempt != null && now.difference(_lastAttempt!) < _minInterval) return;
    _lastAttempt = now;
    state = state.copyWith(syncing: true);
    try {
      final source = ref.read(stepSourceProvider);
      if (!await source.requestPermission()) {
        state = state.copyWith(syncing: false, permissionDenied: true, error: '歩数の読み取りが許可されていません');
        return;
      }
      final since = await _lastSyncAt(uid) ?? now.subtract(_lookback);
      final from = since.isBefore(now.subtract(_lookback)) ? now.subtract(_lookback) : since;
      final segments = await source.fetchSegments(from, now);
      if (segments.isEmpty) {
        state = state.copyWith(syncing: false, message: '新しい歩数はありません');
        return;
      }
      final r = await ref.read(monsterApiProvider).submitSteps(segments);
      final newest = segments.map((s) => s.endAt).reduce((a, b) => a.isAfter(b) ? a : b);
      await _saveLastSyncAt(uid, newest);
      final parts = <String>['${r.acceptedSteps} 歩'];
      if (r.vpGained > 0) parts.add('+${r.vpGained} VP');
      if (r.walkBonusApplied) parts.add('連続歩行ボーナス');
      if (r.partnerExp > 0) parts.add('パートナー +${r.partnerExp} exp');
      if (r.partnerLevelUps > 0) parts.add('レベルアップ！');
      state = state.copyWith(syncing: false, last: r, message: parts.join(' ・ '));
    } on MonsterApiException catch (e) {
      state = state.copyWith(syncing: false, error: e.message);
    } catch (e) {
      debugPrint('[SnapMon] steps sync failed: $e');
      state = state.copyWith(syncing: false, error: '歩数の同期に失敗しました');
    }
  }

  Future<DateTime?> _lastSyncAt(String uid) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final ms = prefs.getInt('lastStepSyncAt:$uid');
      return ms == null ? null : DateTime.fromMillisecondsSinceEpoch(ms, isUtc: true);
    } catch (_) {
      return null;
    }
  }

  Future<void> _saveLastSyncAt(String uid, DateTime t) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setInt('lastStepSyncAt:$uid', t.millisecondsSinceEpoch);
    } catch (_) {}
  }
}

final stepsSyncProvider = NotifierProvider<StepsSyncNotifier, StepsSyncState>(StepsSyncNotifier.new);
