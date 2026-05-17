import React, { useState, useEffect, useCallback, memo, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, TextInput, Alert, Modal, Platform
} from 'react-native';
import { typo, sp, radius } from '../theme';
import { useApp } from '../context/AppContext';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import {
  scanTextureEntries, readTextureFile,
  parseLtdFile, importNewItem, findPlayerSavUri, savePlayerSav,
} from '../utils/BinaryTextureProcessor';
import { createBackup } from '../utils/BackupManager';

// ─── Lazy thumbnail item ──────────────────────────────────────────────────────

const TextureItem = memo(({ entry, onPress, colors }) => {
  const [thumb, setThumb] = useState(null);
  const [loading, setLoading] = useState(true);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const uri = entry.thumbUri || entry.ugctexUri;
        const result = await readTextureFile(uri);
        if (!cancelled) setThumb(result.pngBase64);
      } catch {
        // silently leave thumb null — shows placeholder
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [entry.thumbUri, entry.ugctexUri]);

  return (
    <TouchableOpacity style={styles.item} onPress={() => onPress(entry)} activeOpacity={0.7}>
      <View style={styles.thumbBox}>
        {loading ? (
          <ActivityIndicator size="small" color="#f5c518" />
        ) : thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumbImage} resizeMode="contain" />
        ) : (
          <Text style={styles.thumbPlaceholder}>?</Text>
        )}
      </View>
      <Text style={styles.itemName} numberOfLines={2}>{entry.name}</Text>
    </TouchableOpacity>
  );
});

// ─── Main screen ──────────────────────────────────────────────────────────────

const LTD_TYPES = ['Food','Clothing','Goods','Interior','Exterior','Objects','Landscaping'];

