import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/admin/admin_screen.dart';
import '../features/auth/auth_provider.dart';
import '../features/battle/battle_models.dart';
import '../features/battle/battle_screen.dart';
import '../features/battle/friends_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/camera/camera_screen.dart';
import '../features/dex/dex_screen.dart';
import '../features/items/items_screen.dart';
import '../features/mentor/lineage_screen.dart';
import '../features/legal/legal_screen.dart';
import '../features/shop/shop_screen.dart';
import '../features/tutorial/tutorial_screen.dart';
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
  static const admin = '/admin'; // 管理者のみ（サーバー側で判定）
  static const friends = '/friends'; // S16
  static const battle = '/battle/:id'; // S11
  static const tutorial = '/tutorial'; // S02
  static const dex = '/dex'; // S12
  static const items = '/items'; // S13
  static const lineage = '/lineage/:id'; // S14
  static const legal = '/legal/:doc'; // S17 利用規約（terms）・プライバシーポリシー（privacy）・特定商取引法（tokusho）
  static const shop = '/shop'; // S15
}

/// チュートリアル完了フラグ（起動時に SharedPreferences から読む。テストでは override）
final tutorialDoneProvider = StateProvider<bool>((ref) => true);

final routerProvider = Provider<GoRouter>((ref) {
  final authNotifier = ref.watch(authProvider.notifier);
  return GoRouter(
    initialLocation: AppRoutes.login,
    refreshListenable: authNotifier,
    redirect: (context, state) {
      final signedIn = ref.read(authProvider).state.signedIn;
      final tutorialDone = ref.read(tutorialDoneProvider); // watch にするとルーターが作り直されるので read
      final goingToLogin = state.matchedLocation == AppRoutes.login;
      final goingToLegal = state.matchedLocation.startsWith('/legal/'); // 規約はサインイン前でも読める
      if (!signedIn && !goingToLogin && !goingToLegal) return AppRoutes.login;
      if (signedIn && goingToLogin) return AppRoutes.home;
      if (signedIn && state.matchedLocation == AppRoutes.home && !tutorialDone) return AppRoutes.tutorial;
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
      GoRoute(path: AppRoutes.admin, builder: (_, __) => const AdminScreen()),
      GoRoute(path: AppRoutes.friends, builder: (_, __) => const FriendsScreen()),
      GoRoute(path: AppRoutes.tutorial, builder: (_, __) => const TutorialScreen()),
      GoRoute(path: AppRoutes.dex, builder: (_, __) => const DexScreen()),
      GoRoute(path: AppRoutes.items, builder: (_, __) => const ItemsScreen()),
      GoRoute(path: AppRoutes.lineage, builder: (_, state) => LineageScreen(monsterId: state.pathParameters['id']!)),
      GoRoute(path: AppRoutes.legal, builder: (_, state) => LegalScreen(doc: state.pathParameters['doc']!)),
      GoRoute(path: AppRoutes.shop, builder: (_, __) => const ShopScreen()),
      GoRoute(
        path: AppRoutes.battle,
        builder: (_, state) => BattleScreen(battleId: state.pathParameters['id']!, record: state.extra is BattleRecord ? state.extra as BattleRecord : null),
      ),
    ],
  );
});
