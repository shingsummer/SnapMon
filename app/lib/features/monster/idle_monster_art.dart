import 'package:flutter/material.dart';

import 'idle_motion.dart';
import 'models.dart';
import 'monster_art.dart';

/// 動く MonsterArt。性格に応じた待機モーション（idle_motion.dart）と、タップで「なでる」反応。
/// 一覧（牧場など）では使わず、詳細・誕生・トレーニング・ホームのパートナーで使う。
/// 端末の「アニメーションを減らす」設定が有効なら静止画にする。
class IdleMonsterArt extends StatefulWidget {
  const IdleMonsterArt({super.key, required this.monster, this.size = 160, this.showPendingBadge = false, this.reactToTap = true, this.onTap});

  final Monster monster;
  final double size;
  final bool showPendingBadge;
  final bool reactToTap;
  final VoidCallback? onTap;

  @override
  State<IdleMonsterArt> createState() => _IdleMonsterArtState();
}

class _IdleMonsterArtState extends State<IdleMonsterArt> with TickerProviderStateMixin {
  late IdleMotion _motion = _motionFor(widget.monster);
  late final AnimationController _idle = AnimationController(vsync: this, duration: Duration(milliseconds: _motion.periodMs));
  late final AnimationController _react = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
  int _cycle = 0;

  static IdleMotion _motionFor(Monster m) => IdleMotion.forMonster(personality: m.personality, revealed: m.personalityRevealed);

  @override
  void initState() {
    super.initState();
    _idle.addStatusListener((s) {
      if (s == AnimationStatus.completed) {
        _cycle++;
        _idle.forward(from: 0);
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncRunning();
  }

  @override
  void didUpdateWidget(covariant IdleMonsterArt old) {
    super.didUpdateWidget(old);
    final m = _motionFor(widget.monster);
    if (m != _motion) {
      _motion = m;
      _idle.duration = Duration(milliseconds: m.periodMs);
    }
    _syncRunning();
  }

  bool get _reduceMotion => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

  void _syncRunning() {
    // 孵化待ちは卵自身が揺れるので待機モーションは付けない
    final shouldRun = !_reduceMotion && !widget.monster.isHatching;
    if (shouldRun && !_idle.isAnimating) _idle.forward(from: _idle.value);
    if (!shouldRun && _idle.isAnimating) _idle.stop();
  }

  @override
  void dispose() {
    _idle.dispose();
    _react.dispose();
    super.dispose();
  }

  void _onTap() {
    widget.onTap?.call();
    if (widget.reactToTap && !_reduceMotion) _react.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) {
    final art = MonsterArt(monster: widget.monster, size: widget.size, showPendingBadge: widget.showPendingBadge);
    final child = AnimatedBuilder(
      animation: Listenable.merge([_idle, _react]),
      child: art,
      builder: (context, child) {
        final idle = _idle.isAnimating || _idle.value > 0 ? IdlePose.at(_motion, _idle.value, _cycle) : const IdlePose();
        final react = reactPose(_react.value);
        final s = widget.size;
        final matrix = Matrix4.identity()
          ..translateByDouble((idle.dx + react.dx) * s, (idle.dy + react.dy) * s, 0, 1)
          ..rotateZ(idle.angle + react.angle)
          ..scaleByDouble(idle.scaleX * react.scaleX, idle.scaleY * react.scaleY, 1, 1);
        return Transform(transform: matrix, alignment: Alignment.bottomCenter, child: child);
      },
    );
    return GestureDetector(key: const Key('idle-art'), behavior: HitTestBehavior.opaque, onTap: _onTap, child: child);
  }
}
