# Sche10le プライバシーポリシー / Privacy Policy

[日本語](#日本語) / [English](#english)

## 日本語

最終更新：2026年11月1日。対象：0.6.0以降。

0.5.0以前をご利用の場合は、[旧版のポリシー](https://github.com/hatappo/sche10le/blob/v0.5.0/PRIVACY.md)をご参照ください。

### 取り扱う情報と目的

Sche10leは、ユーザーが操作したWebページの本文・構造化データ・ページタイトル・URLと、ユーザーが選択したテキストを読み取り、日程候補の抽出とカレンダーに渡す予定の作成に使用します。

### 読み取るタイミング

拡張機能のアイコン操作でアクセスを許可したタブのページを対象に、初めて拡張を開いたとき、または「再スキャン」を押したときにページの本文・構造化データ・タイトル・URLを読み取ります。その後、ユーザーがページ上で選択した文字を予定に取り込みます。通常のページ閲覧やタブ切り替えだけで、自動的に日程をスキャンすることはありません。閉じたUIを同じページで再表示した場合は、既存の候補・取得内容を使用します。ページのURL変更を検知した場合は、編集中の内容を破棄し、次の明示的な起動を待ちます。

### 保存と削除

ページ内容・日程候補・選択したテキストは処理中のメモリ上で扱い、ユーザーが明示的にダウンロードする予定ファイルを除き、拡張機能では永続保存しません。移動時間・タイトル書式・候補の並び順・カラーテーマは、端末内の拡張機能用ストレージに保存します。設定は拡張機能から変更でき、アンインストールすると保存された設定も削除されます。

iPhone／iPadの案内アプリでは、ホーム画面のアイコンを選べます。この選択はOSが端末内で管理し、Safari拡張のカラーテーマとは独立しています。

「予定をダウンロード（.ics）」を押した場合は、タイトル・日時・場所・詳細・元ページURLを含む予定ファイルを端末内で生成し、ブラウザのダウンロード機能で保存します。この処理のための外部送信は行いません。ダウンロードしたファイルはユーザーが管理・削除でき、拡張機能をアンインストールしても削除されません。

### 外部への送信

「Googleカレンダーで開く」を押すと、予定のタイトル・日時・場所・詳細と元ページのURLを、予定作成画面のURLを通じてHTTPSでGoogleに渡します。予定の保存はGoogleカレンダー上でユーザーが行います。Googleに渡した情報の取り扱いは、[Googleのプライバシーポリシー](https://policies.google.com/privacy)に従います。

開発者のサーバーへのデータ送信、アクセス解析、広告目的の利用、データの販売は行いません。

### AI補完の提供停止

0.6.0ではAI補完を提供していません。旧版のAI設定は背景処理の起動時に削除します。削除に失敗しても使用せず、AIモデルの起動やダウンロードは行いません。

### Chrome Web Storeのポリシーへの準拠

本拡張機能による情報の利用は、Chrome Web Storeのユーザーデータに関するポリシー（[Limited Useの要件](https://developer.chrome.com/docs/webstore/program-policies/limited-use)を含む）に従います。

### ポリシーの変更

機能や情報の取り扱いに変更がある場合は、このページと最終更新日を更新します。

### お問い合わせ

連絡先：hatappo44+chromewebstore@gmail.com

## English

Last updated: November 1, 2026. Applies to version 0.6.0 and later.

For version 0.5.0 or earlier, see the [previous policy](https://github.com/hatappo/sche10le/blob/v0.5.0/PRIVACY.md).

This English version is a translation. If there is any discrepancy, the Japanese version prevails.

### Information we handle and why

Sche10le reads the text, structured data, title, and URL of a web page the user interacts with, along with text selected by the user. This information is used to find dates and prepare an event to pass to a calendar.

### When we read a page

Sche10le reads the page text, structured data, title, and URL in the tab for which the user granted access through the extension icon, when first opening the extension on that page or clicking “再スキャン” (Rescan). The user can then select text on the page to include in the event. Ordinary browsing or switching tabs alone does not trigger scanning. Reopening the UI on the same page reuses its existing candidates and selected content. When the page URL changes, the draft is discarded and scanning waits for the next explicit activation.

### Storage and deletion

Page content, date candidates, and selected text are handled in memory during use and are not persistently stored by the extension, except in event files the user explicitly downloads. Travel time, the title format, the candidate sort order, and the color theme are stored locally in the extension's storage on the device. These settings can be changed in the extension and are deleted when the extension is uninstalled.

On iPhone and iPad, the companion app lets the user choose its Home Screen icon. The OS manages this selection on the device, independently of the Safari extension’s color theme.

Clicking “予定をダウンロード（.ics）” (Download event as .ics) generates an event file locally containing the title, dates and times, location, details, and source page URL, and saves it using the browser’s download feature. No data is sent externally for this operation. Downloaded files are managed and deleted by the user and are not removed when the extension is uninstalled.

### Sharing information

When the user clicks “Googleカレンダーで開く” (Open in Google Calendar), Sche10le passes the event title, dates and times, location, details, and source page URL to Google over HTTPS through the event creation URL. The user saves the event in Google Calendar. Google's handling of this information is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

Sche10le does not send data to the developer's servers, perform analytics, use data for advertising, or sell data.

### AI assistance discontinued

Version 0.6.0 does not provide AI assistance. The background process removes the retired AI setting when it starts. If removal fails, the setting is still ignored; the extension does not start or download an AI model.

### Compliance with Chrome Web Store policies

Sche10le uses information in accordance with the Chrome Web Store User Data Policy, including its [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

### Changes to this policy

If features or data handling practices change, we will update this page and its last updated date.

### Contact

Contact: hatappo44+chromewebstore@gmail.com
