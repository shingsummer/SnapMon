import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../monster/monster_repository.dart';
import 'image_prep.dart';
import 'mlkit_face_checker.dart';

final faceCheckerProvider = Provider<FaceChecker>((ref) {
  final c = MlKitFaceChecker();
  ref.onDispose(c.dispose);
  return c;
});

/// S04 カメラ（企画書 §8.1）。撮影 → 顔チェック → 縮小 → generateMonster → S05 誕生演出へ。
class CameraScreen extends ConsumerStatefulWidget {
  const CameraScreen({super.key});

  @override
  ConsumerState<CameraScreen> createState() => _CameraScreenState();
}

enum _Phase { initializing, ready, checkingFace, generating, noCamera }

class _CameraScreenState extends ConsumerState<CameraScreen> {
  CameraController? _controller;
  _Phase _phase = _Phase.initializing;
  String? _error;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        setState(() => _phase = _Phase.noCamera);
        return;
      }
      final back = cameras.firstWhere((c) => c.lensDirection == CameraLensDirection.back, orElse: () => cameras.first);
      final controller = CameraController(back, ResolutionPreset.high, enableAudio: false);
      await controller.initialize();
      if (!mounted) return;
      setState(() {
        _controller = controller;
        _phase = _Phase.ready;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.noCamera;
        _error = 'カメラを起動できませんでした: $e';
      });
    }
  }

  Future<void> _shoot() async {
    final controller = _controller;
    if (controller == null || _phase != _Phase.ready) return;
    setState(() {
      _error = null;
      _phase = _Phase.checkingFace;
    });
    try {
      final shot = await controller.takePicture();
      final faces = await ref.read(faceCheckerProvider).countFaces(shot.path);
      if (faces > 0) {
        _fail('人の顔が写っています。物だけを撮ってください（撮影枠は減りません）');
        return;
      }
      setState(() => _phase = _Phase.generating);
      final raw = await File(shot.path).readAsBytes();
      final jpeg = await compute(prepareImage, raw);
      final result = await ref.read(monsterApiProvider).generate(jpeg);
      if (!mounted) return;
      context.go('/birth/${result.monsterId}', extra: result);
    } on MonsterApiException catch (e) {
      _fail(e.message);
    } catch (e) {
      _fail('うまくいきませんでした。もう一度撮ってみてください');
      debugPrint('shoot failed: $e');
    }
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _error = message;
      _phase = _Phase.ready;
    });
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final busy = _phase == _Phase.checkingFace || _phase == _Phase.generating;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('撮る'),
        leading: BackButton(onPressed: busy ? null : () => context.pop()),
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (_controller != null && _controller!.value.isInitialized)
            Center(child: CameraPreview(_controller!))
          else if (_phase == _Phase.noCamera)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(_error ?? 'カメラが見つかりません', style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
              ),
            )
          else
            const Center(child: CircularProgressIndicator()),
          if (busy)
            Container(
              color: Colors.black54,
              child: Center(
                child: _EggWaiting(
                  label: _phase == _Phase.checkingFace ? '写真をたしかめています…' : 'なにかが生まれようとしている…',
                ),
              ),
            ),
          if (_error != null && !busy)
            Positioned(
              left: 16,
              right: 16,
              bottom: 120,
              child: Material(
                color: theme.colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(_error!, style: TextStyle(color: theme.colorScheme.onErrorContainer)),
                ),
              ),
            ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Center(
            child: SizedBox(
              width: 76,
              height: 76,
              child: FloatingActionButton.large(
                key: const Key('shutter'),
                onPressed: _phase == _Phase.ready ? _shoot : null,
                shape: const CircleBorder(),
                child: const Icon(Icons.camera, size: 36),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 生成待ちの卵アニメーション（S04）。P3 で Lottie に差し替え予定。
class _EggWaiting extends StatefulWidget {
  const _EggWaiting({required this.label});
  final String label;

  @override
  State<_EggWaiting> createState() => _EggWaitingState();
}

class _EggWaitingState extends State<_EggWaiting> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedBuilder(
          animation: _c,
          builder: (_, __) => Transform.rotate(
            angle: (_c.value - 0.5) * 0.4,
            child: Container(
              width: 96,
              height: 120,
              decoration: const BoxDecoration(
                color: Color(0xFFFFF3D6),
                borderRadius: BorderRadius.all(Radius.elliptical(48, 60)),
              ),
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text(widget.label, style: const TextStyle(color: Colors.white, fontSize: 16)),
      ],
    );
  }
}
