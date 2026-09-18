import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_repository.dart';

/// 本番は Firebase。テストや Firebase 未設定時は overrideWith でフェイクに差し替える。
final authRepositoryProvider = Provider<AuthRepository>((ref) => FirebaseAuthRepository());

@immutable
class AuthState {
  const AuthState({this.user, this.busy = false, this.error});

  final AuthUser? user;
  final bool busy;
  final String? error;

  bool get signedIn => user != null;
  String? get displayName => user?.displayName;

  AuthState copyWith({AuthUser? user, bool clearUser = false, bool? busy, String? error, bool clearError = false}) {
    return AuthState(
      user: clearUser ? null : (user ?? this.user),
      busy: busy ?? this.busy,
      error: clearError ? null : (error ?? this.error),
    );
  }

  static const signedOut = AuthState();
}

class AuthNotifier extends ChangeNotifier {
  AuthNotifier(this._repo) {
    _sub = _repo.authStateChanges().listen((u) {
      // 開発用サインイン中は Firebase 側の null で上書きしない
      if (_devSession && u == null) return;
      _state = _state.copyWith(user: u, clearUser: u == null, busy: false);
      notifyListeners();
    });
  }

  final AuthRepository _repo;
  StreamSubscription<AuthUser?>? _sub;
  AuthState _state = AuthState.signedOut;
  bool _devSession = false;

  AuthState get state => _state;

  Future<void> signInWithGoogle() => _run(_repo.signInWithGoogle);

  Future<void> signInWithApple() => _run(_repo.signInWithApple);

  /// 開発用: Firebase 未接続でも画面遷移を確認するためのサインイン（デバッグビルドのみ）。
  void signInDev() {
    if (!kDebugMode) return;
    _devSession = true;
    _state = const AuthState(user: AuthUser(uid: 'dev-user', displayName: '開発者'));
    notifyListeners();
  }

  Future<void> signOut() async {
    _devSession = false;
    _state = AuthState.signedOut;
    notifyListeners();
    try {
      await _repo.signOut();
    } catch (_) {
      // サインアウト失敗はローカル状態を優先する
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    _state = _state.copyWith(busy: true, clearError: true);
    notifyListeners();
    try {
      await action();
      // 成功時は authStateChanges が user を流してくる
    } catch (e) {
      _state = _state.copyWith(busy: false, error: _message(e));
      notifyListeners();
    }
  }

  static String _message(Object e) {
    final s = e.toString();
    if (s.contains('canceled') || s.contains('cancelled')) return 'サインインをキャンセルしました';
    if (s.contains('network')) return 'ネットワークに接続できません';
    return 'サインインに失敗しました';
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}

final authProvider = ChangeNotifierProvider<AuthNotifier>((ref) {
  return AuthNotifier(ref.watch(authRepositoryProvider));
});
