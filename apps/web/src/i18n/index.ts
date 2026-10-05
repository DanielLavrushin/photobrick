// i18next setup. English only for v0.1; every visible string goes through t() so more languages can
// be added as JSON files next to en.json.

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
});

export default i18n;
