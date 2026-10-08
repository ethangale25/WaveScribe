# 🎙️ Local Voice Dictation Tool

A Wispr Flow-like voice-to-text tool that runs **entirely locally** on your computer. No cloud, no subscription, no data leaving your machine.

## Features

- **Global hotkey** (Ctrl+Shift+Space) to trigger dictation from any application
- **Local speech-to-text** using OpenAI's Whisper model
- **Automatic text cleanup**: removes filler words (um, uh, like, etc.)
- **Smart punctuation** and capitalization
- **Personal dictionary** for custom words and names
- **Snippets** for text expansion (say "my email" → insert your full email)
- **Works in any app**: Gmail, Slack, VS Code, Word, anywhere you can type
- **Cross-platform**: Mac, Windows, Linux

## Quick Start

### 1. Install Dependencies

```bash
# Create a virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

**Platform-specific requirements:**

**macOS:**
```bash
brew install portaudio
```

**Ubuntu/Debian:**
```bash
sudo apt install portaudio19-dev python3-dev xdotool xclip
```

**Windows:**
- No additional requirements, but you may need to install Visual C++ Build Tools

### 2. Run the Tool

**Standard version (using openai-whisper):**
```bash
python dictation.py
```

**Fast version (using faster-whisper, recommended):**
```bash
pip install faster-whisper
python dictation_fast.py
```

### 3. Use It!

1. Press **Ctrl+Shift+Space** to start recording
2. Speak naturally
3. Press **Ctrl+Shift+Space** again to stop
4. Text appears in your focused application!

## Model Selection

Choose your model based on your hardware:

| Model | Size | Speed | Accuracy | RAM |
|-------|------|-------|----------|-----|
| `tiny` | 39M | ⚡⚡⚡⚡ | ⭐⭐ | ~1GB |
| `base` | 74M | ⚡⚡⚡ | ⭐⭐⭐ | ~1GB |
| `small` | 244M | ⚡⚡ | ⭐⭐⭐⭐ | ~2GB |
| `medium` | 769M | ⚡ | ⭐⭐⭐⭐⭐ | ~5GB |
| `large` | 1550M | 🐌 | ⭐⭐⭐⭐⭐ | ~10GB |

**Recommendation:** Start with `base` for a good balance of speed and accuracy.

```bash
# Use a different model
python dictation.py --model small

# Use auto language detection
python dictation.py --language auto
```

## Configuration

### Personal Dictionary

Add custom words/names that Whisper might mishear. Create `~/.voice-dictation/dictionary.json`:

```json
{
  "john doe": "John Doe",
  "acme": "ACME",
  "kubernetes": "Kubernetes",
  "api": "API"
}
```

### Snippets

Create voice shortcuts for frequently used text. Create `~/.voice-dictation/snippets.json`:

```json
{
  "my email": "yourname@example.com",
  "my phone": "+1 (555) 123-4567",
  "my address": "123 Main St, City, State 12345",
  "calendar link": "https://calendly.com/yourname",
  "thanks reply": "Thank you for reaching out! I'll get back to you within 24 hours."
}
```

Now when you say "my email", it will insert your full email address!

## Command Line Options

```bash
python dictation.py --help

Options:
  -m, --model {tiny,base,small,medium,large}
                        Whisper model to use (default: base)
  -l, --language LANG   Language code (e.g., 'en', 'es') or 'auto'
  --no-filler-removal   Disable filler word removal
  --no-sounds           Disable audio feedback sounds
```

## Customizing the Hotkey

Edit `dictation.py` and modify the `Config` class:

```python
@dataclass
class Config:
    # Change to Cmd+Shift+D on Mac:
    hotkey_modifiers: set = field(default_factory=lambda: {keyboard.Key.cmd, keyboard.Key.shift})
    hotkey_key: keyboard.KeyCode = field(default_factory=lambda: keyboard.KeyCode.from_char('d'))
```

**Available modifiers:**
- `keyboard.Key.ctrl` - Control
- `keyboard.Key.shift` - Shift
- `keyboard.Key.alt` - Alt/Option
- `keyboard.Key.cmd` - Command (Mac only)

## Performance Tips

### 1. Use faster-whisper (4x faster)

```bash
pip install faster-whisper
python dictation_fast.py
```

### 2. Use GPU acceleration (if you have NVIDIA GPU)

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu118
python dictation_fast.py --device cuda
```

### 3. Use a smaller model for quick responses

```bash
python dictation.py --model tiny
```

## Troubleshooting

### "No module named 'sounddevice'"
```bash
pip install sounddevice
# On Mac: brew install portaudio
# On Linux: sudo apt install portaudio19-dev
```

### "Permission denied" on Linux
You may need to add your user to the `input` group for keyboard access:
```bash
sudo usermod -aG input $USER
# Then log out and back in
```

### Hotkey not working
- Make sure no other application is using Ctrl+Shift+Space
- On Mac, grant accessibility permissions to Terminal/your IDE in System Preferences
- Try running with `sudo` (not recommended for regular use)

### Slow transcription
- Use a smaller model (`--model tiny` or `--model base`)
- Use `faster-whisper` version instead
- If you have an NVIDIA GPU, use `--device cuda`

### Text not inserting
- The tool uses clipboard paste (Ctrl+V / Cmd+V)
- Make sure the target application accepts paste
- Some terminal emulators may use different paste shortcuts

## How It Works

```
┌─────────────────────┐
│  Global Hotkey      │  Ctrl+Shift+Space detected
│  (pynput)           │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Record Audio       │  Captures from microphone
│  (sounddevice)      │  at 16kHz mono
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Transcribe         │  Whisper converts
│  (whisper/faster)   │  speech to text
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Post-Process       │  Remove fillers,
│  (TextProcessor)    │  apply dictionary,
│                     │  expand snippets
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Insert Text        │  Paste into
│  (pyautogui)        │  focused app
└─────────────────────┘
```

## Comparison with Wispr Flow

| Feature | This Tool | Wispr Flow |
|---------|-----------|------------|
| Price | Free | $10/month |
| Privacy | 100% local | Cloud processing |
| Speed | 1-3 seconds | <1 second |
| Accuracy | Very good | Excellent |
| Custom dictionary | ✅ | ✅ |
| Snippets | ✅ | ✅ |
| Multi-language | ✅ | ✅ |
| App-specific tones | ❌ | ✅ |
| Mobile app | ❌ | ✅ |

## Contributing

Feel free to submit issues and pull requests!

## License

MIT License - do whatever you want with it!
