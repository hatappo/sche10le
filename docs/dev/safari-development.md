# Safari版の開発

[Issue #19](https://github.com/hatappo/sche10le/issues/19) の最初の試作。iPhoneを優先し、iPad・Macにも対応する。Chrome版と同じリポジトリ・WXT・バニラJSを使用する。

## 現在の到達点

- Safari用MV3ビルドを分離。`activeTab`・`scripting`・`storage` のみを宣言し、Chrome専用のサイドパネル・最小Chromeバージョン・ローカルAIは含めない。
- 拡張のアクションを押したタブのトップフレームへ、その場でContent Scriptを注入する。全サイトへの常時読み取り権限や自動実行は追加しない。
- 狭い画面では下部シート、760px以上では右側のドロワーを表示する。日時と登録パターンはタップで選ぶ。
- 日時を決めると同じシートが小さな取得バーへ縮む。タイトル→場所→詳細をページから取得し、完了後は確認用シートへ戻る。途中でも「内容を確認」からカレンダーへ進める。
- 閉じても、そのページが存続する間は内容を保持する。拡張から再表示できる。再読み込み・別ページへの移動・SPAのURL変更では破棄する。
- GoogleカレンダーURL、ICS、タイトル書式、移動時間、候補のソート、6テーマは既存の処理・設定キーを共有する。Safariの設定画面にはAIを置かない。

WebKitとChromiumで**UI・ロジックの検証**を実施。2026-10-30にXcode 27.1でmacOS/iOS共通プロジェクトを生成し、iPhone 18 Pro（iOS 27.0）シミュレーター向けビルド・インストール・案内アプリの起動を確認した。同日、ユーザーの手動確認でSafariの拡張メニューから起動し、検証ページの日程3件を検出して動作した。署名、実機上の起動・権限・ファイル受け渡しは未検証であり、ストアへ提出できる状態ではない。

初回の手動確認では、Safari内で拡張を起動する場所が分かりにくかった。公開前に案内アプリを日本語化し、「拡張を有効にする」と「Webページから拡張を起動する」を分けて、メニューの場所を図示する。現在のpackager標準の英語案内だけでは不十分。

## XcodeなしでUIを触る

```sh
npm ci
npm run preview:safari
```

表示された `http://127.0.0.1:4174` をブラウザーで開く。幅を狭めるとスマホ向けのシート、広げるとMac向けのドロワーになる。閉じた後はページ右上の「Safari UI試作を開く」から戻れる。終了はターミナルでCtrl+C。

このプレビューはローカルのサンプルページに実際のSafari向けContent Scriptを読み込む。拡張APIだけを模擬しているため、**Googleカレンダーは実際には開かない**。ICSは生成・ダウンロードできる。設定はこのプレビューのlocalStorageに保存し、実際の拡張設定には触れない。サーバーは127.0.0.1にのみ待ち受け、外部イベントサイトへアクセスしない。

プレビュー用API・サーバー・テストのフックは配布用ビルドには含めない。これはSafariへのインストール手順ではない。

## ビルドと自動テスト

```sh
npm run check                    # Chromeのlint・型検査・単体テスト・ビルド
npm run test:e2e                 # Chrome既存UIの回帰確認
npm run build:safari             # .output/safari-mv3/ にWeb Extensionを生成
npx playwright install chromium webkit  # Safari UIテストの初回のみ
npm run test:safari              # Safariビルド + Chromium/WebKitの専用テスト
```

Safariのテストは通常のE2E・ライブサイト検証から分離している。実際のビルドを使い、タップによる取得、スクロールの除外、フォーム操作、閉じる・再表示、二重注入、SPA遷移、設定とエラー表示、移動前の時刻書式、ICS、狭幅・Mac幅、reduced motionを検査する。背景処理はAPIを模擬し、注入対象・送信元・カレンダーURL制限・起動失敗時の案内も検査する。

本番では閉じたShadow DOMを使う。テストだけShadow DOMを観測可能にして、同じビルドのUIを操作する。Playwright WebKitはSafariそのものでもiPhoneでもないため、これらの成功を実機動作の保証にはしない。

## コードの分担

| 部分 | ファイル | 責務 |
| --- | --- | --- |
| 対象別の出力 | `wxt.config.js`、各entrypointのinclude/exclude | ChromeとSafariの権限・UIを分離 |
| 起動・受け渡し | `lib/safari-background.js` | activeTabによる注入、限定したGoogleカレンダーURLだけを新規タブで開く |
| ライフサイクル | `entrypoints/safari.content.js` | 二重注入防止、設定API、再表示、URL変更時の破棄 |
| Safari UI | `lib/safari-sheet.js`、`lib/safari-sheet.css` | シートと取得バー、ページ単位の編集中状態 |
| 共有ロジック | `lib/extract.js`、`calendar.js`、`ical.js`、`draft.js`、`title-format.js`、`themes.js`など | 抽出・日時・書式・予定生成・テーマ |

UIはページ内のHTML/CSSであり、Safari標準ポップアップやネイティブのシートを縮めているわけではない。編集中の内容はContent Script内のメモリーに保持し、バックグラウンド処理やポップアップの存続には依存しない。ページ内の文字列をHTMLとして挿入せず、フォーム入力は取得対象にしない。URL変更の監視は再スキャンを行わない。

## 次の段階：Xcodeと実機

2026-10-30時点でXcode 27.1・Safariのpackager・iOSシミュレーターを準備済み。以下は別環境での再セットアップ手順。

1. Mac App StoreからXcodeをインストールし、初回起動のセットアップを完了する。
2. XcodeのSettings → LocationsでCommand Line ToolsにXcodeを指定する。
3. 次のコマンドでpackagerの存在と生成を確認する。現行名は `safari-web-extension-packager`、旧名は `safari-web-extension-converter`。インストールしたXcodeに合わせて使用する。[Apple公式のパッケージ手順](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)

```sh
npm run build:safari
xcrun --find safari-web-extension-packager
xcrun safari-web-extension-packager "$(pwd)/.output/safari-mv3" \
  --project-location "$(pwd)/.output/safari-xcode" \
  --app-name Sche10le --bundle-identifier dev.sche10le.prototype --swift
```

`.output/safari-xcode` は最初の確認用の仮置きでGit管理外。本採用するプロジェクトの配置・Bundle Identifier・対応OS下限は生成結果を確認して決める。macOSとiOS両方のターゲットを用意し、packagerが出すmanifestの警告を確認する。Web側の変更後はWXTを再ビルドし、Xcode側が最新のリソースを参照していることを確認してアプリを再ビルドする。

生成されたプロジェクトは `.output/safari-xcode/Sche10le/Sche10le.xcodeproj`。`dev.sche10le.prototype` はローカル試作用の識別子で、ストア登録はしていない。生成済みフォルダーにpackagerを再実行して上書きしないこと。

### シミュレーターで試す

1. 上記のプロジェクトをXcodeで開く。
2. 上部の実行対象を **Sche10le (iOS)**、端末を **iPhone 18 Pro** などのシミュレーターにして、▶（Run）を押す。Macや実際のiPhoneを選ぶ場合とは異なり、有料メンバーシップは不要。
3. Xcode 27では画面の表示先が **Device Hub**。表示されない場合は **Xcode → Open Developer Tool → Device Hub** から開き、起動済み端末を選ぶ。[AppleのDevice Hub案内](https://developer.apple.com/documentation/xcode/pairing-your-devices-with-your-mac)
4. シミュレーター内で **Settings → Apps → Safari → Extensions → Sche10le** を開き、拡張を有効にする。
5. Macのターミナルで次を実行し、シミュレーターのSafariで `http://127.0.0.1:4175` を開く。

```sh
npm run preview:safari:native
```

このページはイベントのサンプル本文だけを返し、模擬API・拡張の自動起動は含まない。従来の4174番ポートのUIプレビューと混同しないこと。シミュレーターはMacのlocalhostに接続できるが、実際のiPhoneで同じURLは使えない。

6. SafariのページメニューからSche10leを選ぶ。サイトへのアクセスを求められたら、検証ページに対して許可する。
7. 3件の候補が表示されること、登録パターンの選択でバーへ縮むこと、タイトル・場所・詳細を順に取得できることを確認する。Googleカレンダーを開く操作は、このモードでは実際に遷移する（予定の保存は行わない）。

コマンドからのビルド確認には次を使える。通常はXcodeのRunで進める。

```sh
xcodebuild -project .output/safari-xcode/Sche10le/Sche10le.xcodeproj \
  -scheme 'Sche10le (iOS)' -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .output/safari-derived CODE_SIGNING_ALLOWED=NO build
```

以降はXcodeのApple Account、署名のTeam、実行対象のScheme（どのアプリを起動するか）、接続したiPhoneを順に設定する。登録や支払い、Bundle Identifierの確定は実装とは分けて進める。配布段階でApple Developer Program・TestFlight・App Storeの手続きを行う。[登録の公式案内](https://developer.apple.com/help/account/membership/program-enrollment)

App Store ConnectにはXcodeなしのパッケージ化経路もあるが、まずは端末上の触り心地を検証する。[Webでのパッケージ化](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)

## 実機で確認・判断すること

- iPhoneのSafari拡張メニューからの初回起動、サイトアクセスの許可・拒否・再試行。Macのツールバーからの起動。
- Safariのツールバーの伸縮、ソフトウェアキーボード、safe area、横向き、ピンチズームに対する位置調整。
- ページ末尾・固定要素・iframeの周辺で取得対象を操作バーが隠さないか。必要なら移動・退避方法を追加する。
- タップとスクロール、長押し・テキスト範囲選択の使い分け。現状はタップした要素の全文を基本とし、その要素内に既存の選択範囲がある場合は選択文字列を使う。
- GoogleカレンダーのWeb／アプリへの遷移、元のページへ戻る動作、iOSのICSダウンロード／共有／カレンダーへの取り込み。
- VoiceOver、キーボード、拡大文字、iPadの分割表示と実際の押しやすさ。
- 複数タブ・復帰・権限取り消し・更新時の状態。設定は起動時に読み込むため、別タブからの変更を既存のシートへ即時反映する仕組みはまだない。
- Mac/iOSアプリのアイコン・有効化案内、対応OS下限、Safari版のプライバシー説明とストア申告、審査素材。
