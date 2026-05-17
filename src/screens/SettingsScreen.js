import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Alert, TextInput
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { useApp } from '../context/AppContext';
import { PRESET_HUES, generateColors } from '../theme';

export default function SettingsScreen({ navigation }) {
  const { colors, typo, sp, themeHue, oledMode, setTheme, setSaveFolder, saveFolderUri } = useApp();
  const [customHue, setCustomHue] = useState(String(themeHue));
  const s = makeStyles(colors, sp);

  const applyHue = (hue) => {
    const h = Math.max(0, Math.min(359, Math.round(hue)));
    setCustomHue(String(h));
    setTheme(h, oledMode);
  };

  const applyCustomHue = () => {
    const h = parseInt(customHue, 10);
    if (!isNaN(h)) applyHue(h);
  };

  const changeFolder = async () => {
    try {
      const result = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (result.granted) await setSaveFolder(result.directoryUri);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const displayPath = saveFolderUri
    ? decodeURIComponent(saveFolderUri).split('/').slice(-3).join(' / ')
    : 'Not set';

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <StatusBar style="light" />

      {/* ── Save folder ─────────────────────────────────────────────────── */}
      <Text style={s.section}>SAVE FOLDER</Text>
      <View style={s.card}>
        <Text style={s.cardLabel}>Current folder</Text>
        <Text style={s.pathText} numberOfLines={3}>{displayPath}</Text>
        <TouchableOpacity style={s.outlineBtn} onPress={changeFolder}>
          <Text style={s.outlineBtnText}>Change folder</Text>
        </TouchableOpacity>
      </View>

      {/* ── Accent colour ────────────────────────────────────────────────── */}
      <Text style={s.section}>ACCENT COLOUR</Text>
      <View style={s.card}>
        <Text style={s.cardLabel}>Preset colours</Text>
        <View style={s.swatchRow}>
          {PRESET_HUES.map(({ hue, label }) => {
            const c = generateColors(hue, oledMode);
            const active = Math.abs(themeHue - hue) < 15;
            return (
              <TouchableOpacity
                key={hue}
                style={[s.swatch, { backgroundColor: c.primary }, active && s.swatchActive]}
                onPress={() => applyHue(hue)}
                activeOpacity={0.8}
              >
                {active && <Text style={s.swatchTick}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[s.cardLabel, { marginTop: sp.md }]}>Custom hue (0 – 359)</Text>
        <View style={s.hueRow}>
          <TextInput
            style={s.hueInput}
            value={customHue}
            onChangeText={setCustomHue}
            onBlur={applyCustomHue}
            onSubmitEditing={applyCustomHue}
            keyboardType="number-pad"
            maxLength={3}
            placeholderTextColor={colors.textDisabled}
          />
          <View style={[s.huePreview, { backgroundColor: generateColors(parseInt(customHue) || themeHue, oledMode).primary }]} />
          <TouchableOpacity style={s.applyBtn} onPress={applyCustomHue}>
            <Text style={s.applyBtnText}>Apply</Text>
          </TouchableOpacity>
        </View>

        <View style={s.hueStrip}>
          {Array.from({ length: 36 }, (_, i) => i * 10).map(h => (
            <TouchableOpacity
              key={h}
              style={[s.hueCell, { backgroundColor: generateColors(h, false).primary }]}
              onPress={() => applyHue(h)}
            />
          ))}
        </View>
      </View>

      {/* ── Display ──────────────────────────────────────────────────────── */}
      <Text style={s.section}>DISPLAY</Text>
      <View style={s.card}>
        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.toggleLabel}>OLED black mode</Text>
            <Text style={s.toggleSub}>True black backgrounds — saves battery on OLED screens</Text>
          </View>
          <Switch
            value={oledMode}
            onValueChange={(v) => setTheme(themeHue, v)}
            trackColor={{ false: colors.outline, true: colors.primaryDim }}
            thumbColor={oledMode ? colors.primary : colors.chip}
          />
        </View>
      </View>

      {/* ── Tools ───────────────────────────────────────────────────────── */}
      <Text style={s.section}>TOOLS</Text>
      <View style={s.card}>
        <TouchableOpacity style={s.navRow} onPress={() => navigation.navigate('SaveEditor')}>
          <Text style={s.navRowIcon}>💾</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.navRowTitle}>Save Editor</Text>
            <Text style={s.navRowSub}>Edit Mii levels and personality stats</Text>
          </View>
          <Text style={s.navRowChevron}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.navRow, s.navRowBorder]} onPress={() => navigation.navigate('Backups')}>
          <Text style={s.navRowIcon}>🗂️</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.navRowTitle}>Backups</Text>
            <Text style={s.navRowSub}>Restore previous save states</Text>
          </View>
          <Text style={s.navRowChevron}>›</Text>
        </TouchableOpacity>
      </View>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <Text style={s.section}>ABOUT</Text>
      <View style={s.card}>
        <Text style={s.aboutTitle}>DreamEditor</Text>
        <Text style={s.aboutSub}>Tomodachi Life · Living the Dream save editor</Text>
        <Text style={s.aboutSub}>Title ID: 010051F0207B2000</Text>
        <View style={s.divider} />
        <Text style={s.aboutSub}>Save format research: ltd-save-editor, LivingTheDreamToolkit, ShareMii</Text>
      </View>
    </ScrollView>
  );
}

