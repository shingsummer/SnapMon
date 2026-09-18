import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'art_provider.dart';
import 'models.dart';
import 'monster_repository.dart';

/// モンスターの絵（企画書 §3.6）。
/// アートバケットが ready なら共有アート（Storage）＋個体差の色相・彩度シフト、
/// それまでは family × element のプレースホルダ SVG。
class MonsterArt extends ConsumerWidget {
  const MonsterArt({super.key, required this.monster, this.size = 160, this.showPendingBadge = false});

  final Monster monster;
  final double size;
  final bool showPendingBadge;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bucket = ref.watch(artBucketProvider(monster.artBucketId)).value;
    final url = bucket != null && bucket.isReady ? ref.watch(artUrlProvider(bucket.imagePath!)).value : null;
    final placeholder = SvgPicture.asset(monster.placeholderAsset, width: size, height: size, placeholderBuilder: (_) => SizedBox(width: size, height: size));
    if (url == null) {
      if (!showPendingBadge || bucket == null || bucket.isReady) return placeholder;
      return Stack(
        alignment: Alignment.bottomRight,
        children: [
          placeholder,
          Padding(
            padding: const EdgeInsets.all(6),
            child: bucket.status == 'failed'
                ? ActionChip(
                    key: const Key('retry-art'),
                    visualDensity: VisualDensity.compact,
                    avatar: const Icon(Icons.refresh, size: 16),
                    label: const Text('仮の姿・もう一度描く'),
                    onPressed: () async {
                      final messenger = ScaffoldMessenger.maybeOf(context);
                      try {
                        final outcome = await ref.read(monsterApiProvider).retryArtBucket(monster.artBucketId);
                        messenger?.showSnackBar(SnackBar(content: Text(outcome == 'generated' ? '絵ができた！' : '描けなかった（$outcome）')));
                      } on MonsterApiException catch (e) {
                        messenger?.showSnackBar(SnackBar(content: Text(e.message)));
                      }
                    },
                  )
                : const Chip(visualDensity: VisualDensity.compact, label: Text('絵を描いています…')),
          ),
        ],
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.125),
      child: ColorFiltered(
        colorFilter: ColorFilter.matrix(hueSaturationMatrix(monster.artTint.hueShift.toDouble(), monster.artTint.satShift)),
        child: Image.network(
          url,
          width: size,
          height: size,
          fit: BoxFit.cover,
          gaplessPlayback: true,
          loadingBuilder: (_, child, progress) => progress == null ? child : placeholder,
          errorBuilder: (_, __, ___) => placeholder,
        ),
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
  // 色相回転
  final h = <double>[
    lr + cosA * (1 - lr) + sinA * (-lr), lg + cosA * (-lg) + sinA * (-lg), lb + cosA * (-lb) + sinA * (1 - lb),
    lr + cosA * (-lr) + sinA * 0.143, lg + cosA * (1 - lg) + sinA * 0.140, lb + cosA * (-lb) + sinA * (-0.283),
    lr + cosA * (-lr) + sinA * (-(1 - lr)), lg + cosA * (-lg) + sinA * lg, lb + cosA * (1 - lb) + sinA * lb,
  ];
  // 彩度
  final s = 1 + satShift;
  final sat = <double>[
    lr + (1 - lr) * s, lg - lg * s, lb - lb * s,
    lr - lr * s, lg + (1 - lg) * s, lb - lb * s,
    lr - lr * s, lg - lg * s, lb + (1 - lb) * s,
  ];
  // 合成: sat × h
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
