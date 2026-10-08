# 🎙️ Voice Dictation - Build & Distribution Guide

This guide explains how to package Voice Dictation into a professional, distributable application.

## Overview

You have three distribution options:

| Method | User Experience | Effort |
|--------|-----------------|--------|
| **ZIP file** | Download, extract, run .exe | Easy |
| **Installer (.exe)** | Download, run setup wizard | Medium |
| **Microsoft Store** | Install from Store | Hard |

This guide covers the first two options.

---

## Prerequisites

### 1. Install Python 3.10 or 3.11

⚠️ **Important:** Use Python 3.10 or 3.11, NOT 3.14. Some dependencies don't support the newest Python yet.

Download from: https://www.python.org/downloads/release/python-3119/

### 2. Install Build Tools

```bash
pip install pyinstaller
```

### 3. (Optional) Install Inno Setup

For creating a professional installer wizard:
https://jrsoftware.org/isinfo.php

---

## Project Structure

```
voice-dictation-package/
├── src/
│   └── voice_dictation/
│       └── app.py              # Main application
├── assets/
│   ├── icon.ico                # App icon (256x256)
│   ├── installer_banner.bmp    # Installer sidebar (164x314)
│   └── installer_icon.bmp      # Installer header (55x58)
├── build.spec                  # PyInstaller configuration
├── build.bat                   # Build script
├── installer.iss               # Inno Setup script
├── version_info.txt            # Windows version info
├── LICENSE.txt                 # Your license
└── README.txt                  # User readme (shown in installer)
```

---

## Building the Application

### Option A: Quick Build (ZIP Distribution)

1. Open Command Prompt in this folder
2. Run:
   ```
   build.bat
   ```
3. Find your app in `dist\VoiceDictation\`
4. ZIP that folder and distribute!

### Option B: Professional Installer

1. Install Inno Setup first
2. Run:
   ```
   build.bat installer
   ```
3. Find `VoiceDictation_Setup_1.0.0.exe` in `installer_output\`

---

## Creating Your App Icon

You need an `.ico` file for Windows. Here's how to create one:

### Method 1: Online Converter
1. Create a 256x256 PNG image
2. Go to https://convertio.co/png-ico/
3. Upload and convert
4. Save as `assets/icon.ico`

### Method 2: Using Python
```python
from PIL import Image

# Open your PNG
img = Image.open('icon.png')

# Save as ICO with multiple sizes
img.save('icon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48), (256,256)])
```

---

## Customizing the Installer

Edit `installer.iss` to customize:

```ini
#define MyAppName "Voice Dictation"      ; App name
#define MyAppVersion "1.0.0"             ; Version number
#define MyAppPublisher "Your Name"       ; Your name/company
#define MyAppURL "https://yoursite.com"  ; Your website
```

Generate a unique GUID for `AppId`:
- Go to https://www.guidgenerator.com/
- Generate a GUID
- Replace `{YOUR-UNIQUE-GUID-HERE}` in the script

---

## Distribution Checklist

Before distributing, make sure you have:

- [ ] Custom app icon (`assets/icon.ico`)
- [ ] LICENSE.txt with your license
- [ ] README.txt with basic user instructions
- [ ] Updated version number in all files
- [ ] Tested the built .exe on a clean Windows machine

---

## File Sizes (Approximate)

| Component | Size |
|-----------|------|
| Base application | ~50 MB |
| Whisper base model | ~150 MB |
| Total (first run) | ~200 MB |

The Whisper model downloads automatically on first run.

---

## Signing Your Application (Optional but Recommended)

Unsigned apps show Windows SmartScreen warnings. To avoid this:

### Option 1: Code Signing Certificate (~$100-400/year)
- Purchase from DigiCert, Sectigo, etc.
- Sign with: `signtool sign /a /t http://timestamp.digicert.com dist\VoiceDictation\VoiceDictation.exe`

### Option 2: Build Reputation
- Submit to Microsoft for analysis
- Get enough users to download (SmartScreen learns)
- This takes time but is free

---

## Troubleshooting Build Issues

### "No module named 'whisper'"
```bash
pip install openai-whisper
```

### PyInstaller fails with hidden imports
Edit `build.spec` and add missing modules to `hiddenimports`.

### App works in dev but not after building
Run with console enabled to see errors:
1. Edit `build.spec`
2. Change `console=False` to `console=True`
3. Rebuild and run from command line

### Antivirus flags the .exe
This is common with PyInstaller apps. Options:
- Submit false positive report to antivirus vendor
- Sign your application with a code signing certificate

---

## Updating Your App

When releasing a new version:

1. Update version in `src/voice_dictation/app.py`:
   ```python
   APP_VERSION = "1.1.0"
   ```

2. Update `version_info.txt`:
   ```
   filevers=(1, 1, 0, 0)
   ```

3. Update `installer.iss`:
   ```
   #define MyAppVersion "1.1.0"
   ```

4. Rebuild: `build.bat installer`

---

## Hosting Your Download

### Free Options
- **GitHub Releases** - Best for open source
- **Google Drive / Dropbox** - Simple file sharing
- **itch.io** - Good for indie software

### Paid Options
- **Your own website** - Full control
- **Gumroad** - If you want to sell it
- **Microsoft Store** - Maximum reach

---

## Quick Start for Users

Include these instructions with your download:

```
VOICE DICTATION - QUICK START
=============================

1. Run VoiceDictation.exe (or the installer)
2. Wait for "Ready" status (first run downloads AI model)
3. Press Ctrl+Shift+Space to start recording
4. Speak naturally
5. Press Ctrl+Shift+Space to stop
6. Text appears wherever your cursor is!

Works in any app: Word, Chrome, Slack, etc.
```

---

## Support

If you have issues building:
1. Make sure you're using Python 3.10 or 3.11
2. Try deleting `build_env` folder and rebuilding
3. Check PyInstaller GitHub issues for known problems

Good luck with your release! 🚀
