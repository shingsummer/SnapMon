import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/firebase_env.dart';

/// 管理者用（企画書 §14.2 コスト監視、§3.6 事前生成）。ホームのタイトル長押しで開く。
/// サーバー側で ADMIN_UIDS に含まれる uid だけが呼べる。
class AdminScreen extends ConsumerStatefulWidget {
  const AdminScreen({super.key});

  @override
  ConsumerState<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends ConsumerState<AdminScreen> {
  Map<String, dynamic>? _stats;
  final _bucketCtrl = TextEditingController();
  String? _message;
  bool _busy = false;

  Future<void> _call(String name, [Map<String, dynamic>? data]) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final r = await functions().httpsCallable(name, options: HttpsCallableOptions(timeout: const Duration(seconds: 120))).call(data ?? {});
      final payload = (r.data as Map)['data'];
      setState(() {
        if (name == 'getArtStats') {
          _stats = Map<String, dynamic>.from(payload as Map);
        } else {
          _message = '$name: $payload';
        }
      });
    } on FirebaseFunctionsException catch (e) {
      setState(() => _message = '${e.code}: ${e.message}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _stats;
    return Scaffold(
      appBar: AppBar(title: const Text('管理（アート生成）')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          FilledButton(onPressed: _busy ? null : () => _call('getArtStats'), child: const Text('統計を取得')),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _busy ? null : () => _call('pregenerateArt', {'limit': 300}),
            child: const Text('事前生成 252 バケットを投入（生成コストが発生）'),
          ),
          const SizedBox(height: 16),
          TextField(controller: _bucketCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'バケット ID（例: aqua_none_water_h6l1）')),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _busy ? null : () => _call('retryArtBucket', {'bucketId': _bucketCtrl.text.trim()}),
            child: const Text('このバケットを再生成'),
          ),
          const SizedBox(height: 16),
          if (_busy) const Center(child: CircularProgressIndicator()),
          if (_message != null) Text(_message!),
          if (s != null) ...[
            _Row('バケット数', '${s['buckets']}'),
            _Row('ready / pending / failed', '${s['ready']} / ${s['pending']} / ${s['failed']}'),
            _Row('生成回数', '${s['generatedCount']}'),
            _Row('累計コスト (USD)', (s['costUsd'] as num?)?.toStringAsFixed(3) ?? '-'),
            _Row('誕生時の参照回数', '${s['totalHits']}'),
            _Row('キャッシュ命中率', '${(((s['cacheHitRate'] as num?) ?? 0) * 100).toStringAsFixed(1)} %'),
            _Row('1 バケットあたりコスト (USD)', _perBucket(s)),
          ],
        ],
      ),
    );
  }

  String _perBucket(Map<String, dynamic> s) {
    final n = (s['generatedCount'] as num?) ?? 0;
    final c = (s['costUsd'] as num?) ?? 0;
    return n == 0 ? '-' : (c / n).toStringAsFixed(3);
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => ListTile(dense: true, title: Text(label), trailing: Text(value));
}
