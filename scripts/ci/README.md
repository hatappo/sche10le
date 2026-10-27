# ライブ検証のコンテナ

`playwright-image.txt` のMicrosoft公式イメージを使う。Node.js 24・ブラウザ・OS依存ライブラリは同梱済みなので、WFでは `apt` や `playwright install` を実行しない。プロジェクトの依存は引き続き `npm ci` でlockfileからインストールする。

Playwrightを更新するときはイメージも同じバージョンに更新し、公式レジストリで確認したマルチアーキテクチャのダイジェストを固定する。`tests/ci-config.test.js` が `package.json`・lockfileとの一致を確認する。イメージ取得にも通信時間はかかるため、毎回の速度は保証しない。

`run-playwright.sh` はチェックアウトだけを `/workspace` にマウントする。ホストと同じ非rootのUID/GIDを使い、DockerソケットやGitHubトークンは渡さない。チェックアウトにも認証情報を保存しない。`HOME` はコンテナ内の `/tmp`、共有メモリはコンテナ専用の1GBとする。Node.js側も `TZ=Asia/Tokyo` に固定し、既存の日時テストとブラウザ側の設定にそろえる。

Chromiumのサンドボックスを `LIVE_CHROMIUM_SANDBOX=1` で明示的に有効化する。起動できない場合にサンドボックス無効へ切り替える処理はない。`--privileged`・`SYS_ADMIN`・`seccomp=unconfined` は使用しない。公式のseccomp設定でユーザー名前空間の作成を許可し、`no-new-privileges` を指定する。

ライブ検証の前に、同じコンテナ・同じブラウザ起動処理でローカルHTTP fixtureを確認する。遅れて表示される本文・空や非表示のプレースホルダーも検証する。環境が壊れているときに実サイトへ接続しない。実サイトの直列実行・2秒の間隔・リトライなし・日時のみのレポート保存は維持する。

## ローカルで試す場合

Linux向けの `node_modules` を作るため、普段のmacOS等の作業ディレクトリではなく、独立したチェックアウトやコピーで実行する。

```sh
docker pull "$(cat scripts/ci/playwright-image.txt)"
bash scripts/ci/run-playwright.sh npm ci
bash scripts/ci/run-playwright.sh npm test
bash scripts/ci/run-playwright.sh npm run build
bash scripts/ci/run-playwright.sh npx playwright test tests/e2e/live-harness.spec.js --reporter=line
# 実サイトにアクセスする場合のみ（通常はWFで実行）
LIVE_SITES=luma bash scripts/ci/run-playwright.sh npm run test:live
```

## 公式seccomp設定の出典

- `seccomp_profile.json`: [microsoft/playwright v1.64.1](https://github.com/microsoft/playwright/blob/v1.64.1/utils/docker/seccomp_profile.json) から変更せず収録。
- ライセンス: Apache License 2.0（同梱の `PLAYWRIGHT-LICENSE`）。
- 設定根拠: [Playwright Docker — Crawling and scraping](https://playwright.dev/docs/docker#crawling-and-scraping)。
