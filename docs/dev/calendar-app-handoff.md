# iPhoneのGoogleカレンダー直接遷移の検証

調査日：2026-11-01。実機結果は未確認。通常版の受け渡しは変更していない。

## 確認できたこと

- 現在は `browser.tabs.create` で `https://calendar.google.com/calendar/render?action=TEMPLATE…` を開く。
- [Googleの公開AASA](https://calendar.google.com/apple-app-site-association) では、配布版 `EQHXZ8M8AV.com.google.calendar` の Universal Links に `/calendar/render` と `/calendar/r/*` が含まれる。これはアプリへのルーティング対象であることを示すが、予定の全パラメータの受け渡し成功を保証しない。
- [Google公式の予定作成リンク](https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#provide_a_link_for_users_to_add_the_event) は `/calendar/r/eventedit?action=TEMPLATE…`。
- [Appleの説明](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content) と [Safari拡張についての開発者フォーラム](https://developer.apple.com/forums/thread/776365) から、ページ内の `<a>` を直接タップする方法を試す。バックグラウンドで開く場合と同じ結果とは限らない。
- 独自URLスキームでの予定作成は、Google公式仕様を確認できなかったため採用しない。

## 検証ビルド

```sh
VITE_CALENDAR_HANDOFF_PROBE=true npm run prepare:safari
```

このビルドだけ、確認画面の通常ボタンの下に2つの直接リンクを追加する。「現在のURL」と「公式の作成URL」はパスだけ異なり、タイトル書式・日時・場所・詳細のクエリは同一。実際のタップによる遷移を維持するためクリックをJavaScriptで代行しない。通常のChrome/Safariビルドにはリンクが含まれない。

## 実機で確認すること

GoogleカレンダーをインストールしたiPhoneで、架空の予定を使って比較する。保存は不要。

1. 通常ボタン：Safari経由になることを確認。
2. 直接リンク2種類：アプリが直接開くか、Safari経由か、確認ダイアログが出るかを記録。
3. 開いた予定のタイトル・日時（時間帯／終日／移動込み）・場所・詳細と末尾URLが保たれているかを確認。
4. Safariに戻り、元のページと取得内容が残るかを確認。
5. 採用前にはアプリ未インストール時のWebフォールバックも確認する。既存のOS側のリンク選択によって結果が変わり得る。

Chromium/WebKitの自動テストではリンクの表示条件と全クエリの一致を確認する。OSによるアプリ起動やアプリ側の入力結果は自動テストの成功だけでは確認済みとしない。