const makeStyles = (c, sp) => StyleSheet.create({
  root:    { flex: 1, backgroundColor: c.bg },
  content: { padding: sp.lg, paddingBottom: 60 },

  section: {
    fontSize: 10, fontWeight: '600', letterSpacing: 1.2,
    color: c.textDisabled, marginBottom: sp.sm, marginTop: sp.md,
  },
  card: {
    backgroundColor: c.surface, borderRadius: 16,
    borderWidth: 1, borderColor: c.outline,
    padding: sp.md,
  },
  cardLabel:  { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: sp.sm },
  pathText:   { fontSize: 12, color: c.textSecondary, lineHeight: 18, marginBottom: sp.md },
  outlineBtn: {
    borderRadius: 100, borderWidth: 1, borderColor: c.outlineVar,
    paddingVertical: 10, alignItems: 'center',
  },
  outlineBtnText: { fontSize: 14, fontWeight: '600', color: c.primary },

  swatchRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch:      { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  swatchActive: { borderWidth: 3, borderColor: '#fff' },
  swatchTick:  { color: '#000', fontWeight: '900', fontSize: 16 },

  hueRow: { flexDirection: 'row', alignItems: 'center', gap: sp.sm, marginBottom: sp.md },
  hueInput: {
    backgroundColor: c.surfaceVar, borderRadius: 8,
    borderWidth: 1, borderColor: c.outline,
    color: c.textPrimary, fontSize: 16, fontWeight: '600',
    paddingHorizontal: 12, paddingVertical: 8,
    width: 64, textAlign: 'center',
  },
  huePreview: { width: 36, height: 36, borderRadius: 18 },
  applyBtn:   {
    backgroundColor: c.primaryContainer, borderRadius: 8,
    borderWidth: 1, borderColor: c.primaryDim,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  applyBtnText: { fontSize: 13, fontWeight: '600', color: c.primary },

  hueStrip: { flexDirection: 'row', height: 20, borderRadius: 10, overflow: 'hidden', marginTop: 4 },
  hueCell:  { flex: 1 },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', gap: sp.md },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: c.textPrimary },
  toggleSub:   { fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 18 },

  aboutTitle: { fontSize: 16, fontWeight: '700', color: c.textPrimary },
  aboutSub:   { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  divider:    { height: 1, backgroundColor: c.outline, marginVertical: sp.md },

  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp.md,
    paddingHorizontal: sp.md, paddingVertical: sp.md,
  },
  navRowBorder: { borderTopWidth: 1, borderTopColor: c.outline },
  navRowIcon:    { fontSize: 20 },
  navRowTitle:   { fontSize: 14, fontWeight: '600', color: c.textPrimary },
  navRowSub:     { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  navRowChevron: { fontSize: 22, color: c.textDisabled },
});
