import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// サインイン済みユーザーの最小表現。Firebase の User をアプリ層に漏らさない。
class AuthUser {
  const AuthUser({required this.uid, this.displayName});

  final String uid;
  final String? displayName;
}

/// 認証の入口。本番は [FirebaseAuthRepository]、テストはフェイクに差し替える。
abstract class AuthRepository {
  Stream<AuthUser?> authStateChanges();
  Future<void> signInWithGoogle();
  Future<void> signInWithApple();
  Future<void> signOut();
}

class FirebaseAuthRepository implements AuthRepository {
  FirebaseAuthRepository({FirebaseAuth? auth, GoogleSignIn? googleSignIn})
      : _auth = auth ?? FirebaseAuth.instance,
        _google = googleSignIn ?? GoogleSignIn.instance;

  final FirebaseAuth _auth;
  final GoogleSignIn _google;
  bool _googleInitialized = false;

  @override
  Stream<AuthUser?> authStateChanges() => _auth.authStateChanges().map(
        (u) => u == null ? null : AuthUser(uid: u.uid, displayName: u.displayName),
      );

  Future<void> _ensureGoogle() async {
    if (_googleInitialized) return;
    // Android は google-services.json の web クライアント ID を自動で使う（serverClientId 不要）。
    await _google.initialize();
    _googleInitialized = true;
  }

  @override
  Future<void> signInWithGoogle() async {
    await _ensureGoogle();
    final account = await _google.authenticate();
    final idToken = account.authentication.idToken;
    if (idToken == null) {
      throw StateError('Google サインインで ID トークンを取得できませんでした');
    }
    await _auth.signInWithCredential(GoogleAuthProvider.credential(idToken: idToken));
  }

  @override
  Future<void> signInWithApple() async {
    final rawNonce = _randomNonce();
    final credential = await SignInWithApple.getAppleIDCredential(
      scopes: [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
      nonce: sha256.convert(utf8.encode(rawNonce)).toString(),
    );
    final oauth = OAuthProvider('apple.com').credential(
      idToken: credential.identityToken,
      rawNonce: rawNonce,
    );
    final result = await _auth.signInWithCredential(oauth);
    // Apple は初回しか名前を返さないので、取れたときだけプロフィールに保存する
    final name = [credential.givenName, credential.familyName].whereType<String>().join(' ').trim();
    if (name.isNotEmpty && (result.user?.displayName ?? '').isEmpty) {
      await result.user?.updateDisplayName(name);
    }
  }

  @override
  Future<void> signOut() async {
    await _auth.signOut();
    if (_googleInitialized) await _google.signOut();
  }

  static String _randomNonce([int length = 32]) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
    final rnd = Random.secure();
    return List.generate(length, (_) => chars[rnd.nextInt(chars.length)]).join();
  }
}
