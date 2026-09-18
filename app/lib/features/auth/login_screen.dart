import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth_provider.dart';

/// S01 スプラッシュ／ログイン（企画書 §8.1）。
/// 生年入力（年齢確認）は初回サインイン直後のプロフィール作成画面で行う（P0 後半）。
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  bool _agreed = false;

  bool get _showApple => defaultTargetPlatform == TargetPlatform.iOS;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final auth = ref.watch(authProvider).state;
    final notifier = ref.read(authProvider);
    final canSubmit = _agreed && !auth.busy;

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
                onChanged: auth.busy ? null : (v) => setState(() => _agreed = v ?? false),
                title: const Text('利用規約とプライバシーポリシーに同意する'),
                controlAffinity: ListTileControlAffinity.leading,
              ),
              const SizedBox(height: 16),
              if (_showApple) ...[
                FilledButton.icon(
                  key: const Key('apple-sign-in'),
                  onPressed: canSubmit ? notifier.signInWithApple : null,
                  icon: const Icon(Icons.apple),
                  label: const Text('Apple でサインイン'),
                ),
                const SizedBox(height: 8),
              ],
              FilledButton.tonalIcon(
                key: const Key('google-sign-in'),
                onPressed: canSubmit ? notifier.signInWithGoogle : null,
                icon: const Icon(Icons.g_mobiledata),
                label: const Text('Google でサインイン'),
              ),
              if (auth.busy) ...[
                const SizedBox(height: 16),
                const Center(child: CircularProgressIndicator()),
              ],
              if (auth.error != null) ...[
                const SizedBox(height: 16),
                Text(auth.error!, textAlign: TextAlign.center, style: TextStyle(color: theme.colorScheme.error)),
              ],
              if (kDebugMode) ...[
                const SizedBox(height: 24),
                OutlinedButton(
                  key: const Key('dev-sign-in'),
                  onPressed: canSubmit ? notifier.signInDev : null,
                  child: const Text('開発用サインイン（Firebase を使わない）'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
