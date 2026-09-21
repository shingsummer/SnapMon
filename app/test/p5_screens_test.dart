// P5 画面のウィジェットテスト: チュートリアルの出し分け、図鑑・アイテム・家系図の表示。
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
import 'package:snapmon/features/dex/dex_screen.dart';
import 'package:snapmon/features/items/items_screen.dart';
import 'package:snapmon/features/mentor/lineage_screen.dart';
import 'package:snapmon/features/monster/models.dart';
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
  @override
  Stream<AuthUser?> authStateChanges() => _c.stream;
  @override
  Future<void> signInWithGoogle() async => _c.add(const AuthUser(uid: 'u1', displayName: 'テスト'));
  @override
  Future<void> signInWithApple() async {}
  @override
  Future<void> signOut() async => _c.add(null);
}

class _NoSteps implements StepSource {
  @override
  Future<bool> requestPermission() async => true;
  @override
  Future<List<StepSegment>> fetchSegments(DateTime since, DateTime until) async => const [];
}

Monster _m(String id, {String family = 'aqua', String element = 'water', String? mentorId, String? discipleId, bool isMentor = false, String? inherited, int level = 1}) => Monster(
      id: id,
      name: id,
      family: family,
      subFamily: null,
      element: element,
      sourceLabel: 'mug',
      level: level,
      exp: 0,
      stats: {for (final s in statOrder) s: 20},
      base: {for (final s in statOrder) s: 20},
      statHistory: const [],
      moves: const ['water_shot'],
      artBucketId: '',
      artTint: ArtTint.none,
      artStatus: 'fallback',
      artImagePath: null,
      status: 'active',
      fatigue: 0,
      personality: 0,
      personalityRevealed: false,
      trainingCount: 0,
      inheritedMoveId: inherited,
      inheritedGeneration: inherited == null ? 0 : 1,
      mentorId: mentorId,
      discipleId: discipleId,
      isMentor: isMentor,
      mentorUsed: discipleId != null,
      mentorMoveId: isMentor ? 'water_shot' : null,
      lastMurmurTextId: null,
      createdAt: DateTime(2026, 9, 18),
    );

List<Override> _overrides({List<Monster> monsters = const [], Map<String, int> inventory = const {}, bool tutorialDone = true}) => [
      gameConfigProvider.overrideWith((ref) async => _cfg()),
      authRepositoryProvider.overrideWithValue(_Auth()),
      userDocProvider.overrideWith((ref) => Stream.value({'birthYear': 1990})),
      monstersProvider.overrideWith((ref) => Stream.value(monsters)),
      inventoryProvider.overrideWith((ref) => Stream.value(inventory)),
      murmurTextsProvider.overrideWith((ref) async => const {}),
      moveTableProvider.overrideWith((ref) async => const {'water_shot': {'name': 'みずでっぽう'}}),
      stepSourceProvider.overrideWithValue(_NoSteps()),
      friendsProvider.overrideWith((ref) => Stream.value(const [])),
      battlesProvider.overrideWith((ref) => Stream.value(const [])),
      tutorialDoneProvider.overrideWith((ref) => tutorialDone),
    ];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('first sign-in shows the tutorial, skip goes home', (tester) async {
    await tester.pumpWidget(ProviderScope(overrides: _overrides(tutorialDone: false), child: const SnapMonApp()));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();
    await tester.tap(find.byKey(const Key('google-sign-in')));
    await tester.pumpAndSettle();
    expect(find.text('撮る'), findsWidgets); // チュートリアル 1 ページ目
    expect(find.byKey(const Key('tutorial-next')), findsOneWidget);
    await tester.tap(find.byKey(const Key('tutorial-skip')));
    await tester.pumpAndSettle();
    expect(find.text('今日の撮影枠'), findsOneWidget);
  });

  testWidgets('dex counts discovered family×element and labels', (tester) async {
    final monsters = [_m('a'), _m('b', family: 'spark', element: 'thunder'), _m('c')];
    await tester.pumpWidget(ProviderScope(overrides: _overrides(monsters: monsters), child: const MaterialApp(home: DexScreen())));
    await tester.pumpAndSettle();
    expect(find.text('図鑑 2 / 84'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('mug ×3'), 200, scrollable: find.byType(Scrollable).first);
    expect(find.text('mug ×3'), findsOneWidget);
  });

  testWidgets('items screen lists inventory with labels', (tester) async {
    await tester.pumpWidget(ProviderScope(overrides: _overrides(inventory: const {'food_aqua': 2, 'bond_capsule': 1, 'fatigue_cure': 0}), child: const MaterialApp(home: ItemsScreen())));
    await tester.pumpAndSettle();
    expect(find.text('アクアのエサ ×2'), findsOneWidget);
    expect(find.text('絆カプセル ×1'), findsOneWidget);
    expect(find.textContaining('疲労回復薬'), findsNothing);
  });

  testWidgets('lineage walks from the founder through disciples', (tester) async {
    final monsters = [
      _m('founder', isMentor: true, discipleId: 'child', level: 50),
      _m('child', mentorId: 'founder', discipleId: 'grandchild', isMentor: true, inherited: 'water_shot', level: 50),
      _m('grandchild', mentorId: 'child', inherited: 'water_shot'),
    ];
    await tester.pumpWidget(ProviderScope(overrides: _overrides(monsters: monsters), child: const MaterialApp(home: LineageScreen(monsterId: 'grandchild'))));
    await tester.pumpAndSettle();
    expect(find.text('founder の家系'), findsOneWidget);
    expect(find.text('始祖 founder'), findsOneWidget);
    expect(find.text('1 代目 child'), findsOneWidget);
    expect(find.text('2 代目 grandchild'), findsOneWidget);
    expect(find.textContaining('受け継いだ型: みずでっぽう'), findsNWidgets(2));
  });
}
