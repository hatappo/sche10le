import { defineConfig } from 'wxt';

export default defineConfig({
  imports: false,
  manifest: {
    name: 'Sche10le',
    description: 'ページの日程を見つけて、Googleカレンダーへ。',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'sidePanel', 'storage'],
    action: { default_title: 'Sche10leで日程を見つける' },
  },
});
