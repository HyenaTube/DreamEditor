import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';

import { AppProvider, useApp } from './src/context/AppContext';

// Screens
import OnboardingScreen from './src/screens/OnboardingScreen';
import HomeScreen       from './src/screens/HomeScreen';
import ViewerScreen     from './src/screens/ViewerScreen';
import EditorScreen     from './src/screens/EditorScreen';
import MiiScreen        from './src/screens/MiiScreen';
import MiiStatsScreen   from './src/screens/MiiStatsScreen';
import BackupScreen     from './src/screens/BackupScreen';
import SettingsScreen   from './src/screens/SettingsScreen';
import SaveEditorScreen from './src/screens/SaveEditorScreen';

// Import logic
import { detectImport, ALL_EXTENSIONS } from './src/utils/SmartImport';
import { importNewItem, findPlayerSavUri, savePlayerSav, parseLtdFile } from './src/utils/BinaryTextureProcessor';
import { importMiiBytes, writeMiiSavFiles, listMiis } from './src/utils/MiiProcessor';
import { createBackup } from './src/utils/BackupManager';
import * as FileSystem from 'expo-file-system/legacy';
import { StorageAccessFramework } from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

const Stack = createNativeStackNavigator();
const Tab   = createBottomTabNavigator();

// ─── UGC stack (Viewer + Editor) ────────────────────────────────────────────

function UGCStack() {
  const { saveFolderUri } = useApp();
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="Viewer" component={ViewerScreen}
        options={{ headerShown: false }}
        initialParams={{ folderPath: saveFolderUri }}
      />
      <Stack.Screen name="Editor" component={EditorScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}

// ─── Miis stack ──────────────────────────────────────────────────────────────

function MiisStack() {
  const { saveFolderUri } = useApp();
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="MiiList" component={MiiScreen}
        options={{ headerShown: false }}
        initialParams={{ saveFolderUri }}
      />
      <Stack.Screen name="MiiStats" component={MiiStatsScreen}
        options={{ title: 'Mii Stats', ...stackOpts }}
      />
    </Stack.Navigator>
  );
}

// ─── Settings stack ──────────────────────────────────────────────────────────

function SettingsStack() {
  const { saveFolderUri } = useApp();
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="SettingsMain" component={SettingsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="Backups" component={BackupScreen}
        options={{ title: 'Backups', ...stackOpts }}
        initialParams={{ saveFolderUri }}
      />
      <Stack.Screen name="SaveEditor" component={SaveEditorScreen}
        options={{ title: 'Save Editor', ...stackOpts }}
      />
      <Stack.Screen name="MiiStats" component={MiiStatsScreen}
        options={{ title: 'Mii Stats', ...stackOpts }}
      />
    </Stack.Navigator>
  );
}

// ─── Custom tab bar with centre FAB ─────────────────────────────────────────

function CustomTabBar({ state, descriptors, navigation, onFab }) {
  const { colors } = useApp();
  const b = barStyles(colors);

  return (
    <View style={b.bar}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const focused = state.index === index;

        if (route.name === '__fab__') {
          return (
            <TouchableOpacity key="fab" style={b.fabWrap} onPress={onFab} activeOpacity={0.85}>
              <View style={[b.fab, { backgroundColor: colors.primary }]}>
                <Text style={[b.fabText, { color: colors.onPrimary }]}>＋</Text>
              </View>
            </TouchableOpacity>
          );
        }

        const label = options.tabBarLabel ?? route.name;
        const icon  = options.tabBarIcon?.({ focused, color: focused ? colors.primary : colors.textDisabled, size: 24 });

        return (
          <TouchableOpacity
            key={route.key}
            style={b.tab}
            onPress={() => navigation.navigate(route.name)}
            activeOpacity={0.7}
          >
            {icon}
            <Text style={[b.tabLabel, { color: focused ? colors.primary : colors.textDisabled }]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const barStyles = (c) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.surface,
    borderTopWidth: 1, borderTopColor: c.outline,
    paddingBottom: 8, paddingTop: 6, height: 64,
  },
  tab:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { fontSize: 10, fontWeight: '600' },
  fabWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -22 },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    elevation: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6,
  },
  fabText: { fontSize: 28, lineHeight: 32, fontWeight: '300' },
});

// ─── Tab icon helper ─────────────────────────────────────────────────────────

