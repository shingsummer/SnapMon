import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_provider.dart';
import '../features/auth/login_screen.dart';
import '../features/camera/camera_screen.dart';
import '../features/home/home_screen.dart';
import '../features/monster/birth_screen.dart';
import '../features/monster/detail_screen.dart';
import '../features/monster/models.dart';
import '../features/monster/ranch_screen.dart';
import '../features/training/training_screen.dart';

/// 画面ID は企画書 §8.1 に対応。
class AppRoutes {
  static const login = '/login'; // S01
  static const home = '/home'; // S03
  static const camera = '/camera'; // S04
  static const birth = '/birth/:id'; // S05
  static const ranch = '/ranch'; // S06
  static const monster = '/monster/:id'; // S07
  static const train = '/train/:id'; // S08
}

final routerProvider = Provider<GoRouter>((ref) {
  final authNotifier = ref.watch(authProvider.notifier);
  return GoRouter(
    initialLocation: AppRoutes.login,
    refreshListenable: authNotifier,
    redirect: (context, state) {
      final signedIn = ref.read(authProvider).state.signedIn;
      final goingToLogin = state.matchedLocation == AppRoutes.login;
      if (!signedIn && !goingToLogin) return AppRoutes.login;
      if (signedIn && goingToLogin) return AppRoutes.home;
      return null;
    },
    routes: [
      GoRoute(path: AppRoutes.login, builder: (_, __) => const LoginScreen()),
      GoRoute(path: AppRoutes.home, builder: (_, __) => const HomeScreen()),
      GoRoute(path: AppRoutes.camera, builder: (_, __) => const CameraScreen()),
      GoRoute(
        path: AppRoutes.birth,
        builder: (_, state) => BirthScreen(
          monsterId: state.pathParameters['id']!,
          result: state.extra is GenerateResult ? state.extra as GenerateResult : null,
        ),
      ),
      GoRoute(path: AppRoutes.ranch, builder: (_, __) => const RanchScreen()),
      GoRoute(path: AppRoutes.monster, builder: (_, state) => MonsterDetailScreen(monsterId: state.pathParameters['id']!)),
      GoRoute(path: AppRoutes.train, builder: (_, state) => TrainingScreen(monsterId: state.pathParameters['id']!)),
    ],
  );
});
