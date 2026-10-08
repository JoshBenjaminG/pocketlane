# Pocketlane

Pocketlane is a private, local-first Game Boy Advance player that runs in a modern browser. Import your own `.gba` files, keep a personal library in IndexedDB, and continue with cartridge saves or save states.

**Pocketlane does not include, host, download, or link to ROMs, BIOS files, Nintendo assets, game artwork, or cryptographic material.** Users are responsible for supplying game files they are authorized to use.

## Features

- Persistent, device-local ROM library
- Automatic battery-backed cartridge saves
- Manual save states with thumbnails
- `.sav` import and export
- Keyboard and Gamepad API controls
- Selectable controllers and editable mapping profiles
- Fullscreen, pixel-perfect, smooth, LCD, and vivid display modes
- Installable, offline-capable PWA
- No account, analytics, ROM upload, or server-side game storage

## Privacy model

ROMs, save data, states, and controller profiles remain inside the current browser profile. They are not uploaded to Pocketlane's host. Clearing browser site data removes locally stored games and unexported progress.

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Controls

| GBA input | Keyboard |
| --- | --- |
| D-pad | Arrow keys |
| A | Z |
| B | X |
| Start | Enter |
| Select | Backspace |
| R / L | A / S |

Gamepad controls can be remapped in the player. Profiles are stored locally.

## Legal and content policy

Pocketlane is an independent open-source project and is not affiliated with, sponsored by, or endorsed by Nintendo. Game Boy Advance and Nintendo are trademarks of Nintendo Co., Ltd.

The repository is for emulator and user-interface code only. Do not open issues or pull requests that attach ROMs, BIOS dumps, copyrighted game artwork, decryption keys, or links to unauthorized copies. Contributions containing that material will be rejected.

The emulator runtime is provided by [`@gba-kit/gba-browser`](https://github.com/macabeus/gba-kit) under the MIT License. See dependency notices for their respective terms.

## License

Pocketlane's original source code is licensed under the [MIT License](LICENSE). This license does not grant rights to third-party games, trademarks, firmware, or other copyrighted material.
