import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// 認証状態。P0 では開発用のダミーサインインのみ。
/// Firebase Auth（Apple / Google）は google-services 配置後に AuthRepository 実装を差し替えて接続する。
@immutable
class AuthState {
  const AuthState({this.uid, this.displayName});

  final String? uid;
  final String? displayName;

  bool get signedIn => uid != null;

  static const signedOut = AuthState();
}

class AuthNotifier extends ChangeNotifier {
  AuthState _state = AuthState.signedOut;
  AuthState get state => _state;

  /// 開発用: Firebase 未接続でも画面遷移を確認するためのサインイン。
  /// リリースビルドでは呼ばれない（LoginScreen 側で kDebugMode ガード）。
  void signInDev() {
    _state = const AuthState(uid: 'dev-user', displayName: '開発者');
    notifyListeners();
  }

  void signOut() {
    _state = AuthState.signedOut;
    notifyListeners();
  }
}

final authProvider = ChangeNotifierProvider<AuthNotifier>((ref) => AuthNotifier());
