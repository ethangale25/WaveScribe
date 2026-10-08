import React, { useState } from 'react';

const VoiceDictationPreview = () => {
  const [isDark, setIsDark] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Ready');
  
  const theme = {
    dark: {
      bg: '#1c1c1e',
      cardBg: '#2c2c2e',
      text: '#ffffff',
      textSecondary: '#8e8e93',
      border: '#3a3a3c',
      accent: '#007aff',
      green: '#34c759',
      red: '#ff3b30',
      orange: '#ff9500',
    },
    light: {
      bg: '#f2f2f7',
      cardBg: '#ffffff',
      text: '#000000',
      textSecondary: '#6c6c70',
      border: '#d1d1d6',
      accent: '#007aff',
      green: '#34c759',
      red: '#ff3b30',
      orange: '#ff9500',
    }
  };
  
  const t = isDark ? theme.dark : theme.light;
  
  const historyItems = [
    { time: '14:32', text: 'Hello, this is a test of the voice dictation system and it works great...' },
    { time: '14:28', text: 'Remember to pick up groceries on the way home from work today...' },
    { time: '14:15', text: 'Meeting notes: discussed Q4 roadmap, assigned tasks to team...' },
    { time: '13:52', text: 'Email draft: Thank you for reaching out regarding the project...' },
  ];
  
  const handleRecord = () => {
    if (!isRecording) {
      setIsRecording(true);
      setStatus('Recording...');
      // Simulate recording then processing
      setTimeout(() => {
        setStatus('Processing...');
        setTimeout(() => {
          setIsRecording(false);
          setStatus('Ready');
        }, 1500);
      }, 2000);
    } else {
      setStatus('Processing...');
      setTimeout(() => {
        setIsRecording(false);
        setStatus('Ready');
      }, 1500);
    }
  };
  
  const StatusIndicator = () => {
    let color = t.green;
    if (status === 'Recording...') color = t.red;
    if (status === 'Processing...') color = t.orange;
    
    return (
      <div style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        boxShadow: `0 0 8px ${color}`,
        animation: status === 'Recording...' ? 'pulse 1s infinite' : 'none',
      }} />
    );
  };

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      backgroundColor: t.bg,
      minHeight: '100vh',
      padding: 20,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-start',
      paddingTop: 40,
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.1); }
        }
        @keyframes recording {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.4); }
          50% { box-shadow: 0 0 0 8px rgba(255, 59, 48, 0); }
        }
      `}</style>
      
      {/* Main App Window */}
      <div style={{
        width: 420,
        backgroundColor: t.cardBg,
        borderRadius: 16,
        boxShadow: isDark 
          ? '0 25px 50px rgba(0,0,0,0.5)' 
          : '0 25px 50px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        border: `1px solid ${t.border}`,
      }}>
        
        {/* Window Title Bar */}
        <div style={{
          padding: '12px 16px',
          backgroundColor: isDark ? '#2c2c2e' : '#e5e5ea',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#ff5f57' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#febc2e' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28c840' }} />
          </div>
          <span style={{ 
            flex: 1, 
            textAlign: 'center', 
            fontSize: 13, 
            color: t.textSecondary,
            fontWeight: 500,
          }}>
            Voice Dictation
          </span>
          <div style={{ width: 52 }} />
        </div>
        
        {/* Content */}
        <div style={{ padding: 24 }}>
          
          {/* Header */}
          <div style={{ marginBottom: 24 }}>
            <h1 style={{ 
              fontSize: 28, 
              fontWeight: 700, 
              color: t.text,
              margin: 0,
              letterSpacing: '-0.5px',
            }}>
              Voice Dictation
            </h1>
            <p style={{ 
              fontSize: 14, 
              color: t.textSecondary,
              margin: '4px 0 0 0',
            }}>
              Speak naturally, type effortlessly
            </p>
          </div>
          
          {/* Status Card */}
          <div style={{
            backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              marginBottom: 16,
            }}>
              <StatusIndicator />
              <span style={{ 
                fontSize: 15, 
                color: t.text,
                fontWeight: 500,
              }}>
                {status}
              </span>
            </div>
            
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              marginBottom: 16,
            }}>
              <span style={{ fontSize: 13, color: t.textSecondary }}>Hotkey</span>
              <code style={{
                backgroundColor: isDark ? '#1c1c1e' : '#e5e5ea',
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontFamily: 'SF Mono, Consolas, monospace',
                color: t.text,
              }}>
                CTRL + SHIFT + SPACE
              </code>
            </div>
            
            <button
              onClick={handleRecord}
              style={{
                width: '100%',
                padding: '12px 20px',
                borderRadius: 10,
                border: 'none',
                backgroundColor: isRecording ? t.red : t.accent,
                color: 'white',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s',
                animation: isRecording ? 'recording 1.5s infinite' : 'none',
              }}
            >
              {isRecording ? '⏹ Stop Recording' : '🎤 Click to Record'}
            </button>
          </div>
          
          {/* Stats Card */}
          <div style={{
            backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}>
            <h3 style={{ 
              fontSize: 13, 
              fontWeight: 600, 
              color: t.textSecondary,
              margin: '0 0 12px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Your Stats
            </h3>
            
            <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: t.text }}>42</div>
                <div style={{ fontSize: 12, color: t.textSecondary }}>Dictations</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: t.text }}>1,847</div>
                <div style={{ fontSize: 12, color: t.textSecondary }}>Words</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 700, color: t.text }}>23m</div>
                <div style={{ fontSize: 12, color: t.textSecondary }}>Time Saved</div>
              </div>
            </div>
          </div>
          
          {/* History Card */}
          <div style={{
            backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
            borderRadius: 12,
            padding: 16,
            marginBottom: 16,
          }}>
            <h3 style={{ 
              fontSize: 13, 
              fontWeight: 600, 
              color: t.textSecondary,
              margin: '0 0 12px 0',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Recent Dictations
            </h3>
            
            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
              {historyItems.map((item, i) => (
                <div 
                  key={i}
                  style={{
                    padding: '10px 12px',
                    backgroundColor: isDark ? '#2c2c2e' : '#ffffff',
                    borderRadius: 8,
                    marginBottom: 8,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ 
                    fontSize: 11, 
                    color: t.accent,
                    fontWeight: 600,
                    marginRight: 8,
                  }}>
                    [{item.time}]
                  </span>
                  <span style={{ 
                    fontSize: 13, 
                    color: t.text,
                  }}>
                    {item.text.length > 50 ? item.text.slice(0, 50) + '...' : item.text}
                  </span>
                </div>
              ))}
            </div>
            
            <p style={{ 
              fontSize: 11, 
              color: t.textSecondary,
              margin: '8px 0 0 0',
            }}>
              Double-click to copy to clipboard
            </p>
          </div>
          
          {/* Bottom Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              backgroundColor: 'transparent',
              color: t.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              ⚙️ Settings
            </button>
            
            <button style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              backgroundColor: 'transparent',
              color: t.text,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              ℹ️ About
            </button>
            
            <div style={{ flex: 1 }} />
            
            <button 
              onClick={() => setIsDark(!isDark)}
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${t.border}`,
                backgroundColor: 'transparent',
                color: t.text,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              {isDark ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </div>
      
      {/* Settings Window Preview */}
      <div style={{
        width: 340,
        backgroundColor: t.cardBg,
        borderRadius: 12,
        boxShadow: isDark 
          ? '0 20px 40px rgba(0,0,0,0.4)' 
          : '0 20px 40px rgba(0,0,0,0.12)',
        marginLeft: 24,
        overflow: 'hidden',
        border: `1px solid ${t.border}`,
      }}>
        <div style={{
          padding: '12px 16px',
          backgroundColor: isDark ? '#2c2c2e' : '#e5e5ea',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#ff5f57' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#febc2e' }} />
            <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#28c840' }} />
          </div>
          <span style={{ 
            flex: 1, 
            textAlign: 'center', 
            fontSize: 13, 
            color: t.textSecondary,
            fontWeight: 500,
          }}>
            Settings
          </span>
          <div style={{ width: 52 }} />
        </div>
        
        <div style={{ padding: 20 }}>
          <h2 style={{ 
            fontSize: 22, 
            fontWeight: 700, 
            color: t.text,
            margin: '0 0 20px 0',
          }}>
            Settings
          </h2>
          
          {/* Hotkey Settings */}
          <div style={{
            backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
          }}>
            <h4 style={{ 
              fontSize: 12, 
              color: t.textSecondary,
              margin: '0 0 10px 0',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Hotkey
            </h4>
            
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 13, color: t.text, display: 'block', marginBottom: 4 }}>
                Modifier
              </label>
              <select style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${t.border}`,
                backgroundColor: isDark ? '#2c2c2e' : '#ffffff',
                color: t.text,
                fontSize: 13,
              }}>
                <option>ctrl+shift</option>
                <option>ctrl+alt</option>
                <option>alt+shift</option>
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: 13, color: t.text, display: 'block', marginBottom: 4 }}>
                Key
              </label>
              <select style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${t.border}`,
                backgroundColor: isDark ? '#2c2c2e' : '#ffffff',
                color: t.text,
                fontSize: 13,
              }}>
                <option>space</option>
                <option>d</option>
                <option>r</option>
                <option>f1</option>
              </select>
            </div>
          </div>
          
          {/* Model Settings */}
          <div style={{
            backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
          }}>
            <h4 style={{ 
              fontSize: 12, 
              color: t.textSecondary,
              margin: '0 0 10px 0',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Speech Recognition
            </h4>
            
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 13, color: t.text, display: 'block', marginBottom: 4 }}>
                Model
              </label>
              <select style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${t.border}`,
                backgroundColor: isDark ? '#2c2c2e' : '#ffffff',
                color: t.text,
                fontSize: 13,
              }}>
                <option>tiny (fastest)</option>
                <option>base (balanced)</option>
                <option>small (accurate)</option>
                <option>medium (very accurate)</option>
              </select>
            </div>
          </div>
          
          {/* Checkboxes */}
          <div style={{
            backgroundColor: isDark ? '#3a3a3c' : '#f2f2f7',
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
          }}>
            <h4 style={{ 
              fontSize: 12, 
              color: t.textSecondary,
              margin: '0 0 10px 0',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Text Processing
            </h4>
            
            {['Remove filler words', 'Auto-capitalize', 'Play sounds'].map((label, i) => (
              <label key={i} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8,
                fontSize: 13,
                color: t.text,
                marginBottom: 8,
                cursor: 'pointer',
              }}>
                <input type="checkbox" defaultChecked style={{ 
                  width: 16, 
                  height: 16,
                  accentColor: t.accent,
                }} />
                {label}
              </label>
            ))}
          </div>
          
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: `1px solid ${t.border}`,
              backgroundColor: 'transparent',
              color: t.text,
              fontSize: 13,
              cursor: 'pointer',
            }}>
              Cancel
            </button>
            <button style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              backgroundColor: t.accent,
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceDictationPreview;
