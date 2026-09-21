// IdleMonsterArt: 時間が進むと絵が動き、タップで反応し、「アニメーションを減らす」なら止まる。
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/features/monster/idle_monster_art.dart';
import 'package:snapmon/features/monster/models.dart';

Monster _m({int personality = 2, bool revealed = true}) => Monster(
      id: 'a',
      name: 'a',
      family: 'aqua',
      subFamily: null,
      element: 'water',
      sourceLabel: 'mug',
      level: 1,
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
      personality: personality,
      personalityRevealed: revealed,
      trainingCount: 0,
      inheritedMoveId: null,
      inheritedGeneration: 0,
      mentorId: null,
      discipleId: null,
      isMentor: false,
      mentorUsed: false,
      mentorMoveId: null,
      lastMurmurTextId: null,
      createdAt: DateTime(2026, 9, 21),
    );

Matrix4 _transformOf(WidgetTester tester) => tester.widget<Transform>(find.descendant(of: find.byKey(const Key('idle-art')), matching: find.byType(Transform)).first).transform;

Widget _app(Widget child, {bool disableAnimations = false}) => ProviderScope(
      child: MaterialApp(
        builder: (context, w) => MediaQuery(data: MediaQuery.of(context).copyWith(disableAnimations: disableAnimations), child: w!),
        home: Scaffold(body: Center(child: child)),
      ),
    );

void main() {
  testWidgets('the art moves over time and the loop never settles into a jump', (tester) async {
    await tester.pumpWidget(_app(IdleMonsterArt(monster: _m(), size: 100)));
    await tester.pump();
    final t0 = _transformOf(tester);
    await tester.pump(const Duration(milliseconds: 300));
    final t1 = _transformOf(tester);
    expect(t1, isNot(equals(t0)));
    // 1 周期（1500ms）後も描画が続いている（例外なし）
    await tester.pump(const Duration(milliseconds: 1500));
    expect(find.byKey(const Key('idle-art')), findsOneWidget);
  });

  testWidgets('tap plays the reaction and calls onTap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_app(IdleMonsterArt(monster: _m(personality: 1), size: 100, onTap: () => taps++)));
    await tester.pump();
    await tester.tap(find.byKey(const Key('idle-art')));
    await tester.pump(); // タップの確定とアニメーション開始
    await tester.pump(const Duration(milliseconds: 100));
    final during = _transformOf(tester);
    await tester.pump(const Duration(milliseconds: 900));
    expect(taps, 1);
    // 反応中は横方向の拡大率が 1 から離れている（待機モーション「まじめ」は横にほぼ動かない）
    expect((during.storage[0] - 1).abs(), greaterThan(0.01));
  });

  testWidgets('reduced motion keeps the art still', (tester) async {
    await tester.pumpWidget(_app(IdleMonsterArt(monster: _m(), size: 100), disableAnimations: true));
    await tester.pump();
    final t0 = _transformOf(tester);
    await tester.pump(const Duration(milliseconds: 700));
    expect(_transformOf(tester), equals(t0));
    await tester.pumpAndSettle(); // 止まっているので settle できる
  });
}
