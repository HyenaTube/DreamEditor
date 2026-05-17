import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, Modal
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  listBackups, restoreBackup, deleteBackup, pruneBackups,
} from '../utils/BackupManager';
import { typo, sp, radius } from '../theme';
import { useApp } from '../context/AppContext';

export default function BackupScreen({ route }) {
  const { saveFolderUri } = route.params;
  const { colors } = useApp();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progressText, setProgressText] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listBackups(saveFolderUri);
      setBackups(list);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }, [saveFolderUri]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleRestore = useCallback((backup) => {
    Alert.alert(
      'Restore Backup',
      `Restore to:\n"${backup.label}"\n(${backup.timestamp})\n\nThis will OVERWRITE your current save data. Make sure you have a recent backup before continuing.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setProgressText('Starting restore…');
            try {
              await restoreBackup(backup.path, saveFolderUri, setProgressText);
              Alert.alert('Done', 'Backup restored successfully. Restart the app or rescan your folder to see the changes.');
            } catch (e) {
              Alert.alert('Restore failed', e.message);
            } finally {
              setBusy(false);
              setProgressText('');
            }
          },
        },
      ]
    );
  }, [saveFolderUri]);

  const handleDelete = useCallback((backup) => {
    Alert.alert(
      'Delete Backup',
      `Delete "${backup.label}" (${backup.timestamp})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteBackup(backup.filename);
              refresh();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }, [refresh]);

  const renderItem = useCallback(({ item, index }) => (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={styles.indexBadge}>
          <Text style={styles.indexText}>{index + 1}</Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardLabel} numberOfLines={2}>{item.label}</Text>
          <Text style={styles.cardTime}>{item.timestamp}</Text>
        </View>
      </View>
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.restoreBtn]}
          onPress={() => handleRestore(item)}
        >
          <Text style={styles.restoreBtnText}>↩ Restore</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.deleteBtn]}
          onPress={() => handleDelete(item)}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [handleRestore, handleDelete]);

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

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Backups</Text>
          <Text style={styles.headerSub}>
            {backups.length === 0 ? 'No backups yet' : `${backups.length} / 10 slots used`}
          </Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={refresh}>
          <Text style={styles.refreshText}>↺</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Backups are created automatically before any import or save operation.
          Tap Restore to roll back your save folder to that point.
          Max 10 backups — oldest is removed when a new one is created.
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#f5c518" />
        </View>
      ) : backups.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No backups found.</Text>
          <Text style={styles.emptySubText}>Backups appear here after you import or edit items.</Text>
        </View>
      ) : (
        <FlatList
          data={backups}
          keyExtractor={item => item.filename}
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
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: sp.xl,
  },

  // ── App bar ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: sp.lg, paddingTop: sp.md, paddingBottom: sp.md,
    borderBottomWidth: 1, borderBottomColor: c.outline,
    backgroundColor: c.surface,
  },
  headerTitle: { ...typo.title, fontSize: 19 },
  headerSub:   { ...typo.labelSm, marginTop: 2 },

  refreshBtn: {
    backgroundColor: c.chip,
    paddingHorizontal: 11, paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1, borderColor: c.outline,
  },
  refreshText: { color: c.textSecondary, fontSize: 16 },

  // ── Info banner ───────────────────────────────────────────────────────────────
  infoBox: {
    marginHorizontal: sp.md, marginTop: sp.md, marginBottom: sp.xs,
    padding: sp.md,
    backgroundColor: c.successContainer,
    borderRadius: radius.md,
    borderLeftWidth: 3, borderLeftColor: c.success,
  },
  infoText: { ...typo.bodySm, color: c.textSecondary, lineHeight: 18 },

  // ── List ───────────────────────────────────────────────────────────────────────
  list: { padding: sp.sm, gap: sp.xs },

  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: c.outline,
    padding: sp.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    elevation: 1,
  },
  cardLeft: {
    flexDirection: 'row', alignItems: 'center',
    flex: 1, marginRight: sp.sm,
  },
  indexBadge: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: c.primary,
    justifyContent: 'center', alignItems: 'center',
    marginRight: sp.md, flexShrink: 0,
  },
  indexText: { ...typo.titleSm, color: c.onPrimary, fontSize: 13 },

  cardInfo:  { flex: 1 },
  cardLabel: { ...typo.titleSm, fontSize: 14 },
  cardTime:  { ...typo.labelSm, marginTop: 2 },

  cardActions: { flexDirection: 'row', gap: sp.xs, flexShrink: 0 },

  actionBtn: {
    paddingHorizontal: sp.md, paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  restoreBtn: {
    backgroundColor: c.secondaryContainer,
    borderColor: c.secondaryDim,
  },
  restoreBtnText: { ...typo.label, color: c.secondary, fontWeight: '600' },

  deleteBtn: {
    backgroundColor: c.dangerContainer,
    borderColor: c.dangerBorder,
  },
  deleteBtnText: { ...typo.label, color: c.danger, fontWeight: '700', fontSize: 14 },

  emptyText:    { ...typo.body, color: c.textPrimary, textAlign: 'center' },
  emptySubText: { ...typo.bodySm, textAlign: 'center', marginTop: sp.sm },

  // ── Progress overlay ──────────────────────────────────────────────────────────
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
