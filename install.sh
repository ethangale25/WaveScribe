#!/bin/bash
# Voice Dictation Tool - Installation Script

set -e

echo "🎙️  Voice Dictation Tool - Installation"
echo "========================================"
echo

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    echo "Detected: macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
    echo "Detected: Linux"
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    OS="windows"
    echo "Detected: Windows"
else
    echo "Unknown OS: $OSTYPE"
    OS="unknown"
fi

echo

# Check Python
echo "Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    echo "❌ Python not found. Please install Python 3.8 or later."
    exit 1
fi

PYTHON_VERSION=$($PYTHON --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
echo "Found Python $PYTHON_VERSION"

# Install system dependencies
echo
echo "Installing system dependencies..."

if [[ "$OS" == "macos" ]]; then
    if command -v brew &> /dev/null; then
        echo "Installing portaudio via Homebrew..."
        brew install portaudio || true
    else
        echo "⚠️  Homebrew not found. Please install portaudio manually:"
        echo "   brew install portaudio"
    fi
elif [[ "$OS" == "linux" ]]; then
    if command -v apt-get &> /dev/null; then
        echo "Installing dependencies via apt..."
        sudo apt-get update
        sudo apt-get install -y portaudio19-dev python3-dev xdotool xclip
    elif command -v dnf &> /dev/null; then
        echo "Installing dependencies via dnf..."
        sudo dnf install -y portaudio-devel python3-devel xdotool xclip
    elif command -v pacman &> /dev/null; then
        echo "Installing dependencies via pacman..."
        sudo pacman -S --noconfirm portaudio python xdotool xclip
    else
        echo "⚠️  Package manager not detected. Please install manually:"
        echo "   - portaudio"
        echo "   - xdotool"
        echo "   - xclip"
    fi
fi

# Create virtual environment
echo
echo "Creating virtual environment..."
$PYTHON -m venv venv

# Activate virtual environment
if [[ "$OS" == "windows" ]]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi

# Upgrade pip
echo
echo "Upgrading pip..."
pip install --upgrade pip

# Install Python dependencies
echo
echo "Installing Python dependencies..."
pip install -r requirements.txt

# Install faster-whisper (optional but recommended)
echo
echo "Installing faster-whisper (recommended for better performance)..."
pip install faster-whisper

echo
echo "========================================"
echo "✅ Installation complete!"
echo "========================================"
echo
echo "To use the tool:"
echo
echo "1. Activate the virtual environment:"
if [[ "$OS" == "windows" ]]; then
    echo "   source venv/Scripts/activate"
else
    echo "   source venv/bin/activate"
fi
echo
echo "2. Run the dictation tool:"
echo "   python dictation_fast.py"
echo
echo "3. Press Ctrl+Shift+Space to start/stop recording"
echo
echo "Optional: For AI polishing, install Ollama:"
echo "   https://ollama.ai"
echo "   ollama pull llama3.2:1b"
echo "   python dictation_with_ai.py"
echo
