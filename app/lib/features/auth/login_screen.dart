import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_provider.dart';

/// S01 スプラッシュ／ログイン（企画書 §8.1）。
/// Apple / Google サインインと生年入力は Firebase 接続後に有効化する。
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _agreed = false;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('SnapMon', textAlign: TextAlign.center, style: theme.textTheme.displayMedium),
              const SizedBox(height: 8),
              Text('写真で生まれ、歩いて育つ', textAlign: TextAlign.center, style: theme.textTheme.titleMedium),
              const SizedBox(height: 48),
              CheckboxListTile(
                value: _agreed,
                onChanged: (v) => setState(() => _agreed = v ?? false),
                title: const Text('利用規約とプライバシーポリシーに同意する'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: null, // Firebase 接続後に有効化
                icon: const Icon(Icons.apple),
                label: const Text('Apple でサインイン'),
              ),
              const SizedBox(height: 8),
              FilledButton.tonalIcon(
                onPressed: null, // Firebase 接続後に有効化
                icon: const Icon(Icons.g_mobiledata),
                label: const Text('Google でサインイン'),
              ),
              if (kDebugMode) ...[
                const SizedBox(height: 24),
                OutlinedButton(
                  key: const Key('dev-sign-in'),
                  onPressed: _agreed ? () => ref.read(authProvider).signInDev() : null,
                  child: const Text('開発用サインイン（Firebase 未接続）'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
