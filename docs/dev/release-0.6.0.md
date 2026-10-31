# 0.6.0 公開準備

ChromeとSafariのコードを0.6.0に揃える。コードのリリース、Chrome Web Storeの公開、Appleの初回審査完了は別の工程とする。Safariの未確認項目を、Chrome向けZIPの生成成功だけで完了扱いにしない。

## Chrome Web Store

```sh
npm ci
npm run check
npm run test:ui
npm run test:e2e
npm run zip
```

提出ファイル：`.output/sche10le-0.6.0-chrome.zip`。ソースZIPやSafari用フォルダーはアップロードしない。

- 掲載説明：`store/listing/description.txt`。ページ内ドロワーへの変更とAI補完の提供停止を明記。
- 権限の理由：`store/listing/privacy-practices.md`。`activeTab`・`scripting`・`storage`のみ。
- ポリシー：ルートの `PRIVACY.md`。旧0.5.0のポリシーへのリンクを残す。
- スクリーンショット：`store/screenshots/`。`npm run build` の後、`node scripts/generate-store-screenshots.js` で実拡張とローカルのサンプルページから1280×800の4枚を生成する。撮影用コピーだけにlocalhost権限を追加し、配布用manifestは変えない。
- アイコン：`public/icons/128.png`。プロモーション：`store/promotional/`。
- PRのRegressionを通し、mainへのマージ後にLive event sitesを一度確認する。CI標準の除外理由も併せて確認する。
- タグを作る直前に作業ツリー、対象コミット、バージョン、ZIP内manifest、含まれるファイルを確認する。未検証のネイティブ配布をリリース済みと表記しない。

## Appleの初回提出

現在の `dev.sche10le.prototype` は実機開発用の仮ID。正式な登録や配布用署名は未完了。

1. **Apple Developer Program**：有料登録の有効化を確認する。登録・本人確認・規約同意・支払いはアカウント所有者が行う。
2. **正式ID**：アプリと拡張の識別子を決め、Teamと合わせて設定する。候補は `com.hatappo.sche10le` とその末尾 `.Extension`。利用可能性は登録時に確認する。初回アップロード後は同じアプリのBundle IDを変更できないので、仮IDのままアップロードしない。
3. **App Store Connect**：アプリ名Sche10le、主言語日本語、正式Bundle ID、SKUを登録。iOSとmacOSを同じレコードで管理する場合は同じBundle IDでプラットフォームを追加し、ビルドを個別に提出する。価格・公開地域は所有者が決める。
4. **配布設定**：対応OS下限、Macのカテゴリ、必要なプライバシーマニフェスト／Required Reason APIの有無、輸出コンプライアンスの回答を実装と照合する。現在の生成時下限（iOSアプリ17／拡張15、macOS12）は未確定。署名を通す目的で権限やEntitlementを増やさない。
5. **実機確認**：[チェックリスト](safari-device-checklist.md)の未確認範囲を埋める。iPhoneの基本操作とGoogleアプリへの受け渡しは確認済み。iPad／Mac Safari、ICSの保存・取り込み、対応OS下限の確認が残る。
6. **掲載素材**：iPhone・iPad・Macの実際のSafari画面を撮影する。Chrome用画像をSafari実機の画像として流用しない。提出時のApp Store Connectのサイズ指定に合わせる。説明文・サポートURL・プライバシーURL・年齢レーティング・審査担当者への起動手順を用意する。
7. **Archive → Validate → Upload**：`npm run prepare:safari` 後、XcodeでRelease用のTeam／IDを確認する。iOSは実機向けのScheme、MacはmacOSのSchemeでProduct → Archive。OrganizerでValidate App、Distribute AppからApp Store Connectへ送る。通常のDebug `.app` は提出用アーカイブではない。
8. **TestFlight → 審査**：処理完了を待ち、配布版で拡張の有効化・操作を確認してから提出する。同じ0.6.0を修正再提出する場合はビルド番号を増やし、提出したソースのコミットを記録する。

アプリはログイン不要。予定の保存には利用者自身のGoogleカレンダーを使用する。Googleの認証情報を審査用として共有しない。アプリ内のポリシーリンクは同梱案内の明示クリック時のみ標準ブラウザへ開き、外部ページをネイティブブリッジ付きWebViewに読み込まない。

プライバシー申告は、ページの端末内処理・設定保存と、利用者の操作によるGoogleへの受け渡しを区別し、Appleの定義に照らして最終回答する。単に「サーバーを持たない」という理由だけで回答を確定しない。

## 公式手順

- [Developer Programへの登録](https://developer.apple.com/help/account/membership/program-enrollment)
- [配布準備とBundle ID](https://developer.apple.com/documentation/xcode/preparing-your-app-for-distribution)
- [新規アプリの登録](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)
- [プラットフォームの追加](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-platforms)
- [スクリーンショットの仕様](https://developer.apple.com/jp/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [プライバシー申告の定義](https://developer.apple.com/app-store/app-privacy-details/)
- [審査ガイドライン](https://developer.apple.com/app-store/review/guidelines/)
