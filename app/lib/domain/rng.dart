// xorshift128 乱数。仕様は shared-config/README.md。
// tools/growth_ref.py（参照実装）と bit 単位で一致させること。
// 純 Dart（Flutter 非依存）。
import 'dart:convert';

import 'package:crypto/crypto.dart';

const int _mask = 0xFFFFFFFF;

class XorShift128 {
  XorShift128(String seedHex) {
    if (!RegExp(r'^[0-9a-fA-F]{32}$').hasMatch(seedHex)) {
      throw ArgumentError('seedHex must be 32 hex chars');
    }
    _x = int.parse(seedHex.substring(0, 8), radix: 16);
    _y = int.parse(seedHex.substring(8, 16), radix: 16);
    _z = int.parse(seedHex.substring(16, 24), radix: 16);
    _w = int.parse(seedHex.substring(24, 32), radix: 16);
    if ((_x | _y | _z | _w) == 0) _x = 1;
  }

  late int _x;
  late int _y;
  late int _z;
  late int _w;

  int nextU32() {
    final t = (_x ^ ((_x << 11) & _mask)) & _mask;
    _x = _y;
    _y = _z;
    _z = _w;
    _w = (_w ^ (_w >> 19) ^ (t ^ (t >> 8))) & _mask;
    return _w;
  }

  /// [0, 1)
  double nextDouble() => nextU32() / 4294967296.0;

  /// 両端を含む整数
  int randInt(int lo, int hi) => lo + (nextDouble() * (hi - lo + 1)).floor();

  double randRange(double lo, double hi) => lo + nextDouble() * (hi - lo);
}

/// 企画書 §16.1: sha256(label|color|userId|yyyymmdd|nonce) の先頭 16 バイト
String seedFromParts(String label, String colorHex, String userId, String yyyymmdd, String nonce) {
  final s = [label, colorHex, userId, yyyymmdd, nonce].join('|');
  return sha256.convert(utf8.encode(s)).toString().substring(0, 32);
}

/// 四捨五入（常に切り上げ側）。言語間で round の挙動が違うため統一。
int floorHalfUp(double x) => (x + 0.5).floor();
