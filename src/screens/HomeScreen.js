import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../context/AppContext';
import { useNavigation } from '@react-navigation/native';

const QuickCard = ({ icon, title, sub, onPress, colors }) => (
  <TouchableOpacity
    style={[qc.card, { backgroundColor: colors.surface, borderColor: colors.outline }]}
    onPress={onPress}
    activeOpacity={0.75}
  >
    <Text style={qc.icon}>{icon}</Text>
    <Text style={[qc.title, { color: colors.textPrimary }]}>{title}</Text>
    <Text style={[qc.sub, { color: colors.textSecondary }]}>{sub}</Text>
  </TouchableOpacity>
);

const qc = StyleSheet.create({
  card: {
    flex: 1, borderRadius: 16, borderWidth: 1,
    padding: 16, alignItems: 'flex-start', gap: 4,
    elevation: 1,
  },
  icon:  { fontSize: 28, marginBottom: 4 },
  title: { fontSize: 14, fontWeight: '700' },
  sub:   { fontSize: 12 },
});

export default function HomeScreen() {
  const { colors, typo, sp, saveFolderUri } = useApp();
  const navigation = useNavigation();
  const s = makeStyles(colors, sp);

  const displayPath = saveFolderUri
    ? decodeURIComponent(saveFolderUri).split('/').slice(-3).join(' / ')
    : 'None selected';

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <StatusBar style="light" />

      {/* Hero */}
      <View style={s.hero}>
        <Text style={s.heroEmoji}>🏝️</Text>
        <View>
          <Text style={s.heroTitle}>TomoPhonEdit</Text>
          <Text style={s.heroSub}>Tomodachi Life · Living the Dream</Text>
        </View>
      </View>

      {/* Save folder status */}
      <View style={s.folderCard}>
        <View style={s.folderRow}>
          <View style={[s.dot, { backgroundColor: saveFolderUri ? colors.success : colors.warn }]} />
          <Text style={s.folderLabel}>Save folder</Text>
        </View>
        <Text style={s.folderPath} numberOfLines={2}>{displayPath}</Text>
      </View>

      {/* Quick actions grid */}
      <Text style={s.sectionLabel}>QUICK ACTIONS</Text>
      <View style={s.grid}>
        <QuickCard
          icon="👗"
          title="UGC Browser"
          sub="Browse & edit item textures"
          colors={colors}
          onPress={() => navigation.navigate('UGCTab')}
        />
        <QuickCard
          icon="🧑"
          title="Mii Manager"
          sub="Import & export Miis"
          colors={colors}
          onPress={() => navigation.navigate('MiisTab')}
        />
      </View>
      <View style={s.grid}>
        <QuickCard
          icon="💾"
          title="Backups"
          sub="Restore save states"
          colors={colors}
          onPress={() => navigation.navigate('SettingsTab', { screen: 'Backups' })}
        />
        <QuickCard
          icon="⚙️"
          title="Settings"
          sub="Theme & preferences"
          colors={colors}
          onPress={() => navigation.navigate('SettingsTab')}
        />
      </View>

      {/* Import tip */}
      <View style={s.tipCard}>
        <Text style={s.tipIcon}>💡</Text>
        <Text style={s.tipText}>
          Tap the <Text style={{ color: colors.primary, fontWeight: '700' }}>+</Text> button in the centre of the tab bar to quickly import any Mii or item file.
        </Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c, sp) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: c.bg },
  content: { padding: sp.lg, paddingBottom: sp.xxl + 16 },

  hero: {
    flexDirection: 'row', alignItems: 'center',
    gap: sp.md, marginBottom: sp.lg,
    paddingTop: sp.md,
  },
  heroEmoji: { fontSize: 44 },
  heroTitle: { fontSize: 22, fontWeight: '700', color: c.textPrimary },
  heroSub:   { fontSize: 13, color: c.textSecondary, marginTop: 2 },

  folderCard: {
    backgroundColor: c.surface, borderRadius: 16,
    borderWidth: 1, borderColor: c.outline,
    padding: sp.md, marginBottom: sp.lg,
  },
  folderRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: 4 },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  folderLabel: { fontSize: 13, fontWeight: '600', color: c.textPrimary, flex: 1 },
  folderPath: { fontSize: 11, color: c.textSecondary, lineHeight: 16 },

  sectionLabel: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.2,
    color: c.textDisabled, marginBottom: sp.sm, marginTop: sp.sm,
  },
  grid: { flexDirection: 'row', gap: sp.sm, marginBottom: sp.sm },

  tipCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: sp.sm,
    backgroundColor: c.primaryContainer,
    borderRadius: 12, borderWidth: 1, borderColor: c.primaryDim,
    padding: sp.md, marginTop: sp.md,
  },
  tipIcon: { fontSize: 18 },
  tipText: { flex: 1, fontSize: 13, color: c.textSecondary, lineHeight: 19 },
});
