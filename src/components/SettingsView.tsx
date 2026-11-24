import type { CameraDeviceOption, StillSettings, ThemeMode } from '../types';

interface SettingsViewProps {
  settings: StillSettings;
  theme: ThemeMode;
  autoPipSupported: boolean;
  autoPipPermission: 'granted' | 'prompt' | 'denied' | 'unknown';
  availableCameras: CameraDeviceOption[];
  onUpdateSettings: (patch: Partial<StillSettings>) => void;
  onSelectCamera: (deviceId: string) => void;
  onToggleTheme: () => void;
  onTestStage1: () => void;
  onTestStage2: () => void;
}

export function SettingsView({
  settings,
  theme,
  autoPipSupported,
  autoPipPermission,
  availableCameras,
  onUpdateSettings,
  onSelectCamera,
  onToggleTheme,
  onTestStage1,
  onTestStage2,
}: SettingsViewProps) {
  const trimmedName = settings.userName.trim();

  return (
    <div className="view-stack">
      <header className="page-intro">
        <h1 className="page-title">Settings</h1>
        <p className="page-lead">
          Personalize how Still speaks to you, choose your camera, tune gentle cues, and configure
          your floating mini-window. Everything stays saved locally in this browser.
        </p>
      </header>

      {/* Camera Selection */}
      <section className="editorial-section" aria-label="Camera selection">
        <div className="section-head-row">
          <h2 className="section-heading">Camera</h2>
          <span className="section-meta">Auto picks front-facing</span>
        </div>

        <div className="settings-card">
          <div className="camera-picker-row">
            <label htmlFor="select-settings-camera" className="slider-label">
              Active camera
            </label>
            <select
              id="select-settings-camera"
              className="editorial-select"
              value={settings.selectedCameraId}
              onChange={(e) => onSelectCamera(e.target.value)}
            >
              <option value="">Automatic (scans connected cameras &amp; picks front view)</option>
              {availableCameras.map((cam) => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cam.label}
                </option>
              ))}
            </select>
          </div>
          <p className="settings-preview-note">
            In Automatic mode, Still briefly checks all connected cameras when you begin and picks
            the one straight in front of your face (such as an external Logitech desk webcam instead
            of a side laptop camera). If unplugged, it falls back automatically.
          </p>
        </div>
      </section>

      {/* Personalization: Your name */}
      <section className="editorial-section" aria-label="Personalization">
        <div className="section-head-row">
          <h2 className="section-heading">Your name</h2>
          <span className="section-meta">Optional · Stored locally</span>
        </div>

        <div className="settings-card">
          <label htmlFor="input-user-name" className="slider-label">
            First name or nickname for gentle warnings
          </label>
          <input
            id="input-user-name"
            type="text"
            className="editorial-input"
            maxLength={32}
            placeholder="e.g. Alex"
            value={settings.userName}
            onChange={(e) => onUpdateSettings({ userName: e.target.value })}
          />
          <p className="settings-preview-note">
            {trimmedName ? (
              <>
                Preview: <em>“{trimmedName}, let the urge crest and pass.”</em>
              </>
            ) : (
              'Add your name so Still can gently address you by name when your hand lifts — it helps break autopilot faster.'
            )}
          </p>
        </div>
      </section>

      {/* Gentle Cues (moved from Today for a calmer home screen) */}
      <section className="editorial-section" aria-label="Gentle cues">
        <div className="section-head-row">
          <h2 className="section-heading">Gentle cues</h2>
          <div className="settings-inline-actions">
            <button
              type="button"
              id="btn-settings-test-cue"
              className="text-link-btn"
              onClick={onTestStage1}
            >
              Test glow &amp; chime
            </button>
            <span className="meta-dot" aria-hidden="true">
              ·
            </span>
            <button
              type="button"
              id="btn-preview-pause-sheet"
              className="text-link-btn"
              onClick={onTestStage2}
            >
              Preview 60s pause
            </button>
          </div>
        </div>

        <div className="toggle-list">
          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">
                Stage 1 · Edge glow &amp; singing bowl{' '}
                <span className="inline-timing tabular">
                  ~{settings.stage1DwellSec.toFixed(1)}s
                </span>
              </div>
              <p className="toggle-desc">
                Warm peripheral screen glow and soft chime, with a 5-second auto-catch when you
                lower your hand.
              </p>
            </div>
            <button
              type="button"
              id="toggle-stage1"
              role="switch"
              aria-checked={settings.stage1Enabled}
              aria-label="Toggle Stage 1 warm glow and chime"
              className={`switch ${settings.stage1Enabled ? 'switch--on' : ''}`}
              onClick={() => onUpdateSettings({ stage1Enabled: !settings.stage1Enabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">
                Stage 2 · 60s competing-response pause{' '}
                <span className="inline-timing tabular">
                  ~{settings.stage2DwellSec.toFixed(1)}s
                </span>
              </div>
              <p className="toggle-desc">
                Calm HRT pause sheet with glowing light, visual hand guide, auto-catch, Grace
                recovery, and False alarm.
              </p>
            </div>
            <button
              type="button"
              id="toggle-stage2"
              role="switch"
              aria-checked={settings.stage2Enabled}
              aria-label="Toggle Stage 2 60-second pause sheet"
              className={`switch ${settings.stage2Enabled ? 'switch--on' : ''}`}
              onClick={() => onUpdateSettings({ stage2Enabled: !settings.stage2Enabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">Singing-bowl chime audio</div>
              <p className="toggle-desc">
                Synthesized locally via Web Audio. Turn off for visual-only glowing light in quiet
                rooms.
              </p>
            </div>
            <button
              type="button"
              id="toggle-sound"
              role="switch"
              aria-checked={settings.soundEnabled}
              aria-label="Toggle singing-bowl chime audio"
              className={`switch ${settings.soundEnabled ? 'switch--on' : ''}`}
              onClick={() => onUpdateSettings({ soundEnabled: !settings.soundEnabled })}
            >
              <span className="switch-thumb" />
            </button>
          </div>

          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">Repeat soft chime during pause alert</div>
              <p className="toggle-desc">
                Gently repeats the singing bowl every few seconds alongside the glowing light until
                you respond or mute it.
              </p>
            </div>
            <button
              type="button"
              id="toggle-repeat-chime"
              role="switch"
              aria-checked={settings.stage2RepeatChime}
              aria-label="Toggle repeating chime during Stage 2 pause alert"
              className={`switch ${settings.stage2RepeatChime ? 'switch--on' : ''}`}
              onClick={() =>
                onUpdateSettings({ stage2RepeatChime: !settings.stage2RepeatChime })
              }
            >
              <span className="switch-thumb" />
            </button>
          </div>
        </div>
      </section>

      {/* Floating Mini-Window (Picture-in-Picture) */}
      <section className="editorial-section" aria-label="Floating mini-window">
        <div className="section-head-row">
          <h2 className="section-heading">Floating mini-window (Picture-in-Picture)</h2>
        </div>

        <div className="settings-card">
          <p className="settings-explainer">
            <strong>What is it?</strong> Picture-in-Picture pops Still out into a tiny,
            always-on-top card in the corner of your screen. That way you can read articles, work
            in other tabs, or browse while still seeing the warm orange glow and hearing the chime
            if your hand drifts up.
          </p>

          <div className="toggle-row toggle-row--compact">
            <div className="toggle-copy">
              <div className="toggle-title">Auto-float when switching tabs</div>
              <p className="toggle-desc">
                {autoPipPermission === 'denied'
                  ? 'Currently blocked in Chrome site settings. Click the tune icon left of the address bar and allow "Automatic picture-in-picture".'
                  : autoPipSupported
                    ? 'When a session is running and you switch browser tabs, Still pops out automatically. To stay on top of other desktop apps (like Slack or Notes), click "Float mini-window" once.'
                    : 'Supported automatically on Desktop Chrome & Edge when you switch tabs. On iPadOS and Safari, Apple requires a single tap on "Float mini-window" for privacy.'}
              </p>
            </div>
            <button
              type="button"
              id="toggle-auto-pip"
              role="switch"
              aria-checked={settings.autoPipOnTabSwitch}
              aria-label="Toggle automatic floating mini-window when switching tabs"
              className={`switch ${settings.autoPipOnTabSwitch ? 'switch--on' : ''}`}
              onClick={() =>
                onUpdateSettings({ autoPipOnTabSwitch: !settings.autoPipOnTabSwitch })
              }
            >
              <span className="switch-thumb" />
            </button>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="editorial-section" aria-label="Appearance">
        <div className="section-head-row">
          <h2 className="section-heading">Appearance</h2>
        </div>
        <div className="toggle-list">
          <div className="toggle-row">
            <div className="toggle-copy">
              <div className="toggle-title">
                Theme · {theme === 'light' ? 'Warm Paper' : 'Dark Editorial'}
              </div>
              <p className="toggle-desc">
                Switch between light warm alabaster paper and low-glare dark charcoal.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-subtle btn-sm"
              onClick={onToggleTheme}
            >
              Switch to {theme === 'light' ? 'Dark' : 'Paper'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
