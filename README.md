# DreamEditor

An Android save editor for **Tomodachi Life: Living the Dream** (Nintendo Switch).

Edit Mii stats, import/export Miis, swap item textures, tweak your wallet — all from your phone, no PC needed.

> **Disclaimer:** Always back up your save data before using this app. DreamEditor creates automatic backups before every write operation, but save file corruption is still possible if you enter bad values, the app is interrupted mid-write, or something unexpected happens. Use at your own risk. The developer is not responsible for lost or corrupted save data.
>
> This project is not affiliated with Nintendo. Tomodachi Life: Living the Dream is a trademark of Nintendo Co., Ltd.

---

## Features

### Basically most if not all features of the ShareMii and LivingTheDreamToolkit.

### Mii Manager
- Import `.ltd` Mii files into any of the 70 Mii slots
- Export individual Miis as `.ltd` files to any folder
- Export all Miis at once with one tap
- View and edit per-Mii stats directly from the Mii list
  
- ### UGC Browser
- Browse all UGC item slots (Food, Clothing, Goods, Interior, Exterior, Objects, Landscaping)
- Import custom `.ltd` item files into the next free slot
- Edit existing items by importing an image. (also possible to export)
- Updates `Player.sav` item name and metadata on import (when available)


### Mii Stats Editor
Edit the following fields for any initialized Mii:
- **Level**
- **Personality** — Easygoing, Outgoing, Confident, Airhead, Laid-back
- **Voice** — 6 voice trait fields
- **Aptitude** — 3 aptitude fields
- **Body** — 4 body trait fields
- **Gameplay** — Hunger, Bond, Stress, Mood, Mii pocket money

All values are raw `uint32` reads from `Mii.sav`. A backup is created automatically before any write.

### Save Editor
- View all active Miis and edit their levels in one place
- Jump to the full stats editor for any individual Mii

### Backups
- Automatic backup created before every import or save operation
- Up to 10 backup slots — oldest is removed when a new one is created
- Restore any backup with one tap
- Manual restore from the Backups screen in Settings
- *HOWEVER, ITS ALWAYS BETTER TO MAKE A MANUAL BACKUP!!* (better safe than sorry)

### Theming
- 10 preset accent colors or enter any custom hue (0–359)
- OLED black mode for true-black backgrounds
- Theme persists across sessions

---

## Requirements

- Android 10 or higher
- Tomodachi Life: Living the Dream save data accessible on your device
  - e.g. exported from an emulator (Yuzu, Ryujinx, Sudachi), or a rooted Switch with JKSV
- The save folder must contain `Mii.sav`, `Player.sav`, and optionally a `Ugc/` subfolder

---

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/DreamEditor.git
cd DreamEditor
npm install
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go) on your Android device.

### Build an APK

```bash
npm install -g eas-cli
eas build --profile preview --platform android
```

---

## How it works

The game embeds MurmurHash3 (x86-32) hashes of field name strings as 4-byte identifiers before each data array in the save files. DreamEditor scans for these hashes, computes the array base offset, and reads/writes values at `base + (slot - 1) * 4` for per-slot fields.

Hash values were sourced from [alexislours/ltd-save-editor](https://github.com/alexislours/ltd-save-editor), LivingTheDreamToolkit, and ShareMii.

---

## Safety

- Every write operation automatically creates a timestamped backup in your app's private storage before touching any save file.
- Backups cap at 10 — the oldest is pruned when a new one is created.
- **Even so: keep your own external backups.** Copy your save folder to a safe location before experimenting with values you're not sure about. Personality and gameplay fields are raw unsigned 32-bit integers — the game may reject or behave unpredictably with out-of-range values.

---

## Contributing

Pull requests welcome. If you find a hash value for a field not yet supported, open an issue or PR and include how you verified it.
If you want anything added i'll take a look at it too.

---

## Credits

- Save format research: [alexislours/ltd-save-editor](https://github.com/alexislours/ltd-save-editor), LivingTheDreamToolkit, ShareMii
- Built with [React Native](https://reactnative.dev) + [Expo](https://expo.dev)

---

## License

MIT — do whatever you want, just don't hold me liable for bricked saves.
