import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { useApp } from '../context/AppContext';

export default function OnboardingScreen() {
  const { setSaveFolder, colors } = useApp();
  const [step, setStep] = useState(0);
  const [picking, setPicking] = useState(false);

  const pickFolder = async () => {
    setPicking(true);
    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!result.granted) return;
      await setSaveFolder(result.directoryUri);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPicking(false);
    }
  };

  const s = makeStyles(colors);

  // ── Step 0: Welcome ─────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.hero}>
          <View style={s.logoRing}>
            <Text style={s.logoEmoji}>🏝️</Text>
          </View>
          <Text style={s.appName}>DreamEditor</Text>
          <Text style={s.appSub}>Tomodachi Life · Living the Dream</Text>
          <Text style={s.appSub2}>Title ID 010051F0207B2000</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Welcome!</Text>
          <Text style={s.cardBody}>
            Edit Mii characters, swap item textures, import &amp; export content, and keep automatic backups — all from your phone.
          </Text>
          <Text style={[s.cardBody, { marginTop: 12 }]}>
            You'll need to point the app at your game's save folder to get started.
          </Text>
        </View>

        <TouchableOpacity style={s.primaryBtn} onPress={() => setStep(1)} activeOpacity={0.8}>
          <Text style={s.primaryBtnText}>Get started  →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Step 1: Folder picker ────────────────────────────────────────────────────
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={s.root}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar style="light" />

      <View style={s.stepRow}>
        <View style={[s.stepDot, s.stepDotDone]} />
        <View style={s.stepLine} />
        <View style={[s.stepDot, s.stepDotActive]} />
      </View>

      <View style={s.hero}>
        <Text style={s.stepIcon}>📁</Text>
        <Text style={s.stepTitle}>Choose your save folder</Text>
        <Text style={s.stepSub}>
          Select the folder that <Text style={{ color: colors.primary, fontWeight: '700' }}>directly contains</Text> these files:
        </Text>
      </View>

      {/* Folder tree */}
      <View style={s.treeCard}>
        <TreeRow label="YourSaveFolder/" indent={0} isFolder colors={colors} />
        <TreeRow label="Mii.sav" indent={1} colors={colors} required />
        <TreeRow label="Player.sav" indent={1} colors={colors} required />
        <TreeRow label="Map.sav" indent={1} colors={colors} />
        <TreeRow label="Ugc/" indent={1} isFolder colors={colors} required />
        <TreeRow label="Food/" indent={2} isFolder colors={colors} />
        <TreeRow label="Clothing/" indent={2} isFolder colors={colors} />
        <TreeRow label="Goods/" indent={2} isFolder colors={colors} />
        <TreeRow label="Interior/" indent={2} isFolder colors={colors} />
        <TreeRow label="…" indent={2} colors={colors} muted />
      </View>

      <View style={s.hintCard}>
        <Text style={s.hintTitle}>Where to find it</Text>
        <HintRow label="Ryujinx" value="user/0000000000000001/save/010051F0207B2000/0/" colors={colors} />
        <HintRow label="Sudachi / Yuzu" value="user_save_data/0000000000000001/010051F0207B2000/0/" colors={colors} />
        <HintRow label="Citron" value="nand/user/save/0000000000000000/…/010051F0207B2000/" colors={colors} />
        <Text style={[s.hintNote, { marginTop: 8 }]}>
          Navigate <Text style={{ color: colors.primary }}>into</Text> the folder so you can see Mii.sav and the Ugc/ folder listed — then tap "Use this folder".
        </Text>
        <Text style={[s.hintNote, { marginTop: 6 }]}>
          Most emulators let you change where saves are stored. If you can't find yours at the default path, check the emulator settings and point DreamEditor at the custom location.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>What you're granting</Text>
        <BulletRow icon="✓" text="Read save files (Mii.sav, Player.sav, Map.sav)" colors={colors} />
        <BulletRow icon="✓" text="Read & write UGC textures (Ugc/*/)" colors={colors} />
        <BulletRow icon="✓" text="Write modified save files back" colors={colors} />
        <BulletRow icon="✗" text="No access outside the folder you choose" colors={colors} negative />
      </View>

      <TouchableOpacity
        style={[s.primaryBtn, picking && s.btnDisabled]}
        onPress={pickFolder}
        disabled={picking}
        activeOpacity={0.8}
      >
        <Text style={s.primaryBtnText}>
          {picking ? 'Opening…' : 'Choose save folder'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.backBtn} onPress={() => setStep(0)}>
        <Text style={s.backBtnText}>← Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const TreeRow = ({ label, indent, isFolder, required, muted, colors }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingLeft: 4 + indent * 18 }}>
    <Text style={{ color: muted ? colors.textDisabled : colors.textDisabled, fontSize: 12, marginRight: 4, fontFamily: 'monospace' }}>
      {indent > 0 ? '├─ ' : ''}
    </Text>
    <Text style={{
      fontFamily: 'monospace', fontSize: 13,
      color: required ? colors.primary : muted ? colors.textDisabled : colors.textSecondary,
      fontWeight: required ? '700' : '400',
    }}>
      {isFolder ? '📁 ' : '📄 '}{label}
    </Text>
    {required && (
      <Text style={{ fontSize: 10, color: colors.primary, marginLeft: 6, fontWeight: '700' }}>required</Text>
    )}
  </View>
);

