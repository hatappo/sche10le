// English source texts and references are listed at the end of README.md.
// Japanese renderings are our own. Quotes are bundled; displaying them makes no requests.
export const FOOTER_QUOTES = [
  {
    text: "失った時間は二度と戻らない。",
    original: "Lost Time is never found again.",
    attribution: "フランクリン編『Poor Richard Improved』（1748年）・独自訳",
    source: "https://founders.archives.gov/documents/Franklin/01-03-02-0103",
  },
  {
    text: "1分遅れるより、3時間早いほうがいい。",
    original: "Better three hours too soon than a minute too late.",
    attribution:
      "シェイクスピア『ウィンザーの陽気な女房たち』第2幕第2場、フォードの台詞・独自訳",
    source:
      "https://www.folger.edu/explore/shakespeares-works/the-merry-wives-of-windsor/read/2/2/",
  },
  {
    text: "時を殺せば、永遠も傷つく。",
    original: "As if you could kill time without injuring eternity.",
    attribution: "ヘンリー・デイヴィッド・ソロー『Walden』「Economy」・独自訳",
    source: "https://www.gutenberg.org/files/205/205-h/205-h.htm",
  },
  {
    text: "動け、いま生きているこの時に。",
    original: "Act,--act in the living Present!",
    attribution:
      "ヘンリー・ワズワース・ロングフェロー「A Psalm of Life」・独自訳",
    source: "https://poets.org/poem/psalm-life",
  },
  {
    text: "時も潮も、人を待たない。",
    original: "Time and tide wait for no man.",
    attribution: "英語のことわざ（Cambridge Dictionary）・独自訳",
    source:
      "https://dictionary.cambridge.org/dictionary/english/time-and-tide-wait-for-no-man",
  },
  {
    text: "日が照るうちに、干し草を作れ。",
    original: "Make hay while the sun shines.",
    attribution: "英語のことわざ（Cambridge Dictionary）・独自訳",
    source:
      "https://dictionary.cambridge.org/dictionary/english/make-hay-while-the-sun-shines",
  },
];

/** @param {() => number} [random] */
export function pickFooterQuote(random = Math.random) {
  return FOOTER_QUOTES[Math.floor(random() * FOOTER_QUOTES.length)];
}