const TabIcon = ({ label, focused, color }) => (
  <Text style={{ fontSize: 20, color }}>{label}</Text>
);

// ─── Import progress overlay ─────────────────────────────────────────────────

function ImportOverlay({ visible, text, colors }) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible>
      <View style={ov.backdrop}>
        <View style={[ov.box, { backgroundColor: colors.elevated, borderColor: colors.outlineVar }]}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[ov.text, { color: colors.textPrimary }]}>{text || 'Working…'}</Text>
        </View>
      </View>
    </Modal>
  );
}
const ov = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center' },
  box:      { borderRadius: 20, padding: 28, alignItems: 'center', gap: 14, minWidth: 220, borderWidth: 1 },
  text:     { fontSize: 14, textAlign: 'center' },
});

// ─── Mii slot picker modal ───────────────────────────────────────────────────

function MiiSlotPicker({ visible, miis, colors, onPick, onCancel }) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="slide" visible>
      <TouchableOpacity style={ov.backdrop} activeOpacity={1} onPress={onCancel}>
        <View style={[ov.box, { backgroundColor: colors.elevated, borderColor: colors.outlineVar, width: '90%', maxHeight: '70%', padding: 0, overflow: 'hidden' }]}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 16, padding: 18, textAlign: 'center' }}>
            Import into which Mii slot?
          </Text>
          <ScrollView style={{ flexGrow: 0 }} bounces={false}>
            {(miis || []).filter(m => m.initialized).map(m => (
              <TouchableOpacity
                key={m.slot}
                onPress={() => onPick(m.slot)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.outline }}
              >
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primaryContainer, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>{m.slot}</Text>
                </View>
                <Text style={{ color: colors.textPrimary, fontSize: 15 }}>{m.name || '(unnamed)'}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={onCancel} style={{ padding: 16, alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.outline }}>
            <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Main tab navigator ──────────────────────────────────────────────────────

function MainTabs() {
  const { colors, saveFolderUri, bumpMiiList } = useApp();
  const [importBusy, setImportBusy]     = useState(false);
  const [importText, setImportText]     = useState('');
  const [miiPickerData, setMiiPickerData] = useState(null); // { miis, bytes, filename }

  const handleFab = useCallback(async () => {
    let asset;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.length) return;
      asset = r.assets[0];
    } catch (e) { Alert.alert('Error', e.message); return; }

    setImportBusy(true);
    setImportText('Reading file…');
    try {
      const detected = await detectImport(asset);

      if (detected.kind === 'unknown') {
        Alert.alert('Unknown file', detected.error || 'Could not detect file type.');
        return;
      }

      if (detected.kind === 'ugc') {
        const { parsed } = detected;
        const LTD_TYPES = ['Food','Clothing','Goods','Interior','Exterior','Objects','Landscaping'];
        const typeName = LTD_TYPES[parsed.rawData[0]] ?? 'Unknown';

        // Resolve the Ugc subfolder URI
        const getFilename = (uri) => decodeURIComponent(uri).split('/').pop() || '';
        const topFiles = await StorageAccessFramework.readDirectoryAsync(saveFolderUri);
        const ugcEntry = topFiles.find(u => getFilename(u).toLowerCase() === 'ugc');
        if (!ugcEntry) throw new Error('Ugc folder not found in save folder.');
        const m = saveFolderUri.match(/^(content:\/\/[^/]+\/tree\/)(.+)$/);
        const resolvedUgcUri = m
          ? m[1] + encodeURIComponent(decodeURIComponent(m[2]) + '/Ugc')
          : null;
        if (!resolvedUgcUri) throw new Error('Could not resolve Ugc folder URI.');

        const playerSavUri = await findPlayerSavUri(saveFolderUri);

        await new Promise((resolve, reject) =>
          Alert.alert(
            `Import ${typeName}`,
            `"${parsed.itemName || asset.name}" will be added to the next free ${typeName} slot.` +
            (playerSavUri ? '\n\nPlayer.sav found — name & stats will be updated.' : '\n\nNo Player.sav — textures only.'),
            [
              { text: 'Cancel', style: 'cancel', onPress: () => reject(new Error('cancelled')) },
              { text: 'Import', onPress: resolve },
            ]
          )
        );

        setImportText('Creating backup…');
        try { await createBackup(saveFolderUri, `imported ${asset.name}`, setImportText); } catch {}

        let playerSavBytes = null;
        if (playerSavUri) {
          setImportText('Reading Player.sav…');
          const b64 = await FileSystem.readAsStringAsync(playerSavUri, { encoding: FileSystem.EncodingType.Base64 });
          playerSavBytes = new Uint8Array(Buffer.from(b64, 'base64'));
        }

        const result = await importNewItem(parsed, resolvedUgcUri, saveFolderUri, playerSavBytes, setImportText);

        if (result.modifiedSav && playerSavUri) {
          setImportText('Writing Player.sav…');
          await savePlayerSav(playerSavUri, saveFolderUri, result.modifiedSav);
        }

        Alert.alert('Done', `Added as slot ${result.slot} (${result.stem}).`);
        return;
      }

      if (detected.kind === 'mii') {
        // Need to pick a slot — load Mii list first
        setImportText('Loading Mii list…');
        const miis = await listMiis(saveFolderUri);
        setImportBusy(false);
        setMiiPickerData({ miis, bytes: detected.bytes, filename: detected.filename });
        return;
      }

    } catch (e) {
      if (e.message !== 'cancelled') Alert.alert('Import failed', e.message);
    } finally {
      setImportBusy(false);
      setImportText('');
    }
  }, [saveFolderUri]);

  const handleMiiSlotPick = useCallback(async (slot) => {
    if (!miiPickerData) return;
    const { bytes, filename } = miiPickerData;
    setMiiPickerData(null);
    setImportBusy(true);
    setImportText('Creating backup…');
    try {
      try { await createBackup(saveFolderUri, `imported ${filename}`, setImportText); } catch {}
      setImportText('Importing Mii…');
      const { miisav, playersav, miiSavUri, playerSavUri } = await importMiiBytes(slot, bytes, saveFolderUri, setImportText);
      setImportText('Writing save files…');
      await writeMiiSavFiles(saveFolderUri, miiSavUri, playerSavUri, miisav, playersav);
      bumpMiiList();
      Alert.alert('Done', `Mii imported into slot ${slot}.`);
    } catch (e) {
      Alert.alert('Import failed', e.message);
    } finally {
      setImportBusy(false);
      setImportText('');
    }
  }, [miiPickerData, saveFolderUri, bumpMiiList]);

  return (
    <>
      <Tab.Navigator
        tabBar={(props) => <CustomTabBar {...props} onFab={handleFab} />}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen
          name="HomeTab"
          component={HomeScreen}
          options={{
            tabBarLabel: 'Home',
            tabBarIcon: ({ color }) => <TabIcon label="🏠" color={color} />,
          }}
        />
        <Tab.Screen
          name="UGCTab"
          component={UGCStack}
          options={{
            tabBarLabel: 'UGC',
            tabBarIcon: ({ color }) => <TabIcon label="👗" color={color} />,
          }}
        />
        <Tab.Screen
          name="__fab__"
          component={HomeScreen}
          options={{ tabBarLabel: '', tabBarIcon: () => null }}
        />
        <Tab.Screen
          name="MiisTab"
          component={MiisStack}
          options={{
            tabBarLabel: 'Miis',
            tabBarIcon: ({ color }) => <TabIcon label="🧑" color={color} />,
          }}
        />
        <Tab.Screen
          name="SettingsTab"
          component={SettingsStack}
          options={{
            tabBarLabel: 'Settings',
            tabBarIcon: ({ color }) => <TabIcon label="⚙️" color={color} />,
          }}
        />
      </Tab.Navigator>

      <ImportOverlay visible={importBusy} text={importText} colors={colors} />
      <MiiSlotPicker
        visible={!!miiPickerData}
        miis={miiPickerData?.miis}
        colors={colors}
        onPick={handleMiiSlotPick}
        onCancel={() => setMiiPickerData(null)}
      />
    </>
  );
}

// ─── Root navigator — onboarding gate ───────────────────────────────────────

function RootNavigator() {
  const { folderReady, loaded, colors } = useApp();

  if (!loaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!folderReady) {
    return (
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <MainTabs />
    </NavigationContainer>
  );
}

// ─── App entry ───────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AppProvider>
      <RootNavigator />
    </AppProvider>
  );
}

const stackOpts = {
  headerStyle:      { backgroundColor: '#17171F' },
  headerTintColor:  '#F5C518',
  headerTitleStyle: { fontWeight: '700' },
  contentStyle:     { backgroundColor: '#0D0D12' },
};
