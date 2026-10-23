// Sources and the original English wording are listed at the end of README.md.
// These are bundled locally; showing a quote never makes a network request.
export const FOOTER_QUOTES = [
  { text: "思い立ったが吉日", attribution: "ことわざ（漢字ペディア）" },
  { text: "一日の計は朝にあり", attribution: "ことわざ（漢字ペディア）" },
  {
    text: "急がば回れ",
    attribution: "ことわざ（滋賀県立図書館・レファレンス協同データベース）",
  },
  {
    text: "光陰矢の如し",
    attribution: "ことわざ（堺市立中央図書館・レファレンス協同データベース）",
  },
  {
    text: "明日は明日の風が吹く",
    attribution: "ことわざ（ことわざ辞典オンライン）",
  },
  {
    text: "失った時間は二度と戻らない。",
    attribution:
      "フランクリン編『Poor Richard Improved』（1748年）より・独自訳",
  },
];

/** @param {() => number} [random] */
export function pickFooterQuote(random = Math.random) {
  return FOOTER_QUOTES[Math.floor(random() * FOOTER_QUOTES.length)];
}
