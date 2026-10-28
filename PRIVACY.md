# Sche10le プライバシーポリシー / Privacy Policy

[日本語](#日本語) / [English](#english)

## 日本語

最終更新日：2026年10月27日

### 取り扱う情報と目的

Sche10leは、ユーザーが操作したWebページの本文・構造化データ・ページタイトル・URLと、ユーザーが選択したテキストを読み取り、日程候補の抽出とカレンダーに渡す予定の作成に使用します。

### 読み取るタイミング

拡張機能のアイコン操作で一時的なアクセスを許可したタブを対象に、表示中のページを読み取ります。日程のスキャンは、アイコンを押したとき、サイドパネルの初回読み込み時、または「スキャン」「再スキャン」「再試行」を押したときに行います。その後、ユーザーがページ上で選択した文字を予定に取り込みます。通常のページ閲覧やタブ切り替えだけで、自動的に日程をスキャンすることはありません。サイドパネルを表示中にタブやページが切り替わった場合は、ページ本文やDOMを読み取らずにアクセス可否だけを確認し、適切な操作案内を表示します。

### 保存と削除

ページ内容・日程候補・選択したテキストは処理中のメモリ上で扱い、ユーザーが明示的にダウンロードする予定ファイルを除き、拡張機能では永続保存しません。移動時間・タイトル書式・AI補完の有効／無効・候補の並び順・カラーテーマは、端末内の拡張機能用ストレージに保存します。設定は拡張機能から変更でき、アンインストールすると保存された設定も削除されます。

「予定をダウンロード（.ics）」を押した場合は、タイトル・日時・場所・詳細・元ページURLを含む予定ファイルを端末内で生成し、ブラウザのダウンロード機能で保存します。この処理のための外部送信は行いません。ダウンロードしたファイルはユーザーが管理・削除でき、拡張機能をアンインストールしても削除されません。

### 外部への送信

「Googleカレンダーで開く」を押すと、予定のタイトル・日時・場所・詳細と元ページのURLを、予定作成画面のURLを通じてHTTPSでGoogleに渡します。予定の保存はGoogleカレンダー上でユーザーが行います。Googleに渡した情報の取り扱いは、[Googleのプライバシーポリシー](https://policies.google.com/privacy)に従います。

開発者のサーバーへのデータ送信、アクセス解析、広告目的の利用、データの販売は行いません。

### 任意のローカルAI

AI補完は初期状態では無効です。有効にした場合、対応する環境でChromeに組み込まれたAIモデルを使用し、ページ本文の一部を端末内で処理します。この推論のためにページ本文を外部サーバーへ送信しません。初回利用時などには、ChromeによるAIモデルのダウンロードが必要になる場合があります。

### Chrome Web Storeのポリシーへの準拠

本拡張機能による情報の利用は、Chrome Web Storeのユーザーデータに関するポリシー（[Limited Useの要件](https://developer.chrome.com/docs/webstore/program-policies/limited-use)を含む）に従います。

### ポリシーの変更

機能や情報の取り扱いに変更がある場合は、このページと最終更新日を更新します。

### お問い合わせ

連絡先：hatappo44+chromewebstore@gmail.com

## English

Last updated: October 27, 2026

This English version is a translation. If there is any discrepancy, the Japanese version prevails.

### Information we handle and why

Sche10le reads the text, structured data, title, and URL of a web page the user interacts with, along with text selected by the user. This information is used to find dates and prepare an event to pass to a calendar.

### When we read a page

Sche10le reads the current page in a tab for which the user has granted temporary access by clicking the extension icon. Date scanning runs when the icon is clicked, when the side panel first loads, or when the user clicks the “スキャン” (Scan), “再スキャン” (Rescan), or “再試行” (Retry) button. The user can then select text on the page to include in the event. Ordinary browsing or switching tabs alone does not trigger automatic date scanning. When the tab or page changes while the side panel is open, the extension checks whether access is available without reading the page text or DOM, so it can display the appropriate guidance.

### Storage and deletion

Page content, date candidates, and selected text are handled in memory during use and are not persistently stored by the extension, except in event files the user explicitly downloads. Travel time, the title format, the AI assistance setting, the candidate sort order, and the color theme are stored locally in the extension's storage on the device. These settings can be changed in the extension and are deleted when the extension is uninstalled.

Clicking “予定をダウンロード（.ics）” (Download event as .ics) generates an event file locally containing the title, dates and times, location, details, and source page URL, and saves it using the browser’s download feature. No data is sent externally for this operation. Downloaded files are managed and deleted by the user and are not removed when the extension is uninstalled.

### Sharing information

When the user clicks “Googleカレンダーで開く” (Open in Google Calendar), Sche10le passes the event title, dates and times, location, details, and source page URL to Google over HTTPS through the event creation URL. The user saves the event in Google Calendar. Google's handling of this information is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

Sche10le does not send data to the developer's servers, perform analytics, use data for advertising, or sell data.

### Optional local AI

AI assistance is disabled by default. When enabled on a supported device, it uses Chrome's built-in AI model to process part of the page text on the device. Page text is not sent to an external server for this inference. Chrome may need to download the AI model, including when it is first used.

### Compliance with Chrome Web Store policies

Sche10le uses information in accordance with the Chrome Web Store User Data Policy, including its [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use).

### Changes to this policy

If features or data handling practices change, we will update this page and its last updated date.

### Contact

Contact: hatappo44+chromewebstore@gmail.com
