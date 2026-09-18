import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import 'models.dart';

/// モンスターの絵。P3 でアートバケット画像（Storage）に切り替えるまではプレースホルダ SVG。
class MonsterArt extends StatelessWidget {
  const MonsterArt({super.key, required this.monster, this.size = 160});

  final Monster monster;
  final double size;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      monster.placeholderAsset,
      width: size,
      height: size,
      placeholderBuilder: (_) => SizedBox(width: size, height: size),
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
