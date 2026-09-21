// 規約表示・年齢確認・アカウント削除の導線（P6 法務）。
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:snapmon/core/config.dart';
import 'package:snapmon/core/router.dart';
import 'package:snapmon/domain/growth.dart';
import 'package:snapmon/features/auth/auth_provider.dart';
import 'package:snapmon/features/auth/auth_repository.dart';
import 'package:snapmon/features/battle/battle_repository.dart';
import 'package:snapmon/features/legal/legal_screen.dart';
import 'package:snapmon/features/monster/monster_repository.dart';
import 'package:snapmon/features/steps/step_source.dart';
import 'package:snapmon/features/steps/steps_sync.dart';
import 'package:snapmon/main.dart';

GameConfig _cfg() {
  dynamic read(String name) => jsonDecode(File('../shared-config/$name').readAsStringSync());
  return GameConfig(constants: read('constants.json') as Map<String, dynamic>, personalities: read('personalities.json') as List<dynamic>, curves: read('growth_curves.json') as Map<String, dynamic>);
}

class _Auth implements AuthRepository {
  final _c = StreamController<AuthUser?>.broadcast();
  int signOuts = 0;
  @override
  Stream<AuthUser?> authStateChanges() => _c.stream;
  @override
  Future<void> signInWithGoogle() async => _c.add(const AuthUser(uid: 'u1', displayName: 'テスト'));
  @override
  Future<void> signInWithApple() async {}
  @override
  Future<void> signOut() async {
    signOuts++;
    _c.add(null);
  }
}

class _NoSteps implements StepSource {
  @override
  Future<bool> requestPermission() async => true;
  @override
  Future<List<StepSegment>> fetchSegments(DateTime since, DateTime until) async => const [];
}

/// 必要なメソッドだけ実装するフェイク（他は noSuchMethod）
class _Api implements MonsterApi {
  final birthYears = <int>[];
  int deletes = 0;
  bool rejectUnder13 = false;
  @override
  Future<void> setBirthYear(int birthYear) async {
    if (rejectUnder13) throw MonsterApiException('failed-precondition', '13 歳未満', reason: 'under_13');
    birthYears.add(birthYear);
  }

  @override
  Future<void> deleteAccount() async => deletes++;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError('${invocation.memberName}');
}

List<Override> _overrides(_Auth auth, _Api api, {Map<String, dynamic>? userDoc}) => [
      gameConfigProvider.overrideWith((ref) async => _cfg()),
      authRepositoryProvider.overrideWithValue(auth),
      monsterApiProvider.overrideWithValue(api),
      userDocProvider.overrideWith((ref) => Stream.value(userDoc)),
      monstersProvider.overrideWith((ref) => Stream.value(const [])),
      inventoryProvider.overrideWith((ref) => Stream.value(const {})),
      murmurTextsProvider.overrideWith((ref) async => const {}),
      stepSourceProvider.overrideWithValue(_NoSteps()),
      friendsProvider.overrideWith((ref) => Stream.value(const [])),
      battlesProvider.overrideWith((ref) => Stream.value(const [])),
      tutorialDoneProvider.overrideWith((ref) => true),
    ];

Future<void> _signIn(WidgetTester tester) async {
  await tester.pumpAndSettle();
  await tester.tap(find.byType(CheckboxListTile));
  await tester.pump();
  await tester.tap(find.byKey(const Key('google-sign-in')));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('LegalScreen renders headings, lists, bold and tables from markdown', (tester) async {
    const md = '# 見出し\n\n本文に **太字** がある。\n\n## 第 1 条\n\n1. 項目いち\n2. 項目に\n\n| 列A | 列B |\n|---|---|\n| a | b |\n';
    await tester.pumpWidget(const MaterialApp(home: LegalScreen(doc: 'terms', textOverride: md)));
    await tester.pumpAndSettle();
    expect(find.text('利用規約'), findsOneWidget); // AppBar
    expect(find.text('見出し'), findsOneWidget);
    expect(find.text('第 1 条'), findsOneWidget);
    expect(find.textContaining('項目いち'), findsOneWidget);
    expect(find.text('列A'), findsOneWidget);
    expect(find.text('b'), findsOneWidget);
  });

  testWidgets('legal pages are reachable before sign-in', (tester) async {
    final auth = _Auth();
    await tester.pumpWidget(ProviderScope(overrides: _overrides(auth, _Api()), child: const SnapMonApp()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('open-privacy')));
    await tester.pumpAndSettle();
    expect(find.text('プライバシーポリシー'), findsWidgets);
  });

  testWidgets('first sign-in without birthYear shows the age gate; submitting calls the API', (tester) async {
    final auth = _Auth();
    final api = _Api();
    await tester.pumpWidget(ProviderScope(overrides: _overrides(auth, api, userDoc: null), child: const SnapMonApp()));
    await _signIn(tester);
    expect(find.text('生まれた年を教えてください'), findsOneWidget);
    expect(find.text('今日の撮影枠'), findsNothing);
    await tester.enterText(find.byKey(const Key('birth-year')), '${DateTime.now().year - 30}');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('birth-year-submit')));
    await tester.pumpAndSettle();
    expect(api.birthYears, [DateTime.now().year - 30]);
  });

  testWidgets('under 13 is rejected and can only sign out', (tester) async {
    final auth = _Auth();
    final api = _Api()..rejectUnder13 = true;
    await tester.pumpWidget(ProviderScope(overrides: _overrides(auth, api, userDoc: null), child: const SnapMonApp()));
    await _signIn(tester);
    await tester.enterText(find.byKey(const Key('birth-year')), '${DateTime.now().year - 10}');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('birth-year-submit')));
    await tester.pumpAndSettle();
    expect(find.text('ごめんなさい'), findsOneWidget);
    await tester.tap(find.byKey(const Key('under13-signout')));
    await tester.pumpAndSettle();
    expect(auth.signOuts, 1);
    expect(find.byKey(const Key('google-sign-in')), findsOneWidget); // ログインに戻る
  });

  testWidgets('home shows legal links and account deletion asks for confirmation', (tester) async {
    final auth = _Auth();
    final api = _Api();
    await tester.pumpWidget(ProviderScope(overrides: _overrides(auth, api, userDoc: {'birthYear': 1990}), child: const SnapMonApp()));
    await _signIn(tester);
    expect(find.text('今日の撮影枠'), findsOneWidget);
    await tester.scrollUntilVisible(find.byKey(const Key('delete-account')), 200, scrollable: find.byType(Scrollable).first);
    await tester.tap(find.byKey(const Key('delete-account')));
    await tester.pumpAndSettle();
    expect(find.text('アカウントを削除しますか？'), findsOneWidget);
    await tester.tap(find.text('やめる'));
    await tester.pumpAndSettle();
    expect(api.deletes, 0);
    await tester.tap(find.byKey(const Key('delete-account')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('delete-account-confirm')));
    await tester.pumpAndSettle();
    expect(api.deletes, 1);
    expect(auth.signOuts, 1);
  });
}
