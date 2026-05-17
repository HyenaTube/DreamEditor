import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { useApp } from '../context/AppContext';

export default function OnboardingScreen() {
  const { setSaveFolder, colors } = useApp();
  const [step, setStep] = useState(0); // 0=welcome, 1=folder
  const [picking, setPicking] = useState(false);

  const pickFolder = async () => {
    setPicking(true);
    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!result.granted) return;
      await setSaveFolder(result.directoryUri);
      // AppContext sets folderReady → App.js switches to main tabs automatically
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setPicking(false);
    }
  };

  const s = makeStyles(colors);

  if (step === 0) {
    return (
      <View style={s.root}>
        <StatusBar style="light" />
        <View style={s.hero}>
          <View style={s.logoRing}>
            <Text style={s.logoEmoji}>🏝️</Text>
          </View>
          <Text style={s.appName}>TomoPhonEdit</Text>
          <Text style={s.appSub}>Tomodachi Life · Living the Dream</Text>
          <Text style={s.appSub2}>Title ID 010051F0207B2000</Text>
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>Welcome!</Text>
          <Text style={s.cardBody}>
            Edit Mii characters, swap item textures, import &amp; export content, and keep automatic backups — all from your phone.
          </Text>
          <Text style={s.cardBody} style={{ ...s.cardBody, marginTop: 12 }}>
            You'll need to grant access to your save folder once to get started.
          </Text>
        </View>

        <TouchableOpacity style={s.primaryBtn} onPress={() => setStep(1)} activeOpacity={0.8}>
          <Text style={s.primaryBtnText}>Get started  →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar style="light" />

      <View style={s.stepRow}>
        <View style={[s.stepDot, s.stepDotDone]} />
        <View style={s.stepLine} />
        <View style={[s.stepDot, s.stepDotActive]} />
      </View>

      <View style={s.hero}>
        <Text style={s.stepIcon}>📁</Text>
        <Text style={s.stepTitle}>Select save folder</Text>
        <Text style={s.stepSub}>
          Navigate to the folder that contains{'\n'}
          <Text style={{ color: colors.primary }}>Player.sav</Text>, <Text style={{ color: colors.primary }}>Mii.sav</Text>, and the <Text style={{ color: colors.primary }}>Ugc/</Text> subfolder.
        </Text>
        <Text style={s.stepHint}>
          On Android this is usually inside the Ryujinx or your emulator's save directory.
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>What you're granting</Text>
        <BulletRow icon="✓" text="Read save files (Player.sav, Mii.sav, Map.sav)" colors={colors} />
        <BulletRow icon="✓" text="Read & write UGC textures (Ugc/*.zs)" colors={colors} />
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
    </View>
  );
}

const BulletRow = ({ icon, text, colors, negative }) => (
  <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'flex-start' }}>
    <Text style={{ color: negative ? colors.danger : colors.success, fontWeight: '700', marginTop: 1 }}>{icon}</Text>
    <Text style={{ color: negative ? colors.textSecondary : colors.textPrimary, fontSize: 13, flex: 1 }}>{text}</Text>
  </View>
);

const makeStyles = (c) => StyleSheet.create({
  root: {
    flex: 1, backgroundColor: c.bg,
    paddingHorizontal: 24, paddingTop: 60, paddingBottom: 32,
    justifyContent: 'center',
  },
  hero: { alignItems: 'center', marginBottom: 28 },
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
    justifyContent: 'center', marginBottom: 32, gap: 0,
  },
  stepDot:       { width: 12, height: 12, borderRadius: 6 },
  stepDotDone:   { backgroundColor: c.primaryDim },
  stepDotActive: { backgroundColor: c.primary, width: 16, height: 16, borderRadius: 8 },
  stepLine:      { width: 40, height: 2, backgroundColor: c.primaryDim, marginHorizontal: 6 },

  stepIcon:  { fontSize: 52, marginBottom: 12 },
  stepTitle: { fontSize: 22, fontWeight: '700', color: c.textPrimary, marginBottom: 10 },
  stepSub:   { fontSize: 14, color: c.textSecondary, textAlign: 'center', lineHeight: 22 },
  stepHint:  { fontSize: 12, color: c.textDisabled, textAlign: 'center', marginTop: 10, lineHeight: 18 },

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
