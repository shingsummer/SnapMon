import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// 端末内前処理（企画書 §3.1 ①）: EXIF の回転を焼き込み、長辺 1024px に縮小、JPEG 再エンコード。
/// 再エンコードで EXIF（位置情報など）は落ちる。純 Dart なので compute() で別 isolate に投げられる。
Uint8List prepareImage(Uint8List src, {int maxSide = 1024, int quality = 85}) {
  img.Image? decoded;
  try {
    decoded = img.decodeImage(src);
  } catch (_) {
    decoded = null;
  }
  if (decoded == null) throw const FormatException('画像を読み込めませんでした');
  var image = img.bakeOrientation(decoded);
  final longest = image.width > image.height ? image.width : image.height;
  if (longest > maxSide) {
    final scale = maxSide / longest;
    image = img.copyResize(
      image,
      width: (image.width * scale).round(),
      height: (image.height * scale).round(),
      interpolation: img.Interpolation.average,
    );
  }
  return Uint8List.fromList(img.encodeJpg(image, quality: quality));
}

/// 顔検出の抽象。実装は ML Kit（端末内）。テストではフェイク。
abstract class FaceChecker {
  Future<int> countFaces(String imagePath);
  Future<void> dispose();
}
