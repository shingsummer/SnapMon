import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/router.dart';

/// S02 チュートリアル（企画書 §8.1, §8.2）。撮る → 生まれる → 歩く の 3 ページ。
/// 歩数の権限は「歩く」の説明直後（ホームに戻ったときの同期）で求める。
class TutorialScreen extends ConsumerStatefulWidget {
  const TutorialScreen({super.key});

  static const prefKey = 'tutorialDone';

  static Future<bool> isDone() async {
    try {
      return (await SharedPreferences.getInstance()).getBool(prefKey) ?? false;
    } catch (_) {
      return true;
    }
  }

  static Future<void> markDone() async {
    try {
      await (await SharedPreferences.getInstance()).setBool(prefKey, true);
    } catch (_) {}
  }

  @override
  ConsumerState<TutorialScreen> createState() => _TutorialScreenState();
}

class _TutorialScreenState extends ConsumerState<TutorialScreen> {
  final _controller = PageController();
  int _page = 0;

  static const _pages = [
    (icon: Icons.photo_camera, title: '撮る', body: '身の回りの「物」を写真に撮ると、その物からモンスターが生まれます。\n1 日 3 枚まで。人の顔は撮れません。'),
    (icon: Icons.egg, title: '生まれる', body: '撮った写真から、その子だけの姿が描かれます（30〜60 秒）。\n素質や成長タイプは教えてもらえません。育ててみて、成長グラフで気づくものです。'),
    (icon: Icons.directions_walk, title: '歩く', body: 'モンスターは、あなたが歩いた分だけ強くなります。\n歩数が「活力ポイント」になり、トレーニングに使えます。乗り物での移動は数えません。\n次の画面で歩数の読み取りを許可してください。'),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await TutorialScreen.markDone();
    ref.read(tutorialDoneProvider.notifier).state = true; // ルーターのリダイレクト条件も更新
    if (mounted) context.go('/home');
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _pages.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (_, i) => Padding(
                  padding: const EdgeInsets.all(32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(_pages[i].icon, size: 96, color: theme.colorScheme.primary),
                      const SizedBox(height: 24),
                      Text(_pages[i].title, style: theme.textTheme.headlineMedium),
                      const SizedBox(height: 16),
                      Text(_pages[i].body, textAlign: TextAlign.center, style: theme.textTheme.bodyLarge),
                    ],
                  ),
                ),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [for (var i = 0; i < _pages.length; i++) Padding(padding: const EdgeInsets.all(4), child: Icon(Icons.circle, size: 10, color: i == _page ? theme.colorScheme.primary : theme.colorScheme.outlineVariant))],
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                children: [
                  TextButton(key: const Key('tutorial-skip'), onPressed: _finish, child: const Text('スキップ')),
                  const Spacer(),
                  FilledButton(
                    key: const Key('tutorial-next'),
                    onPressed: () {
                      if (_page < _pages.length - 1) {
                        _controller.nextPage(duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
                      } else {
                        _finish();
                      }
                    },
                    child: Text(_page < _pages.length - 1 ? 'つぎへ' : 'はじめる'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
