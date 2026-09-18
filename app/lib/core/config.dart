import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/growth.dart';

/// shared-config を assets/config/ から読む（tool/copy_config.sh でコピーされる）。
/// テストでは gameConfigProvider を overrideWith で差し替える。
final gameConfigProvider = FutureProvider<GameConfig>((ref) async {
  Future<dynamic> load(String name) async =>
      jsonDecode(await rootBundle.loadString('assets/config/$name'));
  final results = await Future.wait([
    load('constants.json'),
    load('personalities.json'),
    load('growth_curves.json'),
  ]);
  return GameConfig(
    constants: results[0] as Map<String, dynamic>,
    personalities: results[1] as List<dynamic>,
    curves: results[2] as Map<String, dynamic>,
  );
});
