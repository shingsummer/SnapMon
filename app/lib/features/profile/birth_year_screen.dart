import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_provider.dart';
import '../monster/monster_repository.dart';

/// 生年の自己申告（企画書 §14.3、利用規約 第 3 条）。users.birthYear が無い間、ホームの代わりに表示する。
/// 13 歳未満と判定されたらサーバーが拒否するので、案内を出してサインアウトする。
class BirthYearGate extends ConsumerStatefulWidget {
  const BirthYearGate({super.key});

  @override
  ConsumerState<BirthYearGate> createState() => _BirthYearGateState();
}

class _BirthYearGateState extends ConsumerState<BirthYearGate> {
  int? _year;
  bool _busy = false;
  String? _error;
  bool _rejected = false;

  Future<void> _submit() async {
    final y = _year;
    if (y == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(monsterApiProvider).setBirthYear(y);
      // 成功すると users ドキュメントが更新され、ホームが表示される（この画面は差し替わる）
      if (mounted) setState(() => _busy = false);
    } on MonsterApiException catch (e) {
      setState(() {
        _busy = false;
        if (e.reason == 'under_13') {
          _rejected = true;
        } else {
          _error = e.message;
        }
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final now = DateTime.now().year;
    final years = [for (var y = now; y >= now - 100; y--) y];
    return Scaffold(
      appBar: AppBar(title: const Text('はじめる前に')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _rejected
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('ごめんなさい', style: theme.textTheme.headlineSmall),
                  const SizedBox(height: 12),
                  const Text('SnapMon は 13 歳以上の方が対象です。保護者の方のアカウントで一緒に遊ぶことはできます。', textAlign: TextAlign.center),
                  const SizedBox(height: 24),
                  FilledButton(key: const Key('under13-signout'), onPressed: () => ref.read(authProvider).signOut(), child: const Text('サインアウト')),
                ],
              )
            : ListView(
                children: [
                  Text('生まれた年を教えてください', style: theme.textTheme.titleLarge),
                  const SizedBox(height: 8),
                  const Text('年齢確認のためだけに使います。他の人には見えません。13 歳未満の方は利用できません（利用規約 第 3 条）。'),
                  const SizedBox(height: 24),
                  TextField(
                    key: const Key('birth-year'),
                    enabled: !_busy,
                    keyboardType: TextInputType.number,
                    maxLength: 4,
                    decoration: const InputDecoration(labelText: '生まれた年（西暦 4 桁）', hintText: '例: 1990', border: OutlineInputBorder(), counterText: ''),
                    onChanged: (v) {
                      final y = int.tryParse(v);
                      setState(() => _year = y != null && y >= years.last && y <= years.first ? y : null);
                    },
                  ),
                  const SizedBox(height: 16),
                  FilledButton(key: const Key('birth-year-submit'), onPressed: _year == null || _busy ? null : _submit, child: _busy ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('つぎへ')),
                  if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: theme.colorScheme.error))],
                  const SizedBox(height: 24),
                  Wrap(
                    alignment: WrapAlignment.center,
                    children: [
                      TextButton(onPressed: () => context.push('/legal/terms'), child: const Text('利用規約')),
                      TextButton(onPressed: () => context.push('/legal/privacy'), child: const Text('プライバシーポリシー')),
                    ],
                  ),
                ],
              ),
      ),
    );
  }
}
