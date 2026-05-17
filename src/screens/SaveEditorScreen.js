import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { typo, sp, radius } from '../theme';
import { createBackup } from '../utils/BackupManager';
import { listMiis } from '../utils/MiiProcessor';
import {
  readSavFileBytes, writeSavFileBytes,
  setMiiStats, getMiiLevels,
} from '../utils/SaveEditor';

export default function SaveEditorScreen({ navigation }) {
  const { colors, saveFolderUri } = useApp();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [progress, setProgress] = useState('');
  const [miis, setMiis]         = useState([]);
  const [miiSavUri, setMiiSavUri] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [miiList, miiSav] = await Promise.all([
        listMiis(saveFolderUri),
        readSavFileBytes(saveFolderUri, 'Mii.sav'),
      ]);

      setMiiSavUri(miiSav.uri);

      const initialized = miiList.filter(m => m.initialized);
      const slots = initialized.map(m => m.slot);
      const levels = getMiiLevels(miiSav.bytes, slots);
      setMiis(initialized.map(m => ({
        ...m,
        levelInput: levels[m.slot] != null ? String(levels[m.slot]) : '',
      })));
    } catch (e) {
      Alert.alert('Error loading saves', e.message);
    } finally {
      setLoading(false);
    }
  }, [saveFolderUri]);

  useEffect(() => { load(); }, [load]);

  const updateLevel = useCallback((slot, val) => {
    setMiis(prev => prev.map(m => m.slot === slot ? { ...m, levelInput: val } : m));
  }, []);

  const saveLevels = useCallback(async () => {
    setBusy(true);
    setProgress('Creating backup…');
    try {
      try { await createBackup(saveFolderUri, 'level edit', setProgress); } catch {}
      setProgress('Reading Mii.sav…');
      let { bytes, uri } = await readSavFileBytes(saveFolderUri, 'Mii.sav');

      setProgress('Applying changes…');
      for (const mii of miis) {
        const lvl = parseInt(mii.levelInput, 10);
        if (isNaN(lvl) || lvl < 0) continue;
        bytes = setMiiStats(bytes, mii.slot, { level: lvl });
      }

      setProgress('Writing Mii.sav…');
      const newUri = await writeSavFileBytes(saveFolderUri, uri, 'Mii.sav', bytes);
      setMiiSavUri(newUri);
      Alert.alert('Saved', 'All Mii levels updated.');
    } catch (e) {
      Alert.alert('Failed', e.message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [saveFolderUri, miis]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadText}>Loading saves…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Modal visible={busy} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.overlayBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.overlayText}>{progress || 'Working…'}</Text>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Save Editor</Text>
          <Text style={styles.headerSub}>Mii.sav · {miis.length} active Miis</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={load}>
          <Text style={styles.refreshText}>↺</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionLabel}>MII LEVELS</Text>
          <TouchableOpacity style={styles.saveAllBtn} onPress={saveLevels}>
            <Text style={styles.saveAllText}>Save all</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          {miis.length === 0 ? (
            <Text style={styles.emptyText}>No initialized Miis found.</Text>
          ) : (
            miis.map((mii, i) => (
              <View key={mii.slot} style={[styles.levelRow, i > 0 && styles.rowBorder]}>
                <View style={styles.slotBadge}>
                  <Text style={styles.slotText}>{mii.slot}</Text>
                </View>
                <Text style={styles.miiName} numberOfLines={1}>{mii.name || '(unnamed)'}</Text>
                <TextInput
                  style={styles.levelInput}
                  value={mii.levelInput}
                  onChangeText={(v) => updateLevel(mii.slot, v)}
                  keyboardType="number-pad"
                  maxLength={6}
                  placeholderTextColor={colors.textDisabled}
                  placeholder="—"
                />
                <TouchableOpacity
                  style={styles.statsBtn}
                  onPress={() => navigation.navigate('MiiStats', { saveFolderUri, mii })}
                >
                  <Text style={styles.statsBtnText}>Stats →</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Tap "Stats →" to view and edit personality and gameplay fields for a Mii.
            Use "Save all" to write all level changes at once.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  centered:  { flex: 1, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center', gap: sp.md },
  loadText:  { ...typo.body, color: c.textSecondary },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.outline,
    backgroundColor: c.surface,
  },
  headerTitle: { ...typo.title, fontSize: 19 },
  headerSub:   { ...typo.labelSm, marginTop: 2 },
  refreshBtn: {
    backgroundColor: c.chip, paddingHorizontal: 11, paddingVertical: 8,
    borderRadius: radius.pill, borderWidth: 1, borderColor: c.outline,
  },
  refreshText: { color: c.textSecondary, fontSize: 16 },

  content: { padding: sp.lg, paddingBottom: 48 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: sp.sm, marginTop: sp.xs,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.2, color: c.textDisabled,
  },
  saveAllBtn: {
    backgroundColor: c.primaryContainer, paddingHorizontal: sp.md, paddingVertical: 6,
    borderRadius: radius.pill, borderWidth: 1, borderColor: c.primaryDim,
  },
  saveAllText: { fontSize: 12, fontWeight: '700', color: c.primary },

  card: {
    backgroundColor: c.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.outline, overflow: 'hidden',
  },
  emptyText: { ...typo.body, color: c.textDisabled, padding: sp.lg, textAlign: 'center' },

  levelRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: sp.md, paddingVertical: 10, gap: sp.sm,
  },
  rowBorder:  { borderTopWidth: 1, borderTopColor: c.outline },
  slotBadge: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.primaryContainer,
    borderWidth: 1, borderColor: c.primaryDim,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  slotText: { fontSize: 12, fontWeight: '700', color: c.primary },
  miiName:  { ...typo.body, flex: 1, color: c.textPrimary },
  levelInput: {
    color: c.primary, fontSize: 14, fontWeight: '600',
    textAlign: 'right', width: 64,
    backgroundColor: c.surfaceVar, borderRadius: radius.sm,
    paddingHorizontal: sp.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: c.outlineVar,
  },
  statsBtn: {
    backgroundColor: c.chip, paddingHorizontal: sp.sm, paddingVertical: 6,
    borderRadius: radius.md, borderWidth: 1, borderColor: c.outline, flexShrink: 0,
  },
  statsBtnText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },

  infoBox: {
    backgroundColor: c.successContainer, borderRadius: radius.md,
    borderLeftWidth: 3, borderLeftColor: c.success,
    padding: sp.md, marginTop: sp.lg,
  },
  infoText: { ...typo.bodySm, color: c.textSecondary, lineHeight: 18 },

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
});
