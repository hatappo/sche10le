// Human-reviewed expectations, not values produced by the extractor under test.
// Keep only public event URLs and dates here; never store a copy of a site's HTML.
// Initial six event dates reviewed on 2026-10-27; Luma on 2026-10-28 (Asia/Tokyo).
export const sites = [
  {
    id: "connpass",
    name: "connpass",
    url: "https://connpass.com/event/411140/",
    identity: "黙々と作業を進めるオンライン自習室",
    expected: {
      start: "2026-10-29T21:00:00+09:00",
      end: "2026-10-29T23:00:00+09:00",
    },
  },
  {
    id: "doorkeeper",
    name: "Doorkeeper",
    url: "https://web-mining.doorkeeper.jp/events/200100",
    identity: "中小企業のウェブサイト管理とセキュリティ対策講座",
    expected: {
      start: "2026-11-05T20:00:00+09:00",
      end: "2026-11-05T21:00:00+09:00",
    },
  },
  {
    id: "peatix",
    name: "Peatix",
    url: "https://peatix.com/event/5222594",
    identity: "第8回OIV登録品種サミット",
    expected: {
      start: "2026-12-05T13:00:00+09:00",
      end: "2026-12-05T17:00:00+09:00",
    },
  },
  {
    id: "techplay",
    name: "TECH PLAY",
    url: "https://techplay.jp/event/999947",
    identity: "Engineering Leaders Day 2026",
    expected: {
      start: "2026-10-27T10:00:00+09:00",
      end: "2026-10-27T19:00:00+09:00",
    },
  },
  {
    id: "kokuchpro",
    name: "こくちーずプロ",
    url: "https://www.kokuchpro.com/event/496889c04454868921221036b4ffdded/",
    identity: "第30回東神戸マラソン",
    expected: {
      start: "2026-11-15T10:00:00+09:00",
      end: "2026-11-15T17:00:00+09:00",
    },
  },
  {
    id: "meetup",
    name: "Meetup",
    url: "https://www.meetup.com/ja/joy-tennis-tokyo/events/316967295/",
    identity: "Joy Tennis Tokyo one day tennis camp",
    expected: {
      start: "2026-11-21T10:00:00+09:00",
      end: "2026-11-21T16:00:00+09:00",
    },
  },
  {
    id: "luma",
    name: "Luma",
    url: "https://luma.com/m5yc8qe3?locale=ja",
    identity: "Global Innovators Mixer",
    expected: {
      start: "2026-10-16T18:30:00+09:00",
      end: "2026-10-16T22:00:00+09:00",
    },
  },
];
