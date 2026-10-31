# Googleカレンダーへの直接リンク

更新日：2026-11-01。

## 採用した方式

共通UIの「Googleカレンダーで開く」を、`https://calendar.google.com/calendar/r/eventedit?action=TEMPLATE…` への通常の `<a>` にする。見た目は従来の主ボタンを維持し、実際のクリック／タップをブラウザ・OSへ渡す。JavaScriptによる代理クリックやバックグラウンドからの `tabs.create` は新しいUIでは使わない。

`target="_blank"` と `rel="noopener noreferrer"` を指定し、元のページと下書きを保持する。アプリの有無やiOS側のリンク設定に応じてアプリまたはWebが開く。遷移先の成功を確定できないため「カレンダーを開きました」とは表示しない。更新前から注入されているUI向けの旧メッセージ処理は、同じGoogleオリジンと予定作成パスだけに限定して残す。

## 根拠

- [Googleの公開AASA](https://calendar.google.com/apple-app-site-association) は、配布版 `EQHXZ8M8AV.com.google.calendar` の Universal Links に `/calendar/render` と `/calendar/r/*` を含む。
- [Google公式の予定作成リンク](https://developers.google.com/workspace/calendar/api/concepts/inviting-attendees-to-events#provide_a_link_for_users_to_add_the_event) は `/calendar/r/eventedit?action=TEMPLATE…`。
- [Appleの説明](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content) と [Safari拡張の開発者フォーラム](https://developer.apple.com/forums/thread/776365) を参考に、ページ内の `<a>` を直接タップする方式を検証した。
- 非公開の独自URLスキームや、アプリの有無を推測してタイマーで別URLを開く処理は使用しない。

## 確認結果

- iPhone実機：利用者が旧 `/calendar/render` と公式 `/calendar/r/eventedit` の直接リンクを比較。どちらもGoogleカレンダーアプリが直接起動し、データが受け渡されるとの報告あり。これを受け公式パスを採用。比較用の2リンクとビルドフラグは撤去した。
- Googleカレンダー未インストールのiPhoneシミュレーター（iOS 27）：インストール済みアプリ一覧に `com.google.calendar` がないことを確認し、`simctl openurl` で公式URLを開いた。SafariでGoogleカレンダーの案内・ログインページに到達。未ログインのため、ログイン後の予定入力画面とその値までは未確認。シート内リンクの実タップとは別の確認である。
- Chromium／WebKit・Chrome拡張の回帰テストでは外部通信を模擬し、実際のタップ／Enterで新しいページが開くこと、公式パス・各クエリ・`window.opener` の分離・元の下書き保持を確認する。OSによるアプリ起動の代用にはしない。

## 引き続き注意する点

OS側でWeb表示が選ばれている場合など、アプリがインストールされていてもWebが開くことがある。ログイン後の復元やGoogle側のUI変更は先方に依存する。予定はGoogle側で利用者が確認・保存し、拡張が自動保存することはない。
