# デザインシステム資料

[design-system.html](design-system.html) をブラウザで開いてください。アイコン・UIの見本・プロモーション画像を含む単体のHTMLで、オフラインでも閲覧できます。末尾のコードブロックにはMarkdown全文を掲載し、「Markdownを保存」から同じ内容を保存できます。

## 更新する

- `design-system.md`: デザインシステムの原稿。HTMLへの掲載とダウンロードの共通ソースです。
- `design-system.template.html`: 資料のレイアウトと操作。
- `components.html`: 実装のCSSを読み込むUI見本。拡張機能の実処理は行いません。
- `design-system.html`: 生成済みの配布用ファイル。直接編集せず再生成します。

リポジトリのルートで実行します。既存の開発依存関係のみを使用します。

```sh
node scripts/build-design-system.js
node scripts/check-design-system.js
```

検証にはPlaywrightのChromiumが必要です（初回は `npx playwright install chromium`）。オフライン表示、UIの状態切り替え、狭い画面、動きを減らす設定、Markdownのダウンロード内容を確認します。確認用画像は `test-results/design-system/` に出力します。

色・UI・アイコン・プロモーション素材を変更した場合は、原稿との整合性を確認してHTMLを再生成してください。HTMLには生成時点のバージョンと参照コミットを記録します。画像とCSSを埋め込むため、完成したHTMLの閲覧にリポジトリやサーバーは不要です。
