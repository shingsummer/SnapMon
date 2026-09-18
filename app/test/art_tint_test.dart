import 'package:flutter_test/flutter_test.dart';
import 'package:snapmon/features/monster/monster_art.dart';

void main() {
  test('zero hue/sat shift is the identity matrix', () {
    final m = hueSaturationMatrix(0, 0);
    const identity = <double>[1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
    for (var i = 0; i < 20; i++) {
      expect(m[i], closeTo(identity[i], 1e-9), reason: 'index $i');
    }
  });

  test('rows of the color part sum to about 1 (luminance preserved for gray)', () {
    for (final hue in [-8.0, 5.0, 8.0]) {
      final m = hueSaturationMatrix(hue, 0.1);
      for (var r = 0; r < 3; r++) {
        final sum = m[r * 5] + m[r * 5 + 1] + m[r * 5 + 2];
        expect(sum, closeTo(1, 1e-6), reason: 'hue $hue row $r');
      }
    }
  });

  test('saturation shift of -1 collapses to grayscale weights', () {
    final m = hueSaturationMatrix(0, -1);
    expect(m[0], closeTo(0.213, 1e-9));
    expect(m[1], closeTo(0.715, 1e-9));
    expect(m[2], closeTo(0.072, 1e-9));
    expect(m[5], closeTo(0.213, 1e-9));
  });
}
