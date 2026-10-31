// Desktop-shell housekeeping: usage heartbeat and "new version" notice.
//
// Mounted on the root element of `Layouts.desktop`, so it runs in every desktop
// window (map selection, map, widgets). Outside the Tauri shell there is no
// invoke bridge and the hook does nothing, so web maps never report.
//
// - heartbeat: one upsert per window mount; the server keys by install_id, so
//   opening several widget windows does not inflate install counts.
// - update: the page tells the user to get the new build from the QQ group's
//   shared files (there is no in-app updater yet). Only the main map/selection
//   window shows it; small widget windows stay unobstructed.

const INSTALL_ID_KEY = 'wanderer:desktop:install-id';
const UPDATE_SKIP_KEY = 'wanderer:desktop:update-skip';

// The layout hook can remount during in-session navigation; check once per page
// load so a dismissed notice does not pop back.
let updateCheckStarted = false;

type InvokeFn = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: InvokeFn } };
    __TAURI_INTERNALS__?: { invoke?: InvokeFn };
  }
}

function getInvoke(): InvokeFn | null {
  const tauri = window.__TAURI__;
  if (tauri?.core?.invoke) {
    return tauri.core.invoke;
  }

  const internals = window.__TAURI_INTERNALS__;
  if (internals?.invoke) {
    return internals.invoke;
  }

  return null;
}

function createInstallId(): string {
  // Matches the server-side install id pattern: [A-Za-z0-9_-]{8,128}.
  const cryptoObj = window.crypto;

  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function readInstallId(): string {
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY);

    if (existing) {
      return existing;
    }

    const created = createInstallId();
    localStorage.setItem(INSTALL_ID_KEY, created);
    return created;
  } catch {
    // Private/hardened profiles may block storage; the heartbeat still counts
    // for the current session, it just cannot be deduplicated across restarts.
    return createInstallId();
  }
}

function readSkippedVersion(): string | null {
  try {
    return localStorage.getItem(UPDATE_SKIP_KEY);
  } catch {
    return null;
  }
}

function writeSkippedVersion(version: string) {
  try {
    localStorage.setItem(UPDATE_SKIP_KEY, version);
  } catch {
    // Ignored: the notice can show again next launch.
  }
}

async function readClientVersion(): Promise<string | null> {
  const invoke = getInvoke();

  if (!invoke) {
    return null;
  }

  try {
    const result = (await invoke('desktop_ready', {})) as { version?: unknown } | null;

    return typeof result?.version === 'string' && result.version.trim() !== ''
      ? result.version.trim()
      : null;
  } catch {
    return null;
  }
}

function parseVersion(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map(part => parseInt(part, 10))
    .map(number => (Number.isFinite(number) ? number : 0));
}

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);

  for (let index = 0; index < Math.max(latestParts.length, currentParts.length); index += 1) {
    const left = latestParts[index] ?? 0;
    const right = currentParts[index] ?? 0;

    if (left !== right) {
      return left > right;
    }
  }

  return false;
}

function isWidgetWindow(): boolean {
  return window.location.pathname.includes('/widget/');
}

function createButton(label: string, primary: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = [
    'padding: 6px 12px',
    'border-radius: 6px',
    'font-size: 13px',
    'cursor: pointer',
    primary ? 'background: #2563eb' : 'background: transparent',
    primary ? 'border: 1px solid #2563eb' : 'border: 1px solid #57534e',
    'color: #f5f5f4',
  ].join(';');

  return button;
}

function showUpdateNotice(payload: { latest: string; current: string; notes?: string | null }) {
  if (document.getElementById('desktop-update-notice')) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'desktop-update-notice';
  overlay.style.cssText = [
    'position: fixed',
    'inset: 0',
    'z-index: 2147483000',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'padding: 16px',
    'background: rgba(0, 0, 0, 0.65)',
    'font-family: inherit',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width: min(420px, 100%)',
    'padding: 20px',
    'border: 1px solid #57534e',
    'border-radius: 8px',
    'background: #1c1917',
    'color: #e7e5e4',
    'box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5)',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = `发现新版本 ${payload.latest}`;
  title.style.cssText = 'font-size: 16px; font-weight: 600; margin-bottom: 8px;';
  card.appendChild(title);

  const currentLine = document.createElement('div');
  currentLine.textContent = `当前版本 ${payload.current}，请前往 QQ 群共享下载新版本安装包，安装后重新启动客户端。`;
  currentLine.style.cssText = 'font-size: 13px; line-height: 1.6; color: #d6d3d1;';
  card.appendChild(currentLine);

  if (payload.notes) {
    const notes = document.createElement('div');
    notes.textContent = payload.notes;
    notes.style.cssText =
      'margin-top: 10px; font-size: 12px; line-height: 1.6; color: #a8a29e; white-space: pre-wrap;';
    card.appendChild(notes);
  }

  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px;';

  const dismiss = createButton('知道了', true);
  dismiss.addEventListener('click', () => overlay.remove());

  const skip = createButton('本版本不再提醒', false);
  skip.addEventListener('click', () => {
    writeSkippedVersion(payload.latest);
    overlay.remove();
  });

  actions.appendChild(skip);
  actions.appendChild(dismiss);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function checkForUpdate(updateUrl: string, currentVersion: string) {
  // Widget windows are skipped so they stay unobstructed; the main window
  // checks once per page load.
  if (isWidgetWindow() || updateCheckStarted) {
    return;
  }

  updateCheckStarted = true;

  try {
    const response = await fetch(updateUrl, { headers: { Accept: 'application/json' } });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      latest?: unknown;
      notes?: unknown;
    };
    const latest = typeof payload.latest === 'string' ? payload.latest.trim() : '';

    if (!latest || !isNewerVersion(latest, currentVersion)) {
      return;
    }

    if (readSkippedVersion() === latest) {
      return;
    }

    showUpdateNotice({
      latest,
      current: currentVersion,
      notes: typeof payload.notes === 'string' && payload.notes.trim() !== '' ? payload.notes : null,
    });
  } catch {
    // Offline or server without the endpoint: silently skip.
  }
}

export default {
  mounted() {
    const hook = this as any;
    const invoke = getInvoke();

    if (!invoke) {
      // Web build: the desktop client only.
      return;
    }

    const platform = String(navigator.platform || navigator.userAgent || '').slice(0, 64);

    // One heartbeat, after the native version is known. The server upserts by
    // install_id, so sending twice (empty version first) would just risk the
    // versioned row being overwritten by an out-of-order empty one.
    void readClientVersion().then(version => {
      hook.pushEvent('desktop_heartbeat', {
        install_id: readInstallId(),
        version: version || '',
        platform,
      });

      const updateUrl = hook.el?.dataset.updateUrl;

      if (version && updateUrl) {
        void checkForUpdate(updateUrl, version);
      }
    });
  },
};
