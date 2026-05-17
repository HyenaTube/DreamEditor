import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, Modal
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { listMiis, importMiiBytes, exportMii, writeMiiSavFiles } from '../utils/MiiProcessor';
import { createBackup } from '../utils/BackupManager';
import { exportAllMiis } from '../utils/SaveEditor';
import { typo, sp, radius } from '../theme';
import { useApp } from '../context/AppContext';

export default function MiiScreen({ route, navigation }) {
  const { saveFolderUri } = route.params;
  const { colors, miiListVersion } = useApp();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [miis, setMiis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [actionMenuVisible, setActionMenuVisible] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listMiis(saveFolderUri);
      setMiis(list);
    } catch (e) {
      Alert.alert('Error loading Miis', e.message);
    } finally {
      setLoading(false);
    }
  }, [saveFolderUri]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (miiListVersion > 0) refresh(); }, [miiListVersion]);

  const doExportAll = useCallback(async () => {
    setBusy(true);
    setProgressText('Pick destination folder…');
    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!result.granted) return;
      const { exported, skipped } = await exportAllMiis(saveFolderUri, result.directoryUri, setProgressText);
      Alert.alert('Done', `Exported ${exported} Mii${exported !== 1 ? 's' : ''}.${skipped ? ` (${skipped} skipped)` : ''}`);
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setBusy(false);
      setProgressText('');
    }
  }, [saveFolderUri]);

  const openActions = useCallback((mii) => {
    if (!mii.initialized) {
      Alert.alert('Empty Slot', `Slot ${mii.slot} has no Mii. Create one in-game first, then you can import here.`);
      return;
    }
    setSelectedSlot(mii);
    setActionMenuVisible(true);
  }, []);

  const doExport = useCallback(async () => {
    if (!selectedSlot) return;
    setActionMenuVisible(false);
    setBusy(true);
    setProgressText('Exporting…');
    try {
      const { ltd, name } = await exportMii(selectedSlot.slot, saveFolderUri, setProgressText);

      // Save to app's document directory with a unique name
      const safeN = (name || `Mii_slot${selectedSlot.slot}`).replace(/[^a-zA-Z0-9._\- ]/g, '_');
      const filename = `${safeN}.ltd`;
      const destPath = FileSystem.documentDirectory + filename;

      await FileSystem.writeAsStringAsync(
        destPath,
        Buffer.from(ltd).toString('base64'),
        { encoding: FileSystem.EncodingType.Base64 }
      );

      Alert.alert(
        'Exported',
        `${name || 'Mii'} exported as "${filename}".\n\nSaved to app documents folder.`
      );
    } catch (e) {
      Alert.alert('Export failed', e.message);
    } finally {
      setBusy(false);
      setProgressText('');
    }
  }, [selectedSlot, saveFolderUri]);

  const doExportToSaf = useCallback(async () => {
    if (!selectedSlot) return;
    setActionMenuVisible(false);

    // First export to temp, then let user pick destination via SAF
    setBusy(true);
    setProgressText('Exporting Mii…');
    try {
      const { ltd, name } = await exportMii(selectedSlot.slot, saveFolderUri, setProgressText);
      const safeN = (name || `Mii_slot${selectedSlot.slot}`).replace(/[^a-zA-Z0-9._\- ]/g, '_');
      const filename = `${safeN}.ltd`;

      setProgressText('Pick a folder to save to…');
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!result.granted) { setBusy(false); setProgressText(''); return; }

      setProgressText('Writing file…');
      const newUri = await StorageAccessFramework.createFileAsync(
        result.directoryUri, filename, 'application/octet-stream'
      );
      await StorageAccessFramework.writeAsStringAsync(
        newUri,
        Buffer.from(ltd).toString('base64'),
        { encoding: FileSystem.EncodingType.Base64 }
      );

      Alert.alert('Done', `${name || 'Mii'} saved as "${filename}".`);
    } catch (e) {
      if (e.message !== 'cancelled') Alert.alert('Export failed', e.message);
    } finally {
      setBusy(false);
      setProgressText('');
    }
  }, [selectedSlot, saveFolderUri]);

  const doImport = useCallback(async () => {
    if (!selectedSlot) return;
    setActionMenuVisible(false);

    let asset;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      asset = r.assets[0];
    } catch (e) { Alert.alert('Error', e.message); return; }

    if (!(asset.name ?? '').toLowerCase().endsWith('.ltd')) {
      Alert.alert('Wrong file', `Expected a .ltd file — got: ${asset.name}`);
      return;
    }

    await new Promise((resolve, reject) => {
      Alert.alert(
        `Import into Slot ${selectedSlot.slot}`,
        `Import "${asset.name}" into slot ${selectedSlot.slot} (${selectedSlot.name})?\n\nA backup will be created first.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('cancelled')) },
          { text: 'Import', onPress: resolve },
        ]
      );
    }).catch(() => null).then(async (confirmed) => {
      if (confirmed === null) return;

      setBusy(true);
      setProgressText('Creating backup…');
      try {
        await createBackup(saveFolderUri, `imported ${asset.name}`, setProgressText);
      } catch (e) {
        // Non-fatal — warn but continue
        console.warn('Backup failed before Mii import:', e.message);
      }

      setProgressText('Reading .ltd file…');
      try {
        let b64;
        try {
          b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        } catch {
          const resp = await fetch(asset.uri);
          b64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
        }
        const ltdBytes = new Uint8Array(Buffer.from(b64, 'base64'));

        const { miisav, playersav, miiSavUri, playerSavUri } = await importMiiBytes(
          selectedSlot.slot, ltdBytes, saveFolderUri, setProgressText
        );

        setProgressText('Writing Mii.sav…');
        await writeMiiSavFiles(saveFolderUri, miiSavUri, playerSavUri, miisav, playersav);

        Alert.alert('Done', `Mii imported into slot ${selectedSlot.slot}.`);
        refresh();
      } catch (e) {
        Alert.alert('Import failed', e.message);
      } finally {
        setBusy(false);
        setProgressText('');
      }
    });
  }, [selectedSlot, saveFolderUri, refresh]);

  const renderItem = useCallback(({ item }) => {
    const isInit = item.initialized;
    return (
      <TouchableOpacity
        style={[styles.card, !isInit && styles.cardEmpty]}
        onPress={() => openActions(item)}
        activeOpacity={0.7}
      >
        <View style={styles.slotBadge}>
          <Text style={styles.slotText}>{item.slot}</Text>
        </View>
        <View style={styles.cardInfo}>
          {isInit ? (
            <Text style={styles.cardName}>{item.name || '(no name)'}</Text>
          ) : (
            <Text style={styles.cardEmpty_text}>Empty slot</Text>
          )}
          <Text style={styles.cardSub}>
            {isInit ? 'Tap to import / export' : 'Create a Mii in-game first'}
          </Text>
        </View>
        {isInit && <Text style={styles.chevron}>›</Text>}
      </TouchableOpacity>
    );
  }, [openActions]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Progress overlay */}
      <Modal visible={busy} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.overlayBox}>
            <ActivityIndicator size="large" color="#f5c518" />
            <Text style={styles.overlayText}>{progressText || 'Working…'}</Text>
          </View>
        </View>
      </Modal>

      {/* Action menu modal */}
      <Modal
        visible={actionMenuVisible && !!selectedSlot}
        transparent
        animationType="slide"
        onRequestClose={() => setActionMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuBackdrop}
          activeOpacity={1}
          onPress={() => setActionMenuVisible(false)}
        >
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle}>
              Slot {selectedSlot?.slot}: {selectedSlot?.name || '(no name)'}
            </Text>

            <TouchableOpacity style={styles.menuItem} onPress={doImport}>
              <Text style={styles.menuIcon}>📥</Text>
              <View>
                <Text style={styles.menuItemTitle}>Import .ltd</Text>
                <Text style={styles.menuItemSub}>Replace this Mii from a .ltd file</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItem} onPress={doExportToSaf}>
              <Text style={styles.menuIcon}>📤</Text>
              <View>
                <Text style={styles.menuItemTitle}>Export .ltd</Text>
                <Text style={styles.menuItemSub}>Save this Mii to a folder of your choice</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setActionMenuVisible(false);
                navigation.navigate('MiiStats', { saveFolderUri, mii: selectedSlot });
              }}
            >
              <Text style={styles.menuIcon}>📊</Text>
              <View>
                <Text style={styles.menuItemTitle}>View Stats</Text>
                <Text style={styles.menuItemSub}>Edit level and personality fields</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.menuItem, styles.menuCancel]}
              onPress={() => setActionMenuVisible(false)}
            >
              <Text style={[styles.menuItemTitle, { color: colors.textDisabled }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Miis</Text>
          <Text style={styles.headerSub}>70 slots · tap to import / export</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: sp.xs }}>
          <TouchableOpacity style={styles.exportAllBtn} onPress={doExportAll}>
            <Text style={styles.exportAllText}>⬇ All</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
            <Text style={styles.refreshText}>↺</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#f5c518" />
          <Text style={styles.loadingText}>Loading Miis…</Text>
        </View>
      ) : (
        <FlatList
          data={miis}
          keyExtractor={item => String(item.slot)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: sp.md, padding: sp.xl,
  },
  loadingText: { ...typo.body, color: c.textSecondary, marginTop: sp.sm },

  // ── App bar ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.outline,
    backgroundColor: c.surface,
  },
  headerTitle: { ...typo.title, fontSize: 19 },
  headerSub:   { ...typo.labelSm, marginTop: 2 },

  exportAllBtn: {
    backgroundColor: c.primaryContainer,
    paddingHorizontal: sp.md, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.primaryDim,
  },
  exportAllText: { ...typo.label, color: c.primary, fontWeight: '700' },

  refreshBtn: {
    backgroundColor: c.chip,
    paddingHorizontal: 11, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.outline,
  },
  refreshText: { color: c.textSecondary, fontSize: 16 },

  // ── List ──────────────────────────────────────────────────────────────────────
  list: { padding: sp.sm, gap: sp.xs },

  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.outline,
    padding: sp.md,
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    elevation: 1,
  },
  cardEmpty: { opacity: 0.45 },

  slotBadge: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: c.primaryContainer,
    borderWidth: 1, borderColor: c.primaryDim,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  slotText: { ...typo.titleSm, color: c.primary, fontSize: 13 },

  cardInfo: { flex: 1 },
  cardName:       { ...typo.titleSm },
  cardEmpty_text: { ...typo.body, color: c.textDisabled, fontStyle: 'italic' },
  cardSub:        { ...typo.labelSm, marginTop: 2 },
  chevron:        { color: c.textDisabled, fontSize: 22 },

  // ── Progress overlay ─────────────────────────────────────────────────────────
  overlay: {
    flex: 1, backgroundColor: c.scrim,
    justifyContent: 'center', alignItems: 'center',
  },
  overlayBox: {
    backgroundColor: c.elevated, borderRadius: radius.xl, padding: sp.xxl,
    alignItems: 'center', gap: sp.md, minWidth: 220,
    borderWidth: 1, borderColor: c.outlineVar,
  },
  overlayText: { ...typo.body, color: c.textPrimary, textAlign: 'center' },

  // ── Bottom sheet ─────────────────────────────────────────────────────────────
  menuBackdrop: {
    flex: 1, backgroundColor: c.scrim,
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: c.elevated,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: c.outlineVar,
    padding: sp.xl, paddingBottom: 40, gap: sp.xs,
  },
  menuTitle: {
    ...typo.titleMd, color: c.primary,
    marginBottom: sp.md, textAlign: 'center',
  },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    padding: sp.md, borderRadius: radius.lg,
    backgroundColor: c.surfaceVar,
    borderWidth: 1, borderColor: c.outline,
    marginBottom: sp.xs,
  },
  menuCancel: {
    backgroundColor: 'transparent', borderColor: 'transparent',
    justifyContent: 'center',
  },
  menuIcon:      { fontSize: 22 },
  menuItemTitle: { ...typo.titleSm },
  menuItemSub:   { ...typo.labelSm, marginTop: 2 },
});
