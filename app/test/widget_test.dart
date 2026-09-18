// P0 完了条件「サインインしてホームが出る」のスモークテスト。
// Firebase は使わず、AuthRepository をフェイクに差し替える。
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/core/config.dart';
import 'package:snapmon/domain/growth.dart';
import 'package:snapmon/features/auth/auth_provider.dart';
import 'package:snapmon/features/auth/auth_repository.dart';
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

Future<FakeAuthRepository> _pumpApp(WidgetTester tester) async {
  final repo = FakeAuthRepository();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        gameConfigProvider.overrideWith((ref) async => _loadConfigFromRepo()),
        authRepositoryProvider.overrideWithValue(repo),
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
  testWidgets('dev sign in -> home -> sign out', (tester) async {
    await _pumpApp(tester);
    expect(find.text('SnapMon'), findsOneWidget);

    final devButton = find.byKey(const Key('dev-sign-in'));
    expect(tester.widget<OutlinedButton>(devButton).onPressed, isNull, reason: '規約同意前は押せない');

    await _agree(tester);
    await tester.tap(devButton);
    await tester.pumpAndSettle();

    expect(find.text('今日の撮影枠'), findsOneWidget);
    expect(find.text('残り 3 / 3 枚'), findsOneWidget);
    expect(find.text('開発者'), findsOneWidget);

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
}
