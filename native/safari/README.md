# Safariのネイティブプロジェクト

`Sche10le.xcodeproj` をGit管理する。macOS/iOSのアプリとSafari Web Extensionを同じプロジェクトで管理し、Webの実装はリポジトリ直下のWXTと共有する。Xcode 27.1のpackagerが生成した、シミュレーターで動作確認済みのプロジェクトを土台にしている。

## 開発を始める

リポジトリ直下で実行する。Xcode 27.1とそのCommand Line Toolsを使用して確認済み。

```sh
npm ci
npm run prepare:safari
open native/safari/Sche10le.xcodeproj
```

Schemeは `Sche10le (iOS)` または `Sche10le (macOS)`。iOSはまずシミュレーターを選んでRunする。Web側のコードを変えたら `npm run prepare:safari` を実行してからXcodeでRunする。Xcodeはnpmを自動実行しない。

署名なしの開発ビルドは、Webの再ビルドを含む次のコマンドでも実行できる。

```sh
npm run build:safari:ios
npm run build:safari:macos
```

| 対象 | 生成されるアプリ |
| --- | --- |
| iOSシミュレーター | `.output/safari-derived-ios/Build/Products/Debug-iphonesimulator/Sche10le.app` |
| macOS | `.output/safari-derived-macos/Build/Products/Debug/Sche10le.app` |

この2コマンドは `CODE_SIGNING_ALLOWED=NO` のDebugビルド。実際のiPhoneへのインストール、App Store提出用アーカイブ、署名・公証は行わない。

## 管理するもの・生成するもの

- Swift、storyboard、Info.plist、アプリアイコン、共有Scheme、Xcodeプロジェクト、共通設定をGit管理する。
- Webのソースは従来どおり `lib/` と `entrypoints/` のみ。Xcodeは `.output/safari-mv3/` をリポジトリからの相対パスで参照する。生成されたJSやWeb用アイコンをここへコピーしない。
- `Config/Version.xcconfig` は `package.json` から同期してGit管理する。バージョン更新時には `npm run prepare:safari` を実行し、変更を一緒にコミットする。
- `CURRENT_PROJECT_VERSION`（Apple向けビルド番号）は `Config/Common.xcconfig` で管理する。現在は1。同じ公開バージョンを再提出するときの採番は配布作業時に行う。
- `xcuserdata`、ローカル署名設定、ビルド生成物はGit管理しない。

`prepare:safari` はSafariビルドのバージョンとXcodeのリソース参照を検証する。生成物のトップレベルに新しいHTMLやフォルダーが増えたら、両Extensionターゲットの **Copy Bundle Resources** に追加する。既存の `chunks/`、`content-scripts/`、`icons/` 内のファイルはフォルダー参照で取り込まれる。

Xcode側でも毎回、package.json・manifest・ネイティブアプリのバージョンを照合し、不一致ならビルドを止める。同じバージョン内でWebを変更したことまでは検出しないため、Web変更後の `prepare:safari` は必要。

## 署名とBundle Identifier

現在の `dev.sche10le.prototype` は開発用の仮IDで、App Storeに登録していない。拡張IDはその末尾に `.Extension` を付ける。アプリ内のSafari設定画面への導線も、同じ設定から拡張IDを取得する。

個人のTeamを設定する場合は以下をコピーして編集する。

```sh
cp native/safari/Config/Signing.example.xcconfig native/safari/Config/Signing.local.xcconfig
```

`Signing.local.xcconfig` はGit対象外。Teamや暫定的な署名設定はここへ記載し、共有の `project.pbxproj` へ個人設定を書き込まない。証明書・秘密鍵・プロビジョニングプロファイルはリポジトリに置かない。正式なBundle Identifierを決めたら `Common.xcconfig` を更新する。

## 今後の配布準備

案内アプリは日本語で「有効化」と「ページからの起動」を分けて説明する。iOSの設定経路とmacOSの設定／環境設定はOSに合わせて切り替え、Macでは有効状態と設定を開く失敗も表示する。カラーは `lib/theme.css` を直接共有し、システムの明暗に追従する。

案内のブラウザテストは `tests/sheet/onboarding.spec.js` にあり、`npm run test:ui` とPRの回帰CIに含まれる。`npm run icons` で拡張・アプリ・案内画面のアイコンを同じ原稿から再生成する。署名、実機検証、ストア情報は引き続き必要。[実機確認の手順と記録](../../docs/dev/safari-device-checklist.md) を参照。

Deployment Targetは生成時の値を維持している（iOSアプリ17.0・拡張15.0、macOS12.0）。これは検証済みのサポート下限を意味しない。Web APIも含めた実機検証を経て、公開前にアプリと拡張の下限を確定する。

以前の `.output/safari-xcode/` は検証の記録として残しているが、今後は本ディレクトリを使う。packagerの再実行で本プロジェクトを上書きしない。更新されたテンプレートを比較したい場合は、別の一時ディレクトリへ生成する。

- [Apple：Safari用Web Extensionのパッケージ化](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)
- [Apple：ビルド設定ファイル](https://developer.apple.com/documentation/xcode/adding-a-build-configuration-file-to-your-project)