export default function ViewerScreen({ route, navigation }) {
  const { folderPath } = route.params;
  const { colors } = useApp();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addProgress, setAddProgress] = useState('');
  // saveFolderUri from the first scanned entry (set when user picked parent folder)
  const [saveFolderUri, setSaveFolderUri] = useState(null);

  const scan = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const found = await scanTextureEntries(folderPath);
      setEntries(found);
      if (found.length > 0 && found[0].saveFolderUri) {
        setSaveFolderUri(found[0].saveFolderUri);
      }
      if (found.length === 0) setError('No texture files found in the selected folder.');
    } catch (e) {
      setError('Failed to scan folder: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [folderPath]);

  useEffect(() => { scan(); }, [scan]);

  // ── Add new item ────────────────────────────────────────────────────────────

  const addNewItem = useCallback(async () => {
    // Pick LTD file
    let asset;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      asset = r.assets[0];
    } catch (e) { Alert.alert('Error', e.message); return; }

    const validExts = ['.ltd','.ltdf','.ltdc','.ltdg','.ltdi','.ltde','.ltdo','.ltdl'];
    if (!validExts.some(x => (asset.name ?? '').toLowerCase().endsWith(x))) {
      Alert.alert('Wrong file', `Expected .ltdf / .ltdc / … — got: ${asset.name}`);
      return;
    }

    setAddBusy(true);
    setAddProgress('Reading file…');
    try {
      let b64;
      try {
        b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      } catch {
        const resp = await fetch(asset.uri);
        b64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
      }
      const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      setAddProgress('Parsing…');
      const parsed = parseLtdFile(bytes);
      const typeName = LTD_TYPES[parsed.rawData[0]] ?? 'Unknown';

      // Determine ugcFolderUri — from entries (already scanned)
      const ugcFolderUri = entries[0]?.folderUri;
      if (!ugcFolderUri) throw new Error('No texture folder known — rescan first.');

      // Find Player.sav
      const playerSavUri = saveFolderUri ? await findPlayerSavUri(saveFolderUri) : null;

      // Confirm with user
      await new Promise((resolve, reject) => {
        Alert.alert(
          `Add New ${typeName}`,
          `"${parsed.itemName || asset.name}" will be imported into the next free ${typeName} slot.` +
          (playerSavUri ? '\n\nPlayer.sav found — name & stats will also be set.' : '\n\nNo Player.sav detected — textures only.'),
          [
            { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('cancelled')) },
            { text: 'Import', onPress: resolve },
          ]
        );
      });

      // Create backup before modifying save data
      if (saveFolderUri) {
        setAddProgress('Creating backup…');
        try {
          await createBackup(saveFolderUri, `imported ${asset.name}`, setAddProgress);
        } catch (backupErr) {
          console.warn('Backup failed before import:', backupErr.message);
        }
      }

      let playerSavBytes = null;
      if (playerSavUri) {
        setAddProgress('Reading Player.sav…');
        const savB64 = await FileSystem.readAsStringAsync(playerSavUri, { encoding: FileSystem.EncodingType.Base64 });
        playerSavBytes = new Uint8Array(Buffer.from(savB64, 'base64'));
      }

      const result = await importNewItem(
        parsed, ugcFolderUri, saveFolderUri, playerSavBytes, setAddProgress
      );

      if (result.modifiedSav && playerSavUri) {
        setAddProgress('Writing Player.sav…');
        await savePlayerSav(playerSavUri, saveFolderUri, result.modifiedSav);
      }

      Alert.alert(
        'Done',
        `Added as slot ${result.slot} (${result.stem}).` +
        (result.modifiedSav ? ' Player.sav updated.' : ' Textures only — copy Player.sav manually if needed.')
      );
      scan(); // refresh list
    } catch (e) {
      if (e.message !== 'cancelled') Alert.alert('Import failed', e.message);
    } finally {
      setAddBusy(false);
      setAddProgress('');
    }
  }, [entries, saveFolderUri, scan]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(e => e.stem.toLowerCase().includes(q));
  }, [entries, query]);

  const handlePress = useCallback((entry) => {
    navigation.navigate('Editor', { entry });
  }, [navigation]);

  const renderItem = useCallback(({ item }) => (
    <TextureItem entry={item} onPress={handlePress} colors={colors} />
  ), [handlePress, colors]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#f5c518" />
        <Text style={styles.loadingText}>Scanning textures…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.btn} onPress={scan}>
          <Text style={styles.btnText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnGrey]} onPress={() => navigation.goBack()}>
          <Text style={styles.btnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Progress overlay while adding a new item */}
      <Modal visible={addBusy} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.overlayBox}>
            <ActivityIndicator size="large" color="#f5c518" />
            <Text style={styles.overlayText}>{addProgress || 'Working…'}</Text>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Textures</Text>
          <Text style={styles.headerSub}>
            {filtered.length === entries.length
              ? `${entries.length} items`
              : `${filtered.length} of ${entries.length}`}
          </Text>
        </View>
        <View style={styles.headerBtns}>
          <TouchableOpacity style={styles.addBtn} onPress={addNewItem} disabled={addBusy}>
            <Text style={styles.addText}>+ Add</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.refreshBtn} onPress={scan}>
            <Text style={styles.refreshText}>↺</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter by name…"
          placeholderTextColor="#555"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.stem}
        renderItem={renderItem}
        numColumns={2}
        contentContainerStyle={styles.list}
        removeClippedSubviews
        windowSize={5}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No results for "{query}"</Text>
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (c) => StyleSheet.create({
  container:  { flex: 1, backgroundColor: c.bg },
  centered: {
    flex: 1, backgroundColor: c.bg,
    justifyContent: 'center', alignItems: 'center', padding: sp.xl,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.outline,
    backgroundColor: c.surface,
  },
  headerTitle: { ...typo.title, fontSize: 19 },
  headerSub:   { ...typo.labelSm, marginTop: 2 },
  headerBtns:  { flexDirection: 'row', gap: sp.xs },
  addBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: sp.md, paddingVertical: 8,
    borderRadius: radius.pill,
  },
  addText: { ...typo.titleSm, color: c.onPrimary, fontSize: 13 },
  navBtn: {
    backgroundColor: c.chip,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.outline,
  },
  navBtnText: { ...typo.label, color: c.textSecondary, fontSize: 12 },
  refreshBtn: {
    backgroundColor: c.chip,
    paddingHorizontal: 11, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.outline,
  },
  refreshText: { color: c.textSecondary, fontSize: 16 },
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
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: sp.md, marginVertical: sp.sm,
    backgroundColor: c.surfaceVar, borderRadius: radius.xl,
    paddingHorizontal: sp.md, borderWidth: 1, borderColor: c.outline,
    height: 44,
  },
  searchIcon:  { fontSize: 14, marginRight: sp.sm },
  searchInput: { flex: 1, color: c.textPrimary, fontSize: 14, paddingVertical: 0 },
  clearBtn:    { padding: sp.xs },
  clearText:   { color: c.textDisabled, fontSize: 16, fontWeight: '600' },
  list: { padding: sp.sm, paddingBottom: sp.xxl },
  item: { flex: 1, margin: sp.xs },
  thumbBox: {
    width: '100%', aspectRatio: 1,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1, borderColor: c.outline,
    elevation: 2,
  },
  thumbImage:       { width: '100%', height: '100%' },
  thumbPlaceholder: { fontSize: 32, color: c.chip },
  itemName: {
    ...typo.labelSm, fontSize: 12,
    color: c.textSecondary,
    marginTop: sp.xs, textAlign: 'center',
    paddingHorizontal: 2,
  },
  loadingText: { ...typo.body, color: c.textSecondary, marginTop: sp.lg },
  errorText:   { ...typo.body, color: c.danger, textAlign: 'center', marginBottom: sp.xl },
  btn: {
    backgroundColor: c.primary, padding: 14, borderRadius: radius.pill,
    alignItems: 'center', width: '100%', marginTop: sp.md,
  },
  btnGrey: { backgroundColor: c.chip },
  btnText: { ...typo.titleSm, color: c.onPrimary },
  emptyBox: { alignItems: 'center', paddingTop: 60 },
  emptyText: { ...typo.body, color: c.textDisabled },
});
