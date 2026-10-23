import { defineConfig } from "wxt";

export default defineConfig({
  imports: false,
  webExt: { disabled: true },
  manifest: {
    name: "Sche10le",
    description: "ページの日程を見つけて、Googleカレンダーへ。",
    minimum_chrome_version: "116",
    permissions: ["activeTab", "scripting", "sidePanel", "storage"],
    icons: {
      16: "icons/16.png",
      32: "icons/32.png",
      48: "icons/48.png",
      128: "icons/128.png",
    },
    action: { default_title: "Sche10leで日程を見つける" },
  },
});
