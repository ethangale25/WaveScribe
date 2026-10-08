# 🎙️ Voice Dictation Tool (GUI Edition)

A sleek, Apple-inspired voice dictation application with a modern graphical interface.

![Theme: Dark Mode]

## Features

- **Modern UI** - Clean, Apple-inspired design with dark/light themes
- **Global Hotkey** - Works in any application
- **Customizable Settings** - Change hotkey, model, language, and more
- **Dictation History** - See and copy your recent dictations
- **Statistics** - Track your usage and time saved
- **Filler Word Removal** - Automatically removes "um", "uh", "like", etc.

## Installation (Windows)

### Step 1: Open Command Prompt in Your Project Folder

1. Create a folder for the project (e.g., `C:\Users\YourName\voice-dictation`)
2. Save `dictation_gui.py` and `requirements.txt` in that folder
3. Open File Explorer, navigate to the folder
4. Click the address bar, type `cmd`, press Enter

### Step 2: Create Virtual Environment

```
python -m venv venv
```

### Step 3: Activate Virtual Environment

```
venv\Scripts\activate
```

You should see `(venv)` at the start of your command line.

### Step 4: Install Dependencies

```
pip install openai-whisper sounddevice numpy pynput pyperclip pyautogui sv-ttk
```

### Step 5: Run the Application

```
python dictation_gui.py
```

## Usage

1. **Launch the app** - A window will appear
2. **Wait for "Ready"** - The status indicator turns green when the model is loaded
3. **Press Ctrl+Shift+Space** - Start recording (indicator turns red)
4. **Speak naturally** - Say whatever you want to type
5. **Press Ctrl+Shift+Space again** - Stop recording and process
6. **Text appears** - In whatever app had focus before you started

## Interface Guide

```
┌────────────────────────────────────────┐
│  Voice Dictation                       │
│  Speak naturally, type effortlessly    │
├────────────────────────────────────────┤
│  Status                                │
│  ● Ready          [ctrl+shift + space] │
├────────────────────────────────────────┤
│  Statistics                            │
│     42          1,234        15m       │
│  Dictations     Words     Time Saved   │
├────────────────────────────────────────┤
│  Recent Dictations                     │
│  [14:32] Hello this is a test...       │
│  [14:28] Another dictation example...  │
│  [14:15] Meeting notes from today...   │
│                                        │
│  Double-click to copy                  │
├────────────────────────────────────────┤
│  [⚙ Settings]          [◐ Toggle Theme]│
└────────────────────────────────────────┘
```

## Settings

Click **⚙ Settings** to customize:

- **Hotkey** - Change the modifier (ctrl+shift, ctrl+alt, etc.) and key (space, d, f1, etc.)
- **Model** - Choose accuracy vs speed (tiny → large)
- **Language** - Set your language or use auto-detect
- **Text Processing** - Toggle filler word removal, auto-capitalization, sounds

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Shift+Space | Start/Stop recording (default) |
| Double-click history item | Copy to clipboard |

## Themes

Click **◐ Toggle Theme** to switch between:
- **Dark Mode** - Easy on the eyes, great for night use
- **Light Mode** - Classic bright interface

## Troubleshooting

**"No module named 'whisper'"**
```
venv\Scripts\activate
pip install openai-whisper
```

**"No module named 'sv_ttk'"**
```
pip install sv-ttk
```
(The app will still work without it, just with a basic theme)

**Hotkey not working**
- Make sure no other app is using that hotkey
- Try changing the hotkey in Settings

**Slow transcription**
- Use a smaller model (Settings → Model → tiny or base)

## Running Again Later

1. Open command prompt in your project folder
2. Activate the virtual environment:
   ```
   venv\Scripts\activate
   ```
3. Run the app:
   ```
   python dictation_gui.py
   ```

## Create a Desktop Shortcut (Optional)

1. Right-click on Desktop → New → Shortcut
2. Enter this as the location:
   ```
   C:\Users\YourName\voice-dictation\venv\Scripts\pythonw.exe C:\Users\YourName\voice-dictation\dictation_gui.py
   ```
3. Name it "Voice Dictation"
4. Click Finish

Now you can double-click to launch!

---

Enjoy hands-free typing! 🎤✨
