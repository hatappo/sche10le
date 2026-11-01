# ストア用プロモーション画像

- `small-440x280.png`：プロモーションタイル（小）、440×280px
- `marquee-1400x560.png`：マーキープロモーションタイル、1400×560px

どちらも24ビットRGB PNG（アルファチャンネルなし）。Chrome Web Storeの画像欄に直接アップロードします。拡張機能のZIPには同梱しません。

`tiles.html` が編集用原稿です。共通UIの配色・Georgiaのロゴに合わせ、日程の読み取りからカレンダーへの受け渡しを図で表しています。製品画面のスクリーンショットではありません。虫眼鏡と「10」のマークは `lib/brand.css` が参照する `lib/brand-mark.svg` を共有します。

再生成はGeorgia・ヒラギノのあるmacOSで、既存のPlaywright用Chromiumを使用します。

```sh
node scripts/generate-store-tiles.js
```

書き出し時にPNGの寸法・8ビット×RGBの色形式を検証します。外部フォント・ネットワーク通信・追加パッケージは使用しません。
