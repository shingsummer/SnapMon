// P0 完了条件「サインインしてホームが出る」のスモークテスト（開発用サインイン経由）。
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/core/config.dart';
import 'package:snapmon/domain/growth.dart';
import 'package:snapmon/main.dart';

GameConfig _loadConfigFromRepo() {
  dynamic read(String name) => jsonDecode(File('../shared-config/$name').readAsStringSync());
  return GameConfig(
    constants: read('constants.json') as Map<String, dynamic>,
    personalities: read('personalities.json') as List<dynamic>,
    curves: read('growth_curves.json') as Map<String, dynamic>,
  );
}

void main() {
  testWidgets('login -> dev sign in -> home -> sign out', (tester) async {
    final cfg = _loadConfigFromRepo();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [gameConfigProvider.overrideWith((ref) async => cfg)],
        child: const SnapMonApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('SnapMon'), findsOneWidget);
    final devButton = find.byKey(const Key('dev-sign-in'));
    expect(tester.widget<OutlinedButton>(devButton).onPressed, isNull, reason: '規約同意前は押せない');

    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();
    await tester.tap(devButton);
    await tester.pumpAndSettle();

    expect(find.text('今日の撮影枠'), findsOneWidget);
    expect(find.text('残り 3 / 3 枚'), findsOneWidget);
    expect(find.text('開発者'), findsOneWidget);

    await tester.tap(find.byKey(const Key('sign-out')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('dev-sign-in')), findsOneWidget);
  });
}
