import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { typo, sp, radius, card, btnFilled, btnOutlined } from '../theme';
import { useApp } from '../context/AppContext';

const SAVE_PATH_KEY = 'eden_save_path';

export default function ConfigScreen({ navigation }) {
  const [saveFolderPath, setSaveFolderPath] = useState('');
  const [ugcSelected, setUgcSelected]       = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SAVE_PATH_KEY)
      .then(p => { if (p) { setSaveFolderPath(p); setUgcSelected(true); } })
      .catch(() => {});
  }, []);

  const selectFolder = async () => {
    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (result.granted) {
        setSaveFolderPath(result.directoryUri);
        setUgcSelected(true);
        await AsyncStorage.setItem(SAVE_PATH_KEY, result.directoryUri);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to select folder: ' + e.message);
    }
  };

  const continueToViewer = () => {
    if (ugcSelected) navigation.navigate('Viewer', { folderPath: saveFolderPath });
    else Alert.alert('Missing', 'Select the save folder first.');
  };

  // Shorten URI for display
  const displayPath = saveFolderPath
    ? decodeURIComponent(saveFolderPath).split('/').slice(-3).join(' / ')
    : '';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.logoRing}>
          <Text style={styles.logoEmoji}>🏝️</Text>
        </View>
        <Text style={styles.appName}>TomoPhonEdit</Text>
        <Text style={styles.appSub}>Tomodachi Life save editor</Text>
      </View>

      {/* Status card */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View style={styles.statusDot(ugcSelected)} />
          <Text style={styles.statusLabel}>Save folder</Text>
          <View style={styles.statusBadge(ugcSelected)}>
            <Text style={styles.statusBadgeText(ugcSelected)}>
              {ugcSelected ? 'Granted' : 'Required'}
            </Text>
          </View>
        </View>
        {ugcSelected && (
          <Text style={styles.pathText} numberOfLines={2}>{displayPath}</Text>
        )}
        {!ugcSelected && (
          <Text style={styles.pathHint}>
            Select the folder that contains{'\n'}Player.sav and the Ugc subfolder.
          </Text>
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btnFilled} onPress={selectFolder} activeOpacity={0.8}>
          <Text style={styles.btnFilledText}>
            {ugcSelected ? 'Change folder' : 'Select save folder'}
          </Text>
        </TouchableOpacity>

        {ugcSelected && (
          <TouchableOpacity style={styles.btnOutlined} onPress={continueToViewer} activeOpacity={0.8}>
            <Text style={styles.btnOutlinedText}>Open editor  →</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.footer}>
        Compatible with Tomodachi Life: Living the Dream{'\n'}
        Title ID: 010051F0207B2000
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: colors.bg,
    paddingHorizontal: sp.xl, paddingTop: 60, paddingBottom: sp.xl,
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', marginBottom: sp.xxl },
  logoRing: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: colors.primaryContainer,
    borderWidth: 2, borderColor: colors.primaryDim,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: sp.lg,
  },
  logoEmoji: { fontSize: 48 },
  appName: { ...typo.display, marginBottom: sp.xs },
  appSub: { ...typo.bodySm, fontSize: 15 },

  statusCard: {
    ...card,
    padding: sp.lg, marginBottom: sp.lg,
  },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.xs,
  },
  statusDot: (ok) => ({
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: ok ? colors.success : colors.warn,
  }),
  statusLabel: { ...typo.body, flex: 1 },
  statusBadge: (ok) => ({
    paddingHorizontal: sp.sm, paddingVertical: 3, borderRadius: radius.pill,
    backgroundColor: ok ? colors.successContainer : colors.warnContainer,
    borderWidth: 1,
    borderColor: ok ? colors.successBorder : colors.warnBorder,
  }),
  statusBadgeText: (ok) => ({
    fontSize: 11, fontWeight: '700',
    color: ok ? colors.success : colors.warn,
  }),
  pathText: { ...typo.labelSm, fontSize: 12, color: colors.textSecondary, marginTop: sp.xs },
  pathHint: { ...typo.bodySm, marginTop: sp.xs, lineHeight: 20 },

  actions: { gap: sp.md, marginBottom: sp.xxl },
  btnFilled: { ...btnFilled },
  btnFilledText: { ...typo.titleSm, color: colors.onPrimary },
  btnOutlined: { ...btnOutlined },
  btnOutlinedText: { ...typo.titleSm, color: colors.primary },

  footer: { ...typo.labelSm, textAlign: 'center', lineHeight: 18 },
});
