import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'monster_repository.dart';

/// art_buckets/{id} の状態（企画書 §3.6）。ready になると imagePath が入る。
class ArtBucketState {
  const ArtBucketState({required this.status, required this.imagePath});
  final String status; // pending | generating | ready | failed
  final String? imagePath;
  bool get isReady => status == 'ready' && imagePath != null;
}

final artBucketProvider = StreamProvider.family<ArtBucketState?, String>((ref, bucketId) {
  if (bucketId.isEmpty) return Stream.value(null);
  return ref.watch(firestoreProvider).collection('art_buckets').doc(bucketId).snapshots().map((s) {
    if (!s.exists) return null;
    return ArtBucketState(status: (s.data()!['status'] as String?) ?? 'pending', imagePath: s.data()!['imagePath'] as String?);
  });
});

/// Storage のパス → ダウンロード URL（キャッシュ）。テストでは override する。
final artUrlProvider = FutureProvider.family<String?, String>((ref, path) async {
  if (path.isEmpty) return null;
  try {
    return await FirebaseStorage.instance.ref(path).getDownloadURL();
  } catch (_) {
    return null;
  }
});
