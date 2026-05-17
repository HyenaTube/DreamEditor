import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateColors, typo, sp, radius } from '../theme';

const SAVE_PATH_KEY  = 'eden_save_path';
const THEME_KEY      = 'eden_theme';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [saveFolderUri, setSaveFolderUri]   = useState(null);
  const [folderReady, setFolderReady]       = useState(false);
  const [themeHue,  setThemeHue]            = useState(45);
  const [oledMode,  setOledMode]            = useState(false);
  const [loaded, setLoaded]                 = useState(false);
  const [miiListVersion, setMiiListVersion] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [path, raw] = await Promise.all([
          AsyncStorage.getItem(SAVE_PATH_KEY),
          AsyncStorage.getItem(THEME_KEY),
        ]);
        if (path) { setSaveFolderUri(path); setFolderReady(true); }
        if (raw) {
          const t = JSON.parse(raw);
          if (t.hue  != null) setThemeHue(t.hue);
          if (t.oled != null) setOledMode(t.oled);
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const setSaveFolder = async (uri) => {
    setSaveFolderUri(uri);
    setFolderReady(!!uri);
    if (uri) await AsyncStorage.setItem(SAVE_PATH_KEY, uri);
    else await AsyncStorage.removeItem(SAVE_PATH_KEY);
  };

  const setTheme = async (hue, oled) => {
    setThemeHue(hue);
    setOledMode(oled);
    await AsyncStorage.setItem(THEME_KEY, JSON.stringify({ hue, oled }));
  };

  const colors = useMemo(() => generateColors(themeHue, oledMode), [themeHue, oledMode]);
  const bumpMiiList = useCallback(() => setMiiListVersion(v => v + 1), []);

  return (
    <AppContext.Provider value={{
      saveFolderUri, folderReady, setSaveFolder,
      themeHue, oledMode, setTheme,
      colors, typo, sp, radius,
      loaded,
      miiListVersion, bumpMiiList,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
