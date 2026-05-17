import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Alert, ActivityIndicator, ScrollView, SafeAreaView
} from 'react-native';
import { typo, sp, radius } from '../theme';
import { useApp } from '../context/AppContext';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import {
  readTextureFile,
  replaceTextureImage,
  replaceThumbOnly,
  exportTextureToPng,
  exportLtd,
  parseLtdFile,
  importLtdTextures,
  importLtdWithSave,
  parseEntrySlot,
  findPlayerSavUri,
  savePlayerSav,
} from '../utils/BinaryTextureProcessor';
import { createBackup } from '../utils/BackupManager';

export default function EditorScreen({ route, navigation }) {
  const { entry } = route.params;
  const { colors } = useApp();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [currentThumb, setCurrentThumb]   = useState(null);
  const [thumbLoading, setThumbLoading]   = useState(true);
  const [currentInfo, setCurrentInfo]     = useState(null);

  // What we're about to save: image from gallery, or a parsed LTD file
  const [pending, setPending] = useState(null);
  // pending: { type: 'image', uri } | { type: 'ltd', parsed, filename }

  // Pending gallery image for secondary (-2) texture replacement
  const [pendingSecondary, setPendingSecondary] = useState(null);

  // Pending gallery image for thumbnail-only replacement
  const [pendingThumb, setPendingThumb] = useState(null);

  // Optional Player.sav for full LTD import
  const [playerSav, setPlayerSav] = useState(null);
  // playerSav: { uri, name, auto } — the content:// URI needed for read + write-back

  const hasSecondary = !!(entry.ugctex2Uri || entry.canvas2Uri);

  const [busy, setBusy]             = useState(false);
  const [progressText, setProgressText] = useState('');
  const [saveStatus, setSaveStatus] = useState(null);

  const slotInfo = parseEntrySlot(entry.stem); // { kind, slot } or null

  // ── Load current preview ──────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await readTextureFile(entry.thumbUri || entry.ugctexUri);
        if (!cancelled) {
          setCurrentThumb(result.pngBase64);
          setCurrentInfo({ width: result.width, height: result.height });
        }
      } catch { } finally {
        if (!cancelled) setThumbLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry]);

  // Load secondary texture preview
  const [currentSecondary, setCurrentSecondary] = useState(null);
  useEffect(() => {
    if (!entry.ugctex2Uri && !entry.canvas2Uri) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await readTextureFile(entry.ugctex2Uri || entry.canvas2Uri);
        if (!cancelled) setCurrentSecondary(r.pngBase64);
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [entry.ugctex2Uri, entry.canvas2Uri]);

  // Auto-detect Player.sav from saveFolderUri (set when user picked parent save folder)
  useEffect(() => {
    if (!entry.saveFolderUri) return;
    findPlayerSavUri(entry.saveFolderUri)
      .then(uri => { if (uri) setPlayerSav({ uri, name: 'Player.sav', auto: true }); })
      .catch(() => {});
  }, [entry.saveFolderUri]);

  // ── Pickers ───────────────────────────────────────────────────────────────

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to replace textures.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 1,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setPending({ type: 'image', uri: result.assets[0].uri });
      setSaveStatus(null);
    }
  };

  const pickSecondaryImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to replace textures.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 1,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setPendingSecondary(result.assets[0].uri);
      setSaveStatus(null);
    }
  };

  const pickThumbImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Allow photo library access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 1,
    });
    if (!result.canceled && result.assets?.length > 0) {
      setPendingThumb(result.assets[0].uri);
      setSaveStatus(null);
    }
  };

  const pickLtd = async () => {
    let asset;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      asset = r.assets[0];
    } catch (e) { Alert.alert('Error', e.message); return; }

    const validExts = ['.ltd','.ltdf','.ltdc','.ltdg','.ltdi','.ltde','.ltdo','.ltdl'];
    if (!validExts.some(x => (asset.name ?? '').toLowerCase().endsWith(x))) {
      Alert.alert('Wrong file', `Expected .ltdf / .ltdc / .ltdg … — got: ${asset.name}`);
      return;
    }

    setBusy(true);
    setProgressText('Reading file…');
    try {
      let b64;
      try {
        b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      } catch {
        // Fallback for msf: and other schemes unsupported by expo-file-system
        const resp = await fetch(asset.uri);
        if (!resp.ok) throw new Error(`Failed to fetch file: ${resp.status}`);
        b64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
      }
      const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      setProgressText('Parsing…');
      const parsed = parseLtdFile(bytes);
      setPending({ type: 'ltd', parsed, filename: asset.name });
      setSaveStatus(null);
    } catch (e) {
      Alert.alert('Parse error', e.message);
    } finally {
      setBusy(false);
      setProgressText('');
    }
  };

  const pickPlayerSav = async () => {
    let asset;
    try {
      // copyToCacheDirectory:false so we keep the original content:// URI for writing back
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
      if (r.canceled || !r.assets?.length) return;
      asset = r.assets[0];
    } catch (e) { Alert.alert('Error', e.message); return; }

    if (!(asset.name ?? '').toLowerCase().includes('player') &&
        !(asset.name ?? '').toLowerCase().endsWith('.sav')) {
      Alert.alert(
        'Confirm',
        `Selected "${asset.name}" — doesn't look like Player.sav. Use it anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Use it', onPress: () => setPlayerSav({ uri: asset.uri, name: asset.name }) },
        ]
      );
      return;
    }
    setPlayerSav({ uri: asset.uri, name: asset.name });
  };

  // ── Save ──────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!pending && !pendingSecondary) {
      Alert.alert('Nothing to save', 'Pick an image or import a .ltd file first.');
      return;
    }
    setBusy(true);
    setSaveStatus(null);
    setProgressText('');
    try {
      // Create backup before any destructive write
      if (entry.saveFolderUri) {
        const backupLabel = pending?.type === 'ltd'
          ? `imported ${pending.filename ?? 'ltd'} → ${entry.stem}`
          : `replaced texture ${entry.stem}`;
        setProgressText('Creating backup…');
        try {
          await createBackup(entry.saveFolderUri, backupLabel, setProgressText);
        } catch (backupErr) {
          console.warn('Backup failed before save:', backupErr.message);
        }
      }

      if (pending?.type === 'image') {
        await replaceTextureImage(entry, pending.uri, setProgressText, false);
      } else if (pending?.type === 'ltd' && playerSav) {
        // Full import: textures + Player.sav
        setProgressText('Reading Player.sav…');
        const b64 = await FileSystem.readAsStringAsync(playerSav.uri, { encoding: FileSystem.EncodingType.Base64 });
        const savBytes = new Uint8Array(Buffer.from(b64, 'base64'));
        const modified = await importLtdWithSave(pending.parsed, entry, savBytes, setProgressText);
        setProgressText('Writing Player.sav…');
        await savePlayerSav(playerSav.uri, entry.saveFolderUri, modified);
      } else if (pending?.type === 'ltd') {
        // Texture-only import (no Player.sav)
        await importLtdTextures(pending.parsed, entry, setProgressText);
      }
      // Secondary (-2) texture replacement
      if (pendingSecondary) {
        setProgressText('Writing secondary texture…');
        await replaceTextureImage(entry, pendingSecondary, setProgressText, true);
      }
      // Thumbnail-only replacement
      if (pendingThumb) {
        await replaceThumbOnly(entry, pendingThumb, setProgressText);
      }
      setSaveStatus('ok');
      Alert.alert(
        'Saved',
        playerSav
          ? 'Textures and save data updated! Copy the files back to your Switch.'
          : 'Textures replaced. Item name/stats unchanged (no Player.sav selected).',
        [{ text: 'Done', onPress: () => navigation.goBack() }]
      );
    } catch (e) {
      console.error('Save error:', e);
      setSaveStatus('error');
      Alert.alert('Save failed', e.message || 'Unknown error');
    } finally {
      setBusy(false);
      setProgressText('');
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const exportPng = async () => {
    setBusy(true);
    setProgressText('');
    try {
      await exportTextureToPng(entry, setProgressText);
      Alert.alert('Exported', `Saved as ${entry.stem}_export.png in the texture folder.`);
    } catch (e) {
      Alert.alert('Export failed', e.message || 'Unknown error');
    } finally {
      setBusy(false);
      setProgressText('');
    }
  };

  const exportLtdFile = async () => {
    if (!playerSav) {
      Alert.alert('Player.sav needed', 'Select Player.sav first so item name and stats can be exported.');
      return;
    }
    setBusy(true);
    setProgressText('Reading Player.sav…');
    try {
      const b64 = await FileSystem.readAsStringAsync(playerSav.uri, { encoding: FileSystem.EncodingType.Base64 });
      const savBytes = new Uint8Array(Buffer.from(b64, 'base64'));
      const { ltd, itemName, ext } = await exportLtd(entry, savBytes, setProgressText);
      const safeN = (itemName || entry.stem).replace(/[^a-zA-Z0-9._\- ]/g, '_');
      const filename = `${safeN}${ext}`;
      const destPath = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(destPath, Buffer.from(ltd).toString('base64'), {
        encoding: FileSystem.EncodingType.Base64,
      });
      Alert.alert('Exported', `"${filename}" saved to app documents.\n\nShare it via Files or a file manager.`);
    } catch (e) {
      Alert.alert('Export failed', e.message || 'Unknown error');
    } finally {
      setBusy(false);
      setProgressText('');
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const newPreviewUri = pending?.type === 'image'
    ? pending.uri
    : pending?.parsed?.previewPng ?? null;

  const newLabel = pending?.type === 'ltd'
    ? `${pending.parsed.typeName}${pending.parsed.itemName ? ` · ${pending.parsed.itemName}` : ''}`
    : pending?.type === 'image' ? 'Will be resized' : null;

  const ltdKindMismatch = pending?.type === 'ltd' && slotInfo != null
    && pending.parsed.rawData[0] !== slotInfo.kind;

  const canSave = (pending && !ltdKindMismatch) || !!pendingSecondary || !!pendingThumb;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{entry.name}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Preview row ── */}
        <View style={styles.previewRow}>
          <View style={styles.previewCol}>
            <Text style={styles.previewLabel}>Current</Text>
            <View style={styles.previewBox}>
              {thumbLoading
                ? <ActivityIndicator color="#f5c518" />
                : currentThumb
                  ? <Image source={{ uri: currentThumb }} style={styles.previewImg} resizeMode="contain" />
                  : <Text style={styles.placeholderText}>No preview</Text>}
            </View>
            {currentInfo && <Text style={styles.dimText}>{currentInfo.width}×{currentInfo.height}</Text>}
          </View>

          <View style={styles.arrow}><Text style={styles.arrowText}>→</Text></View>

          <View style={styles.previewCol}>
            <Text style={styles.previewLabel}>New</Text>
            <TouchableOpacity style={styles.previewBox} onPress={pickImage} activeOpacity={0.8}>
              {newPreviewUri
                ? <Image source={{ uri: newPreviewUri }} style={styles.previewImg} resizeMode="contain" />
                : <View style={styles.addBox}>
                    <Text style={styles.addText}>＋</Text>
                    <Text style={styles.addSub}>Tap to pick image</Text>
                  </View>}
            </TouchableOpacity>
            {newLabel && <Text style={styles.dimText} numberOfLines={2}>{newLabel}</Text>}
          </View>
        </View>

        {/* ── Info ── */}
        <View style={styles.infoBox}>
          <InfoRow label="Stem"   value={entry.stem} />
          <InfoRow label="Slot"   value={slotInfo ? `${LTD_UGC_TYPES_DISPLAY[slotInfo.kind]} #${slotInfo.slot}` : '—'} />
          <InfoRow label="Main"   value={entry.ugctexUri ? '✓' : '—'} />
          <InfoRow label="Canvas" value={entry.canvasUri ? '✓' : '— (will create)'} />
          <InfoRow label="Thumb"  value={entry.thumbUri  ? '✓' : '— (will create)'} />
        </View>

        {/* ── Status / progress ── */}
        {saveStatus === 'ok' && (
          <View style={[styles.statusBanner, styles.statusOk]}>
            <Text style={styles.statusText}>Saved successfully</Text>
          </View>
        )}
        {saveStatus === 'error' && (
          <View style={[styles.statusBanner, styles.statusErr]}>
            <Text style={styles.statusText}>Save failed — check console</Text>
          </View>
        )}
        {ltdKindMismatch && (
          <View style={[styles.statusBanner, styles.statusWarn]}>
            <Text style={styles.statusText}>
              Warning: file type ({LTD_UGC_TYPES_DISPLAY[pending.parsed.rawData[0]]}) doesn't match slot — save will be blocked
            </Text>
          </View>
        )}
        {progressText !== '' && (
          <View style={styles.progressBanner}>
            <ActivityIndicator size="small" color="#f5c518" style={{ marginRight: 8 }} />
            <Text style={styles.progressText}>{progressText}</Text>
          </View>
        )}

        {/* ── Section: replace with image ── */}
        <Text style={styles.sectionLabel}>Replace with image</Text>
        <TouchableOpacity style={styles.pickBtn} onPress={pickImage} disabled={busy}>
          <Text style={styles.btnText}>
            {pending?.type === 'image' ? 'Change selected image' : 'Select from gallery'}
          </Text>
        </TouchableOpacity>

        {/* ── Section: import from LTD file ── */}
        <Text style={styles.sectionLabel}>Import from item file (.ltdf / .ltdc …)</Text>
        <TouchableOpacity style={styles.ltdBtn} onPress={pickLtd} disabled={busy}>
          <Text style={styles.btnText}>
            {pending?.type === 'ltd' ? `Re-pick .ltd file` : 'Browse & pick item file'}
          </Text>
        </TouchableOpacity>

        {/* Player.sav picker — shown when an LTD file is loaded */}
        {pending?.type === 'ltd' && (
          <TouchableOpacity style={styles.savBtn} onPress={pickPlayerSav} disabled={busy}>
            <Text style={styles.btnText}>
              {playerSav?.auto
                ? `Player.sav: auto-detected — tap to change`
                : playerSav
                  ? `Player.sav: ${playerSav.name} — tap to change`
                  : 'Also pick Player.sav (for name & stats)'}
            </Text>
          </TouchableOpacity>
        )}
        {pending?.type === 'ltd' && !playerSav && (
          <Text style={styles.savHint}>Without Player.sav: textures only. Item name & stats unchanged.</Text>
        )}
        {pending?.type === 'ltd' && playerSav && (
          <Text style={[styles.savHint, { color: '#4caf50' }]}>
            {playerSav.auto ? 'Auto-detected' : 'Selected'}: full import — textures + name + stats + enable flag.
          </Text>
        )}

        {/* ── Section: thumbnail (shown separately, matches LivingTheDreamToolkit behaviour) ── */}
        {entry.thumbUri && (
          <>
            <Text style={styles.sectionLabel}>Thumbnail (_Thumb.ugctex.zs)</Text>
            <View style={styles.previewRow}>
              <View style={styles.previewCol}>
                <Text style={styles.previewLabel}>Current</Text>
                <View style={styles.previewBox}>
                  {currentThumb
                    ? <Image source={{ uri: currentThumb }} style={styles.previewImg} resizeMode="contain" />
                    : <Text style={styles.placeholderText}>—</Text>}
                </View>
              </View>
              <View style={styles.arrow}><Text style={styles.arrowText}>→</Text></View>
              <View style={styles.previewCol}>
                <Text style={styles.previewLabel}>New</Text>
                <TouchableOpacity style={styles.previewBox} onPress={pickThumbImage} activeOpacity={0.8}>
                  {pendingThumb
                    ? <Image source={{ uri: pendingThumb }} style={styles.previewImg} resizeMode="contain" />
                    : <View style={styles.addBox}>
                        <Text style={styles.addText}>＋</Text>
                        <Text style={styles.addSub}>Tap to pick</Text>
                      </View>}
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={[styles.pickBtn, { backgroundColor: '#2a2600' }]} onPress={pickThumbImage} disabled={busy}>
              <Text style={styles.btnText}>
                {pendingThumb ? 'Change thumbnail image' : 'Replace thumbnail only'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Section: secondary texture ── */}
        {hasSecondary && (
          <>
            <Text style={styles.sectionLabel}>Secondary texture (-2 variant)</Text>
            <View style={styles.previewRow}>
              <View style={styles.previewCol}>
                <Text style={styles.previewLabel}>Current</Text>
                <View style={styles.previewBox}>
                  {currentSecondary
                    ? <Image source={{ uri: currentSecondary }} style={styles.previewImg} resizeMode="contain" />
                    : <Text style={styles.placeholderText}>—</Text>}
                </View>
              </View>
              <View style={styles.arrow}><Text style={styles.arrowText}>→</Text></View>
              <View style={styles.previewCol}>
                <Text style={styles.previewLabel}>New</Text>
                <TouchableOpacity style={styles.previewBox} onPress={pickSecondaryImage} activeOpacity={0.8}>
                  {pendingSecondary
                    ? <Image source={{ uri: pendingSecondary }} style={styles.previewImg} resizeMode="contain" />
                    : <View style={styles.addBox}>
                        <Text style={styles.addText}>＋</Text>
                        <Text style={styles.addSub}>Tap to pick</Text>
                      </View>}
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={[styles.pickBtn, { backgroundColor: '#3a3200' }]} onPress={pickSecondaryImage} disabled={busy}>
              <Text style={styles.btnText}>
                {pendingSecondary ? 'Change secondary image' : 'Replace secondary texture'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* Save button */}
        {canSave && (
          <TouchableOpacity
            style={[styles.saveBtn, busy && styles.btnDisabled]}
            onPress={save}
            disabled={busy}
          >
            {busy
              ? <View style={styles.row}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={[styles.btnText, { marginLeft: 10, color: colors.onPrimary }]}>Saving…</Text>
                </View>
              : <Text style={[styles.btnText, { color: colors.onPrimary }]}>Save to device</Text>}
          </TouchableOpacity>
        )}

        {/* Export */}
        <TouchableOpacity style={[styles.exportBtn, busy && styles.btnDisabled]} onPress={exportPng} disabled={busy}>
          <Text style={styles.btnText}>Export current as PNG</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.exportBtn, styles.exportLtdBtn, busy && styles.btnDisabled]} onPress={exportLtdFile} disabled={busy}>
          <Text style={styles.btnText}>Export as .ltd (requires Player.sav)</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Save writes .ugctex.zs, .canvas.zs and _Thumb.ugctex.zs to the UGC folder.{'\n'}
          With Player.sav: also updates item name, stats, and enables the slot.{'\n'}
          A backup is created automatically before each save.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// Friendly display names (not the save-file type index strings)
const LTD_UGC_TYPES_DISPLAY = ['Food','Clothing','Goods','Interior','Exterior','Objects','Landscaping'];

const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
  </View>
);

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },

  // ── App bar ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: sp.lg, paddingVertical: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.outline,
    backgroundColor: c.surface,
  },
  backBtn: { width: 64 },
  backText: { color: c.primary, fontSize: 17, fontWeight: '600' },
  headerTitle: { ...typo.titleMd, flex: 1, textAlign: 'center' },

  content: { padding: sp.lg, paddingBottom: sp.xxl + sp.xl },

  // ── Preview ────────────────────────────────────────────────────────────────
  previewRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: sp.xl,
    gap: sp.sm,
  },
  previewCol: { flex: 1, alignItems: 'center' },
  previewLabel: { ...typo.label, marginBottom: sp.sm },
  previewBox: {
    width: '100%', aspectRatio: 1,
    backgroundColor: c.surfaceVar,
    borderRadius: radius.lg,
    justifyContent: 'center', alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1, borderColor: c.outline,
    elevation: 3,
  },
  previewImg: { width: '100%', height: '100%' },
  placeholderText: { ...typo.bodySm },
  dimText: { ...typo.labelSm, marginTop: sp.xs, textAlign: 'center' },
  addBox: { alignItems: 'center', gap: sp.xs },
  addText: { fontSize: 32, color: c.outlineVar },
  addSub: { ...typo.labelSm },
  arrow: { width: 28, alignItems: 'center' },
  arrowText: { color: c.outlineVar, fontSize: 20 },

  // ── Info card ─────────────────────────────────────────────────────────────
  infoBox: {
    backgroundColor: c.surface, borderRadius: radius.lg, padding: sp.md,
    marginBottom: sp.xl, borderWidth: 1, borderColor: c.outline,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, alignItems: 'center',
  },
  infoLabel: { ...typo.bodySm },
  infoValue: { ...typo.bodySm, color: c.textPrimary, flex: 1, textAlign: 'right', marginLeft: sp.sm },

  // ── Status banners ────────────────────────────────────────────────────────
  statusBanner: {
    borderRadius: radius.md, padding: sp.md,
    marginBottom: sp.md, alignItems: 'center',
    flexDirection: 'row', gap: sp.sm,
  },
  statusOk:   { backgroundColor: c.successContainer, borderWidth: 1, borderColor: c.successBorder },
  statusErr:  { backgroundColor: c.dangerContainer,  borderWidth: 1, borderColor: c.dangerBorder },
  statusWarn: { backgroundColor: c.warnContainer,    borderWidth: 1, borderColor: c.warnBorder },
  statusText: { ...typo.titleSm, flex: 1, textAlign: 'center' },

  progressBanner: {
    flexDirection: 'row', alignItems: 'center', gap: sp.sm,
    backgroundColor: c.primaryContainer, borderRadius: radius.md, padding: sp.md,
    marginBottom: sp.lg, borderWidth: 1, borderColor: c.primaryDim,
  },
  progressText: { ...typo.bodySm, color: c.textPrimary, flex: 1 },

  // ── Section headings ──────────────────────────────────────────────────────
  sectionLabel: { ...typo.overline, marginBottom: sp.sm, marginTop: sp.md },

  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },

  // ── Action buttons ────────────────────────────────────────────────────────
  pickBtn: {
    backgroundColor: c.primaryContainer,
    paddingVertical: 14, borderRadius: radius.pill,
    alignItems: 'center', marginBottom: sp.sm,
    borderWidth: 1, borderColor: c.primaryDim,
  },
  ltdBtn: {
    backgroundColor: c.secondaryContainer,
    paddingVertical: 14, borderRadius: radius.pill,
    alignItems: 'center', marginBottom: sp.sm,
    borderWidth: 1, borderColor: c.secondaryDim,
  },
  savBtn: {
    backgroundColor: c.elevated,
    paddingVertical: 12, borderRadius: radius.pill,
    alignItems: 'center', marginBottom: sp.xs,
    borderWidth: 1, borderColor: c.primary,
  },
  savHint: { ...typo.labelSm, textAlign: 'center', marginBottom: sp.md, paddingHorizontal: sp.sm },

  saveBtn: {
    backgroundColor: c.primary,
    paddingVertical: 16, borderRadius: radius.pill,
    alignItems: 'center', marginBottom: sp.md, marginTop: sp.sm,
    elevation: 4,
  },
  exportBtn: {
    backgroundColor: c.primaryContainer,
    paddingVertical: 14, borderRadius: radius.pill,
    alignItems: 'center', marginBottom: sp.sm,
    borderWidth: 1, borderColor: c.primaryDim,
  },
  exportLtdBtn: {
    backgroundColor: c.successContainer,
    borderColor: c.successBorder,
    marginBottom: sp.xl,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { ...typo.titleSm, color: c.primary },

  hint: { ...typo.labelSm, textAlign: 'center', lineHeight: 18, paddingHorizontal: sp.sm },
});
