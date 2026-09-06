// يقرأ app.json ويضيف إعدادات النشر الثابت (وضع العرض) من البيئة
const base = require('./app.json');
const baseUrl = process.env.EXPO_PUBLIC_BASE_URL || '';
module.exports = {
  expo: {
    ...base.expo,
    web: { ...base.expo.web, output: process.env.EXPO_WEB_OUTPUT || base.expo.web.output },
    experiments: { ...base.expo.experiments, ...(baseUrl ? { baseUrl } : {}) },
  },
};
