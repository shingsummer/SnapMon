import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'art_provider.dart';
import 'models.dart';
import 'monster_repository.dart';

/// モンスターの絵（企画書 §3.6、しぴさん方針: 撮った写真からその個体の絵を生成）。
/// 優先順位: 個体アート（写真参照） → 共有バケット（＋色相・彩度シフト） → プレースホルダ SVG。
/// 個体アートを待っている間は卵（孵化待ち）を表示する。
class MonsterArt extends ConsumerWidget {
  const MonsterArt({super.key, required this.monster, this.size = 160, this.showPendingBadge = false});

  final Monster monster;
  final double size;
  final bool showPendingBadge;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final placeholder = SvgPicture.asset(monster.placeholderAsset, width: size, height: size, placeholderBuilder: (_) => SizedBox(width: size, height: size));

    // 1. 個体アート
    if (monster.hasIndividualArt) {
      final url = ref.watch(artUrlProvider(monster.artImagePath!)).value;
      if (url != null) return _image(url, placeholder, tint: false);
      return placeholder;
    }

    // 2. 孵化待ち（写真参照の生成中）
    if (monster.isHatching) {
      return HatchingEgg(size: size, label: showPendingBadge ? '孵化を待っています…' : null);
    }

    // 3. 共有バケット
    final bucket = ref.watch(artBucketProvider(monster.artBucketId)).value;
    final url = bucket != null && bucket.isReady ? ref.watch(artUrlProvider(bucket.imagePath!)).value : null;
    final failedIndividual = monster.artStatus == 'failed' || monster.artStatus == 'fallback';
    if (url == null) {
      if (!showPendingBadge || bucket == null) return placeholder;
      return _withBadge(context, ref, placeholder, failedIndividual: failedIndividual, bucketFailed: bucket.status == 'failed', bucketReady: bucket.isReady);
    }
    final img = _image(url, placeholder, tint: true);
    if (!showPendingBadge || !failedIndividual) return img;
    return _withBadge(context, ref, img, failedIndividual: true, bucketFailed: false, bucketReady: true);
  }

  Widget _image(String url, Widget placeholder, {required bool tint}) {
    final image = Image.network(
      url,
      width: size,
      height: size,
      fit: BoxFit.cover,
      gaplessPlayback: true,
      loadingBuilder: (_, child, progress) => progress == null ? child : placeholder,
      errorBuilder: (_, __, ___) => placeholder,
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.125),
      child: tint
          ? ColorFiltered(colorFilter: ColorFilter.matrix(hueSaturationMatrix(monster.artTint.hueShift.toDouble(), monster.artTint.satShift)), child: image)
          : image,
    );
  }

  Widget _withBadge(BuildContext context, WidgetRef ref, Widget child, {required bool failedIndividual, required bool bucketFailed, required bool bucketReady}) {
    Future<void> retry() async {
      final messenger = ScaffoldMessenger.maybeOf(context);
      try {
        final api = ref.read(monsterApiProvider);
        final outcome = failedIndividual ? await api.retryMonsterArt(monster.id) : await api.retryArtBucket(monster.artBucketId);
        messenger?.showSnackBar(SnackBar(content: Text(outcome == 'generated' ? '絵ができた！' : '描けなかった（$outcome）')));
      } on MonsterApiException catch (e) {
        messenger?.showSnackBar(SnackBar(content: Text(e.message)));
      }
    }

    final canRetry = failedIndividual || bucketFailed;
    return Stack(
      alignment: Alignment.bottomRight,
      children: [
        child,
        Padding(
          padding: const EdgeInsets.all(6),
          child: canRetry
              ? ActionChip(
                  key: const Key('retry-art'),
                  visualDensity: VisualDensity.compact,
                  avatar: const Icon(Icons.refresh, size: 16),
                  label: Text(bucketReady ? '仮の姿・写真から描き直す' : '仮の姿・もう一度描く'),
                  onPressed: retry,
                )
              : const Chip(visualDensity: VisualDensity.compact, label: Text('絵を描いています…')),
        ),
      ],
    );
  }
}

/// 孵化待ちの卵。ゆっくり揺れる。
class HatchingEgg extends StatefulWidget {
  const HatchingEgg({super.key, required this.size, this.label});
  final double size;
  final String? label;

  @override
  State<HatchingEgg> createState() => _HatchingEggState();
}

class _HatchingEggState extends State<HatchingEgg> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.size;
    return SizedBox(
      width: s,
      height: s,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedBuilder(
            animation: _c,
            builder: (_, __) => Transform.rotate(
              angle: (_c.value - 0.5) * 0.25,
              child: Container(
                width: s * 0.42,
                height: s * 0.54,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3D6),
                  border: Border.all(color: const Color(0xFFD9C38F), width: 3),
                  borderRadius: BorderRadius.all(Radius.elliptical(s * 0.21, s * 0.27)),
                ),
              ),
            ),
          ),
          if (widget.label != null) ...[
            SizedBox(height: s * 0.06),
            Text(widget.label!, style: Theme.of(context).textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

/// family / element だけ分かっている段階（誕生直後）用
class FamilyArt extends StatelessWidget {
  const FamilyArt({super.key, required this.family, required this.element, this.size = 200});

  final String family;
  final String element;
  final double size;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      'assets/art/placeholder/${family}_$element.svg',
      width: size,
      height: size,
      placeholderBuilder: (_) => SizedBox(width: size, height: size),
    );
  }
}

/// 色相回転（度）と彩度シフト（-1..1）の 4x5 カラーマトリクス。純 Dart、テスト対象。
List<double> hueSaturationMatrix(double hueDeg, double satShift) {
  final rad = hueDeg * math.pi / 180;
  final cosA = math.cos(rad);
  final sinA = math.sin(rad);
  const lr = 0.213, lg = 0.715, lb = 0.072;
  final h = <double>[
    lr + cosA * (1 - lr) + sinA * (-lr), lg + cosA * (-lg) + sinA * (-lg), lb + cosA * (-lb) + sinA * (1 - lb),
    lr + cosA * (-lr) + sinA * 0.143, lg + cosA * (1 - lg) + sinA * 0.140, lb + cosA * (-lb) + sinA * (-0.283),
    lr + cosA * (-lr) + sinA * (-(1 - lr)), lg + cosA * (-lg) + sinA * lg, lb + cosA * (1 - lb) + sinA * lb,
  ];
  final s = 1 + satShift;
  final sat = <double>[
    lr + (1 - lr) * s, lg - lg * s, lb - lb * s,
    lr - lr * s, lg + (1 - lg) * s, lb - lb * s,
    lr - lr * s, lg - lg * s, lb + (1 - lb) * s,
  ];
  final m = List<double>.filled(9, 0);
  for (var r = 0; r < 3; r++) {
    for (var c = 0; c < 3; c++) {
      m[r * 3 + c] = sat[r * 3] * h[c] + sat[r * 3 + 1] * h[3 + c] + sat[r * 3 + 2] * h[6 + c];
    }
  }
  return [
    m[0], m[1], m[2], 0, 0,
    m[3], m[4], m[5], 0, 0,
    m[6], m[7], m[8], 0, 0,
    0, 0, 0, 1, 0,
  ];
}
