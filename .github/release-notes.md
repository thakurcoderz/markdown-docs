## Install

### macOS

1. Download the **`.dmg`** below. It's a universal build for Apple Silicon and Intel Macs on macOS 14 or later.
2. Open it and drag **Markdown Docs** into **Applications**.
3. If macOS blocks the first launch (unsigned build), right-click the app → **Open** → **Open**, or run:
   ```sh
   xattr -dr com.apple.quarantine "/Applications/Markdown Docs.app"
   ```

The `.app.zip` holds the same app without the disk image.

### Linux

- **Ubuntu / Debian:** download the **`.deb`** and run `sudo apt install ./Markdown-Docs_*_amd64.deb`.
- **Other distros:** download the **`.AppImage`**, run `chmod +x Markdown-Docs_*.AppImage`, then launch it.

Checksums for every file are in `SHA256SUMS.txt`.
