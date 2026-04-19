import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { translations } from '../translations';

const LANG_KEY = 'urbanpl_language';

const LanguageContext = createContext({});

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState('en');

  useEffect(() => {
    // Load saved language on startup
    SecureStore.getItemAsync(LANG_KEY).then(saved => {
      if (saved === 'en' || saved === 'es') setLanguageState(saved);
    });
  }, []);

  function setLanguage(lang) {
    setLanguageState(lang);
    SecureStore.setItemAsync(LANG_KEY, lang);
  }

  function t(path) {
    const keys = path.split('.');
    let value = translations[language];
    for (const key of keys) {
      if (value === undefined) return path;
      value = value[key];
    }
    return value ?? path;
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
