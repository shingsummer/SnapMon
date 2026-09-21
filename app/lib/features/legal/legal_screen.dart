import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// 利用規約・プライバシーポリシーの表示（S17）。本文は docs/legal/*.md を tool/copy_config.sh で
/// assets/legal/ にコピーしたものを読む（外部ライブラリなしの簡易 Markdown 表示: 見出し・箇条書き・表・太字）。
class LegalScreen extends StatelessWidget {
  const LegalScreen({super.key, required this.doc, this.textOverride});

  /// 'terms' | 'privacy'
  final String doc;

  /// テスト用（assets を読まずに本文を渡す）
  final String? textOverride;

  static const titles = {'terms': '利用規約', 'privacy': 'プライバシーポリシー'};

  Future<String> _load() async {
    if (textOverride != null) return textOverride!;
    return rootBundle.loadString('assets/legal/$doc.md');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(titles[doc] ?? doc)),
      body: FutureBuilder<String>(
        future: _load(),
        builder: (context, snap) {
          if (snap.hasError) return Center(child: Text('読み込めませんでした: ${snap.error}'));
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          return SelectionArea(child: ListView(padding: const EdgeInsets.all(16), children: renderMarkdown(context, snap.data!)));
        },
      ),
    );
  }

  /// ごく簡単な Markdown → ウィジェット変換。規約文書に出てくる記法だけ対応。
  static List<Widget> renderMarkdown(BuildContext context, String md) {
    final theme = Theme.of(context);
    final out = <Widget>[];
    final lines = md.split('\n');
    var i = 0;
    while (i < lines.length) {
      final line = lines[i];
      if (line.trim().isEmpty) {
        i++;
        continue;
      }
      final h = RegExp(r'^(#{1,3})\s+(.*)$').firstMatch(line);
      if (h != null) {
        final level = h.group(1)!.length;
        final style = level == 1 ? theme.textTheme.titleLarge : level == 2 ? theme.textTheme.titleMedium : theme.textTheme.titleSmall;
        out.add(Padding(padding: EdgeInsets.only(top: level == 1 ? 0 : 20, bottom: 8), child: Text(h.group(2)!, style: style?.copyWith(fontWeight: FontWeight.bold))));
        i++;
        continue;
      }
      if (line.startsWith('|')) {
        final rows = <List<String>>[];
        while (i < lines.length && lines[i].startsWith('|')) {
          final cells = lines[i].trim().replaceAll(RegExp(r'^\||\|$'), '').split('|').map((c) => c.trim()).toList();
          if (!cells.every((c) => RegExp(r'^:?-+:?$').hasMatch(c))) rows.add(cells);
          i++;
        }
        out.add(Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Table(
            border: TableBorder.all(color: theme.colorScheme.outlineVariant),
            defaultVerticalAlignment: TableCellVerticalAlignment.top,
            children: [
              for (var r = 0; r < rows.length; r++)
                TableRow(
                  decoration: r == 0 ? BoxDecoration(color: theme.colorScheme.surfaceContainerHighest) : null,
                  children: [for (final c in rows[r]) Padding(padding: const EdgeInsets.all(6), child: _inline(c, theme.textTheme.bodySmall, bold: r == 0))],
                ),
            ],
          ),
        ));
        continue;
      }
      final li = RegExp(r'^(\s*)(-|\d+\.)\s+(.*)$').firstMatch(line);
      if (li != null) {
        final indent = li.group(1)!.length >= 3 ? 24.0 : 0.0;
        final marker = li.group(2) == '-' ? '・' : '${li.group(2)} ';
        out.add(Padding(
          padding: EdgeInsets.only(left: 8 + indent, bottom: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Text(marker, style: theme.textTheme.bodyMedium), Expanded(child: _inline(li.group(3)!, theme.textTheme.bodyMedium))],
          ),
        ));
        i++;
        continue;
      }
      final para = <String>[line.trim()];
      i++;
      while (i < lines.length && lines[i].trim().isNotEmpty && !lines[i].startsWith('#') && !lines[i].startsWith('|') && RegExp(r'^(\s*)(-|\d+\.)\s+').firstMatch(lines[i]) == null) {
        para.add(lines[i].trim());
        i++;
      }
      out.add(Padding(padding: const EdgeInsets.only(bottom: 10), child: _inline(para.join(''), theme.textTheme.bodyMedium)));
    }
    return out;
  }

  /// **太字** だけ対応
  static Widget _inline(String text, TextStyle? style, {bool bold = false}) {
    final spans = <TextSpan>[];
    final re = RegExp(r'\*\*(.+?)\*\*');
    var last = 0;
    for (final m in re.allMatches(text)) {
      if (m.start > last) spans.add(TextSpan(text: text.substring(last, m.start)));
      spans.add(TextSpan(text: m.group(1), style: const TextStyle(fontWeight: FontWeight.bold)));
      last = m.end;
    }
    if (last < text.length) spans.add(TextSpan(text: text.substring(last)));
    return Text.rich(TextSpan(children: spans), style: bold ? style?.copyWith(fontWeight: FontWeight.bold) : style);
  }
}
