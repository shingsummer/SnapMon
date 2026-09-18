import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:snapmon/features/camera/image_prep.dart';

void main() {
  test('prepareImage shrinks the long side to 1024 and re-encodes as JPEG', () {
    final big = img.Image(width: 3000, height: 2000);
    img.fill(big, color: img.ColorRgb8(30, 120, 220));
    final out = prepareImage(Uint8List.fromList(img.encodePng(big)));
    final decoded = img.decodeJpg(out)!;
    expect(decoded.width, 1024);
    expect(decoded.height, 683);
    expect(decoded.exif.isEmpty, isTrue);
  });

  test('prepareImage keeps small images as-is (size)', () {
    final small = img.Image(width: 400, height: 300);
    final out = prepareImage(Uint8List.fromList(img.encodePng(small)));
    final decoded = img.decodeJpg(out)!;
    expect(decoded.width, 400);
    expect(decoded.height, 300);
  });

  test('prepareImage rejects garbage', () {
    expect(() => prepareImage(Uint8List.fromList([1, 2, 3])), throwsFormatException);
  });
}
