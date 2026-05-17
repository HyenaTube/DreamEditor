import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Modal
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { typo, sp, radius } from '../theme';
import { createBackup } from '../utils/BackupManager';
import {
  readSavFileBytes, writeSavFileBytes,
  getMiiStats, setMiiStats, PERSONALITY_FIELDS, STAT_FIELDS,
} from '../utils/SaveEditor';

export default function MiiStatsScreen({ route }) {
  const { saveFolderUri, mii } = route.params;
  const { colors } = useApp();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading]           = useState(true);
  const [busy, setBusy]                 = useState(false);
  const [progressText, setProgress]     = useState('');
  const [savUri, setSavUri]             = useState(null);
  const [level, setLevel]               = useState('');
  const [fields, setFields]             = useState([]);
  const [gameplayFields, setGameplay]   = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { bytes, uri } = await readSavFileBytes(saveFolderUri, 'Mii.sav');
      setSavUri(uri);
      const stats = getMiiStats(bytes, mii.slot);
      setLevel(stats.level != null ? String(stats.level) : '');
      setFields(stats.personality.map(f => ({ ...f, input: f.value != null ? String(f.value) : '' })));
      setGameplay((stats.gameplay ?? []).map(f => ({ ...f, input: f.value != null ? String(f.value) : '' })));
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, [saveFolderUri, mii.slot]);

  useEffect(() => { load(); }, [load]);

  const updateField = useCallback((key, input) => {
    setFields(prev => prev.map(f => f.key === key ? { ...f, input } : f));
  }, []);

  const updateGameplay = useCallback((key, input) => {
    setGameplay(prev => prev.map(f => f.key === key ? { ...f, input } : f));
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    setProgress('Creating backup…');
    try {
      try { await createBackup(saveFolderUri, `stats edit slot ${mii.slot}`, setProgress); } catch {}

      setProgress('Reading Mii.sav…');
      const { bytes, uri } = await readSavFileBytes(saveFolderUri, 'Mii.sav');

      const lvlNum = parseInt(level, 10);
      const persUpdates = [...fields, ...gameplayFields]
        .filter(f => f.input !== '' && !isNaN(parseInt(f.input, 10)))
        .map(f => ({ hash: f.hash, value: parseInt(f.input, 10) >>> 0 }));

      setProgress('Applying…');
      const modified = setMiiStats(bytes, mii.slot, {
        level: !isNaN(lvlNum) ? lvlNum >>> 0 : undefined,
        personality: persUpdates,
      });

      setProgress('Writing Mii.sav…');
      const newUri = await writeSavFileBytes(saveFolderUri, uri, 'Mii.sav', modified);
      setSavUri(newUri);
      Alert.alert('Saved', 'Stats updated successfully.');
    } catch (e) {
      Alert.alert('Save failed', e.message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }, [saveFolderUri, mii.slot, level, fields, gameplayFields]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const GROUPS = [
    { title: 'Personality', keys: ['p1','p2','p3','p4','p5'] },
    { title: 'Voice',       keys: ['v1','v2','v3','v4','v5','v6'] },
    { title: 'Aptitude',    keys: ['s1','s2','s3'] },
    { title: 'Body',        keys: ['b1','b2','b3','b4'] },
  ];

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Modal visible={busy} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.overlayBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.overlayText}>{progressText || 'Working…'}</Text>
          </View>
        </View>
      </Modal>

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{mii.name || `Slot ${mii.slot}`}</Text>
          <Text style={styles.headerSub}>Slot {mii.slot} · Mii stats</Text>
        </View>
        <TouchableOpacity style={styles.saveBtn} onPress={save}>
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Level */}
        <Text style={styles.sectionLabel}>LEVEL</Text>
        <View style={styles.card}>
          <FieldRow
            label="Level"
            value={level}
            onChange={setLevel}
            colors={colors}
            styles={styles}
            first
          />
        </View>

        {/* Personality groups */}
        {GROUPS.map(group => {
          const groupFields = fields.filter(f => group.keys.includes(f.key));
          return (
            <View key={group.title}>
              <Text style={styles.sectionLabel}>{group.title.toUpperCase()}</Text>
              <View style={styles.card}>
                {groupFields.map((f, i) => (
                  <FieldRow
                    key={f.key}
                    label={f.label}
                    value={f.input}
                    onChange={(v) => updateField(f.key, v)}
                    unavailable={f.value == null}
                    colors={colors}
                    styles={styles}
                    first={i === 0}
                  />
                ))}
              </View>
            </View>
          );
        })}

        {/* Gameplay stats */}
        {gameplayFields.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>GAMEPLAY</Text>
            <View style={styles.card}>
              {gameplayFields.map((f, i) => (
                <FieldRow
                  key={f.key}
                  label={f.label}
                  value={f.input}
                  onChange={(v) => updateGameplay(f.key, v)}
                  unavailable={f.value == null}
                  colors={colors}
                  styles={styles}
                  first={i === 0}
                />
              ))}
            </View>
          </View>
        )}

        <View style={styles.warnBox}>
          <Text style={styles.warnText}>
            These are raw uint32 values from Mii.sav. Invalid values can corrupt your save — a backup is created automatically before each write.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const FieldRow = ({ label, value, onChange, unavailable, colors, styles, first }) => (
  <View style={[styles.fieldRow, !first && styles.fieldBorder]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {unavailable ? (
      <Text style={styles.fieldN_A}>N/A</Text>
    ) : (
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        maxLength={10}
        placeholderTextColor={colors.textDisabled}
        placeholder="0"
      />
    )}
  </View>
);

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  centered:  { flex: 1, backgroundColor: c.bg, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.outline,
    backgroundColor: c.surface,
  },
  headerTitle: { ...typo.title, fontSize: 19 },
  headerSub:   { ...typo.labelSm, marginTop: 2 },
  saveBtn: {
    backgroundColor: c.primary, paddingHorizontal: sp.lg,
    paddingVertical: 9, borderRadius: radius.pill, marginLeft: sp.md,
  },
  saveBtnText: { ...typo.titleSm, color: c.onPrimary, fontSize: 13 },

  content: { padding: sp.lg, paddingBottom: 48 },

  sectionLabel: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.2,
    color: c.textDisabled, marginBottom: sp.sm, marginTop: sp.md,
  },
  card: {
    backgroundColor: c.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.outline, overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: sp.md, paddingVertical: 10,
  },
  fieldBorder: { borderTopWidth: 1, borderTopColor: c.outline },
  fieldLabel: { ...typo.body, flex: 1, color: c.textPrimary },
  fieldInput: {
    color: c.primary, fontSize: 14, fontWeight: '600',
    textAlign: 'right', minWidth: 90,
    backgroundColor: c.surfaceVar, borderRadius: radius.sm,
    paddingHorizontal: sp.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: c.outlineVar,
  },
  fieldN_A: { ...typo.body, color: c.textDisabled },

  warnBox: {
    backgroundColor: c.warnContainer, borderRadius: radius.md,
    borderLeftWidth: 3, borderLeftColor: c.warn,
    padding: sp.md, marginTop: sp.lg,
  },
  warnText: { ...typo.bodySm, color: c.textSecondary, lineHeight: 18 },

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
