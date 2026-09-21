// P0 完了条件「サインインしてホームが出る」のスモークテスト。
// Firebase は使わず、AuthRepository / Firestore ストリームをフェイクに差し替える。
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:snapmon/core/config.dart';
import 'package:snapmon/domain/growth.dart';
import 'package:snapmon/features/auth/auth_provider.dart';
import 'package:snapmon/features/auth/auth_repository.dart';
import 'package:snapmon/features/monster/monster_repository.dart';
import 'package:snapmon/features/steps/step_source.dart';
import 'package:snapmon/features/steps/steps_sync.dart';
import 'package:snapmon/main.dart';

GameConfig _loadConfigFromRepo() {
  dynamic read(String name) => jsonDecode(File('../shared-config/$name').readAsStringSync());
  return GameConfig(
    constants: read('constants.json') as Map<String, dynamic>,
    personalities: read('personalities.json') as List<dynamic>,
    curves: read('growth_curves.json') as Map<String, dynamic>,
  );
}

class FakeAuthRepository implements AuthRepository {
  final _controller = StreamController<AuthUser?>.broadcast();
  bool failGoogle = false;
  int signOutCalls = 0;

  @override
  Stream<AuthUser?> authStateChanges() => _controller.stream;

  @override
  Future<void> signInWithGoogle() async {
    if (failGoogle) throw Exception('network error');
    _controller.add(const AuthUser(uid: 'g-1', displayName: 'Google太郎'));
  }

  @override
  Future<void> signInWithApple() async {
    _controller.add(const AuthUser(uid: 'a-1', displayName: 'Apple花子'));
  }

  @override
  Future<void> signOut() async {
    signOutCalls++;
    _controller.add(null);
  }
}

class NoStepSource implements StepSource {
  @override
  Future<bool> requestPermission() async => true;
  @override
  Future<List<StepSegment>> fetchSegments(DateTime since, DateTime until) async => const [];
}

Future<FakeAuthRepository> _pumpApp(WidgetTester tester, {Map<String, dynamic>? userDoc}) async {
  final repo = FakeAuthRepository();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        gameConfigProvider.overrideWith((ref) async => _loadConfigFromRepo()),
        authRepositoryProvider.overrideWithValue(repo),
        // birthYear が無いとホームの代わりに年齢確認が出るので、テストは申告済みにしておく
        userDocProvider.overrideWith((ref) => Stream.value({'birthYear': 1990, ...?userDoc})),
        monstersProvider.overrideWith((ref) => Stream.value(const [])),
        inventoryProvider.overrideWith((ref) => Stream.value(const {})),
        murmurTextsProvider.overrideWith((ref) async => const {'p001': '散歩のあとは機嫌がいい'}),
        stepSourceProvider.overrideWithValue(NoStepSource()),
      ],
      child: const SnapMonApp(),
    ),
  );
  await tester.pumpAndSettle();
  return repo;
}

Future<void> _agree(WidgetTester tester) async {
  await tester.tap(find.byType(CheckboxListTile));
  await tester.pump();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('dev sign in -> home -> sign out', (tester) async {
    await _pumpApp(tester);
    expect(find.text('SnapMon'), findsOneWidget);

    final devButton = find.byKey(const Key('dev-sign-in'));
    expect(tester.widget<OutlinedButton>(devButton).onPressed, isNull, reason: '規約同意前は押せない');

    await _agree(tester);
    await tester.tap(devButton);
    await tester.pumpAndSettle();

    expect(find.text('今日の撮影枠'), findsOneWidget);
    expect(find.text('無料 残り 1 / 1 枚'), findsOneWidget); // P6: 無料は 1 日 1 枚
    expect(find.text('開発者'), findsOneWidget);
    expect(find.text('撮る'), findsOneWidget);

    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dev-sign-in')), findsOneWidget);
  });

  testWidgets('google sign in via repository -> home shows display name', (tester) async {
    final repo = await _pumpApp(tester);
    await _agree(tester);
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.text('Google太郎'), findsOneWidget);

    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    expect(repo.signOutCalls, 1);
    expect(find.byKey(const Key('google-sign-in')), findsOneWidget);
  });

  testWidgets('google sign in failure shows error and stays on login', (tester) async {
    final repo = await _pumpApp(tester);
    repo.failGoogle = true;
    await _agree(tester);
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();

    expect(find.text('ネットワークに接続できません'), findsOneWidget);
    expect(find.byKey(const Key('google-sign-in')), findsOneWidget);
    expect(find.text('今日の撮影枠'), findsNothing);
  });

  testWidgets('snap quota exhausted disables the shoot button', (tester) async {
    final today = jstDateKey(DateTime.now());
    await _pumpApp(tester, userDoc: {'dailyState': {'date': today, 'snapsUsed': 3, 'stepsToday': 4321}, 'vpBalance': 77});
    await _agree(tester);
    await tester.tap(find.byKey(const Key('dev-sign-in')));
    await tester.pumpAndSettle();

    expect(find.textContaining('今日は 3 枚撮りました'), findsOneWidget); // P6: 1 日の合計上限
    expect(find.textContaining('活力ポイント'), findsOneWidget);
    expect(find.text('今日はおしまい'), findsOneWidget);
    expect(find.text('4321 歩 ・ 活力ポイント 77 VP'), findsOneWidget);
    expect(tester.widget<FloatingActionButton>(find.byKey(const Key('shoot'))).onPressed, isNull);
  });

  test('remainingSnaps resets on a new JST day', () {
    expect(remainingSnaps(null, 3), 3);
    expect(remainingSnaps({'dailyState': {'date': '19990101', 'snapsUsed': 3}}, 3), 3);
    final today = jstDateKey(DateTime.now());
    expect(remainingSnaps({'dailyState': {'date': today, 'snapsUsed': 2}}, 3), 1);
  });
}