const HintRow = ({ label, value, colors }) => (
  <View style={{ marginTop: 8 }}>
    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>{label}</Text>
    <Text style={{ fontSize: 11, color: colors.textDisabled, fontFamily: 'monospace', marginTop: 2, lineHeight: 16 }}>
      {value}
    </Text>
  </View>
);

const BulletRow = ({ icon, text, colors, negative }) => (
  <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
    <Text style={{ color: negative ? colors.danger : colors.success, fontWeight: '700', marginTop: 1 }}>{icon}</Text>
    <Text style={{ color: negative ? colors.textSecondary : colors.textPrimary, fontSize: 13, flex: 1 }}>{text}</Text>
  </View>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c) => StyleSheet.create({
  root: {
    backgroundColor: c.bg,
    paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40,
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', marginBottom: 20 },
  logoRing: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: c.primaryContainer,
    borderWidth: 2, borderColor: c.primaryDim,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  logoEmoji:  { fontSize: 48 },
  appName:    { fontSize: 28, fontWeight: '700', color: c.textPrimary, letterSpacing: -0.5 },
  appSub:     { fontSize: 14, color: c.textSecondary, marginTop: 4 },
  appSub2:    { fontSize: 11, color: c.textDisabled, marginTop: 2 },

  stepRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', marginBottom: 28, gap: 0,
  },
  stepDot:       { width: 12, height: 12, borderRadius: 6 },
  stepDotDone:   { backgroundColor: c.primaryDim },
  stepDotActive: { backgroundColor: c.primary, width: 16, height: 16, borderRadius: 8 },
  stepLine:      { width: 40, height: 2, backgroundColor: c.primaryDim, marginHorizontal: 6 },

  stepIcon:  { fontSize: 52, marginBottom: 12 },
  stepTitle: { fontSize: 22, fontWeight: '700', color: c.textPrimary, marginBottom: 10 },
  stepSub:   { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },

  treeCard: {
    backgroundColor: c.surface, borderRadius: 12,
    borderWidth: 1, borderColor: c.outline,
    padding: 14, marginBottom: 14,
  },

  hintCard: {
    backgroundColor: c.primaryContainer, borderRadius: 12,
    borderWidth: 1, borderColor: c.primaryDim,
    padding: 14, marginBottom: 14,
  },
  hintTitle: { fontSize: 13, fontWeight: '700', color: c.textPrimary, marginBottom: 4 },
  hintNote:  { fontSize: 12, color: c.textSecondary, lineHeight: 18 },

  card: {
    backgroundColor: c.surface, borderRadius: 16,
    borderWidth: 1, borderColor: c.outline,
    padding: 16, marginBottom: 20,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: c.textPrimary, marginBottom: 8 },
  cardBody:  { fontSize: 14, color: c.textSecondary, lineHeight: 21 },

  primaryBtn: {
    backgroundColor: c.primary, borderRadius: 100,
    paddingVertical: 15, alignItems: 'center', marginBottom: 12,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: c.onPrimary },
  btnDisabled: { opacity: 0.5 },
  backBtn: { alignItems: 'center', paddingVertical: 8 },
  backBtnText: { fontSize: 14, color: c.textSecondary },
});
