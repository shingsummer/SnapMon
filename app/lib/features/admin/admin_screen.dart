import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/firebase_env.dart';
import '../monster/art_provider.dart';
import '../monster/monster_repository.dart';

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
  final _sampleCtrl = TextEditingController();
  String? _message;
  bool _busy = false;

  @override
  void dispose() {
    _bucketCtrl.dispose();
    _sampleCtrl.dispose();
    super.dispose();
  }

  Future<void> _call(String name, [Map<String, dynamic>? data]) async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final r = await functions().httpsCallable(name, options: HttpsCallableOptions(timeout: const Duration(seconds: 300))).call(data ?? {});
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
    final theme = Theme.of(context);
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
          const SizedBox(height: 24),
          Text('絵柄・コスト比較（同じ写真から品質違いで生成）', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          TextField(controller: _sampleCtrl, decoration: const InputDecoration(border: OutlineInputBorder(), labelText: 'モンスター ID')),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: _busy ? null : () => _call('generateArtSamplesFn', {'monsterId': _sampleCtrl.text.trim(), 'qualities': ['low', 'medium']}),
            child: const Text('低・中のサンプルを作る（約 8 円）'),
          ),
          const SizedBox(height: 8),
          const _SamplesList(),
          const SizedBox(height: 16),
          if (_busy) const Center(child: CircularProgressIndicator()),
          if (_message != null) Text(_message!),
          if (s != null) ...[
            _Row('バケット数', '${s['buckets']}'),
            _Row('ready / pending / failed', '${s['ready']} / ${s['pending']} / ${s['failed']}'),
            _Row('生成回数', '${s['generatedCount']}'),
            _Row('累計コスト (USD)', (s['costUsd'] as num?)?.toStringAsFixed(3) ?? '-'),
            _Row('個体アート 生成数 / コスト (USD)', '${s['individualCount'] ?? 0} / ${((s['individualCostUsd'] as num?) ?? 0).toStringAsFixed(3)}'),
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

/// art_samples を新しい順に並べ、低・中の画像を横に並べる
class _SamplesList extends ConsumerWidget {
  const _SamplesList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stream = ref.watch(firestoreProvider).collection('art_samples').orderBy('createdAt', descending: true).limit(10).snapshots();
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: stream,
      builder: (context, snap) {
        final docs = snap.data?.docs ?? const [];
        if (docs.isEmpty) return const Text('サンプルはまだありません');
        return Column(
          children: [
            for (final d in docs)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${d.data()['sourceLabel'] ?? ''}  (${d.id})', style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          for (final q in ['low', 'medium'])
                            if (((d.data()['samples'] as Map?)?[q] as Map?)?['path'] != null)
                              Expanded(child: _SampleImage(label: q, path: ((d.data()['samples'] as Map)[q] as Map)['path'] as String)),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _SampleImage extends ConsumerWidget {
  const _SampleImage({required this.label, required this.path});
  final String label;
  final String path;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final url = ref.watch(artUrlProvider(path)).value;
    return Column(
      children: [
        Text(label == 'low' ? '低（約 1.5 円）' : '中（約 6 円）'),
        const SizedBox(height: 4),
        AspectRatio(
          aspectRatio: 1,
          child: url == null ? const Center(child: CircularProgressIndicator()) : Image.network(url, fit: BoxFit.cover),
        ),
      ],
    );
  }
}
