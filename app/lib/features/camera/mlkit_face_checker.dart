import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';

import 'image_prep.dart';

/// 端末内顔検出（企画書 §3.5）。顔があれば撮り直し要求。サーバー側でも Vision で二重に見る。
class MlKitFaceChecker implements FaceChecker {
  final FaceDetector _detector = FaceDetector(
    options: FaceDetectorOptions(performanceMode: FaceDetectorMode.fast, minFaceSize: 0.1),
  );

  @override
  Future<int> countFaces(String imagePath) async {
    final faces = await _detector.processImage(InputImage.fromFilePath(imagePath));
    return faces.length;
  }

  @override
  Future<void> dispose() => _detector.close();
}
