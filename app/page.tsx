"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmulatorBridge, EmulatorState } from "@gba-kit/gba-browser";
import type { GbaSnapshot } from "@gba-kit/gba-emulator/savestate";

type Game = { id: string; title: string; addedAt: number; lastPlayed: number; size: number; rom: ArrayBuffer };
type StoredState = { id: string; gameId: string; name: string; createdAt: number; snapshot: GbaSnapshot; thumbnail?: Blob };
type Bind = { type: "button"; index: number } | { type: "axis"; index: number; direction: 1 | -1 };
type Profile = { id: string; name: string; mapping: Partial<Record<ButtonName, Bind>> };
type ButtonName = "A" | "B" | "Select" | "Start" | "Right" | "Left" | "Up" | "Down" | "R" | "L";

const BUTTONS: ButtonName[] = ["Up", "Down", "Left", "Right", "A", "B", "L", "R", "Start", "Select"];
const BUTTON_INDEX: Record<ButtonName, number> = { A: 0, B: 1, Select: 2, Start: 3, Right: 4, Left: 5, Up: 6, Down: 7, R: 8, L: 9 };
const DEFAULT_PROFILE: Profile = {
  id: "standard",
  name: "Standard gamepad",
  mapping: {
    A: { type: "button", index: 0 }, B: { type: "button", index: 1 }, Select: { type: "button", index: 8 },
    Start: { type: "button", index: 9 }, Up: { type: "button", index: 12 }, Down: { type: "button", index: 13 },
    Left: { type: "button", index: 14 }, Right: { type: "button", index: 15 }, L: { type: "button", index: 4 }, R: { type: "button", index: 5 },
  },
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pocketlane", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("games")) db.createObjectStore("games", { keyPath: "id" });
      if (!db.objectStoreNames.contains("states")) db.createObjectStore("states", { keyPath: "id" });
      if (!db.objectStoreNames.contains("battery")) db.createObjectStore("battery", { keyPath: "gameId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(store: string, value: unknown) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(store: string, key: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(store, "readwrite").objectStore(store).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function romTitle(buffer: ArrayBuffer, fallback: string) {
  const bytes = new Uint8Array(buffer, 0xa0, Math.min(12, Math.max(0, buffer.byteLength - 0xa0)));
  const header = new TextDecoder().decode(bytes).replace(/\0/g, "").trim();
  return header || fallback.replace(/\.gba$/i, "");
}

function hashRom(buffer: ArrayBuffer) {
  return crypto.subtle.digest("SHA-256", buffer).then(hash => [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, "0")).join(""));
}

function formatBytes(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function bindLabel(bind?: Bind) {
  if (!bind) return "Not set";
  return bind.type === "button" ? `Button ${bind.index}` : `Axis ${bind.index} ${bind.direction > 0 ? "+" : "−"}`;
}

export default function Pocketlane() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const emulatorRef = useRef<EmulatorBridge | null>(null);
  const gameRef = useRef<Game | null>(null);
  const heldRef = useRef(new Set<number>());
  const captureRef = useRef<{ button: ButtonName; baseline: number[]; axes: number[] } | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [screen, setScreen] = useState<"library" | "player">("library");
  const [emuState, setEmuState] = useState<EmulatorState>("idle");
  const [notice, setNotice] = useState("Everything stays on this device.");
  const [states, setStates] = useState<StoredState[]>([]);
  const [filter, setFilter] = useState(() => localStorageSafe("pocketlane-filter") || "pixel");
  const [sound, setSound] = useState(false);
  const [panel, setPanel] = useState<"none" | "states" | "controls">("none");
  const [gamepads, setGamepads] = useState<Gamepad[]>([]);
  const [gamepadIndex, setGamepadIndex] = useState<number>(0);
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [profileId, setProfileId] = useState(() => localStorageSafe("pocketlane-profile") || "standard");
  const [capture, setCapture] = useState<ButtonName | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const profile = useMemo(() => profiles.find(p => p.id === profileId) || profiles[0], [profiles, profileId]);

  useEffect(() => {
    dbAll<Game>("games").then(rows => setGames(rows.sort((a, b) => b.lastPlayed - a.lastPlayed))).catch(() => setNotice("Browser storage could not be opened."));
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    const connect = () => setGamepads([...navigator.getGamepads()].filter(Boolean) as Gamepad[]);
    window.addEventListener("gamepadconnected", connect);
    window.addEventListener("gamepaddisconnected", connect);
    connect();
    return () => { window.removeEventListener("gamepadconnected", connect); window.removeEventListener("gamepaddisconnected", connect); };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => emulatorRef.current?.handleKeyDown(event);
    const up = (event: KeyboardEvent) => emulatorRef.current?.handleKeyUp(event);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  useEffect(() => {
    if (screen !== "player") return;
    let frame = 0;
    const poll = () => {
      const pad = navigator.getGamepads()[gamepadIndex];
      if (pad && emulatorRef.current) {
        const pending = captureRef.current;
        if (pending) {
          for (let i = 0; i < pad.buttons.length; i++) {
            if (pad.buttons[i].pressed && !pending.baseline[i]) finishCapture(pending.button, { type: "button", index: i });
          }
          for (let i = 0; i < pad.axes.length; i++) {
            if (Math.abs(pad.axes[i]) > .72 && Math.abs(pending.axes[i] || 0) < .35) finishCapture(pending.button, { type: "axis", index: i, direction: pad.axes[i] > 0 ? 1 : -1 });
          }
        } else {
          for (const name of BUTTONS) {
            const bind = profile?.mapping[name];
            if (!bind) continue;
            const pressed = bind.type === "button" ? !!pad.buttons[bind.index]?.pressed : (pad.axes[bind.index] || 0) * bind.direction > .55;
            const bit = BUTTON_INDEX[name];
            if (pressed && !heldRef.current.has(bit)) { emulatorRef.current.gba.input.press(bit); heldRef.current.add(bit); }
            if (!pressed && heldRef.current.has(bit)) { emulatorRef.current.gba.input.release(bit); heldRef.current.delete(bit); }
          }
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [screen, gamepadIndex, profile]);

  const persistBattery = useCallback(async () => {
    const emu = emulatorRef.current;
    const game = gameRef.current;
    if (!emu || !game) return;
    const data = emu.gba.bus.readBackup();
    if (data) await dbPut("battery", { gameId: game.id, data, updatedAt: Date.now() });
  }, []);

  useEffect(() => {
    if (!activeGame) return;
    const timer = window.setInterval(() => { persistBattery().catch(() => undefined); }, 4000);
    const hidden = () => { if (document.hidden) persistBattery().catch(() => undefined); };
    document.addEventListener("visibilitychange", hidden);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", hidden); persistBattery().catch(() => undefined); };
  }, [activeGame, persistBattery]);

  async function importGames(files: FileList | File[]) {
    const incoming = [...files].filter(file => file.name.toLowerCase().endsWith(".gba"));
    if (!incoming.length) { setNotice("Choose a .gba file to add a game."); return; }
    let newest: Game | null = null;
    for (const file of incoming) {
      const rom = await file.arrayBuffer();
      const id = await hashRom(rom);
      const existing = await dbGet<Game>("games", id);
      const game: Game = { id, title: romTitle(rom, file.name), size: rom.byteLength, addedAt: existing?.addedAt || Date.now(), lastPlayed: existing?.lastPlayed || 0, rom };
      await dbPut("games", game);
      newest = game;
    }
    const all = await dbAll<Game>("games");
    setGames(all.sort((a, b) => b.lastPlayed - a.lastPlayed));
    setNotice(`${incoming.length} ${incoming.length === 1 ? "game" : "games"} added to your private library.`);
    if (newest && games.length === 0) await playGame(newest);
  }

  async function playGame(game: Game) {
    await persistBattery();
    emulatorRef.current?.stop();
    setScreen("player");
    setPanel("none");
    setActiveGame(game);
    gameRef.current = game;
    game.lastPlayed = Date.now();
    await dbPut("games", game);
    setGames(prev => prev.map(g => g.id === game.id ? game : g).sort((a, b) => b.lastPlayed - a.lastPlayed));
    const { EmulatorBridge: Bridge } = await import("@gba-kit/gba-browser");
    const emu = new Bridge();
    emulatorRef.current = emu;
    emu.setCallbacks({ onStateChange: setEmuState, onFrame: () => undefined, onBreakpoint: () => undefined });
    await new Promise(requestAnimationFrame);
    if (canvasRef.current) emu.attachCanvas(canvasRef.current);
    emu.loadRom(game.rom.slice(0));
    const battery = await dbGet<{ gameId: string; data: Uint8Array }>("battery", game.id);
    if (battery?.data) {
      try { emu.gba.bus.writeBackup(new Uint8Array(battery.data)); } catch { /* incompatible save is ignored */ }
    }
    emu.run();
    setStates((await dbAll<StoredState>("states")).filter(s => s.gameId === game.id).sort((a, b) => b.createdAt - a.createdAt));
  }

  async function returnToLibrary() {
    await persistBattery();
    emulatorRef.current?.pause();
    emulatorRef.current?.detachCanvas();
    setScreen("library");
    setPanel("none");
  }

  async function removeGame(game: Game) {
    if (!confirm(`Remove ${game.title} and its local ROM? Export any saves you want to keep first.`)) return;
    await dbDelete("games", game.id);
    await dbDelete("battery", game.id);
    const related = (await dbAll<StoredState>("states")).filter(s => s.gameId === game.id);
    await Promise.all(related.map(s => dbDelete("states", s.id)));
    setGames(prev => prev.filter(g => g.id !== game.id));
  }

  async function saveState() {
    const emu = emulatorRef.current;
    if (!emu || !activeGame) return;
    const wasRunning = emu.state === "running";
    emu.pause();
    const shot = await emu.saveState();
    const state: StoredState = { id: crypto.randomUUID(), gameId: activeGame.id, name: `Save ${states.length + 1}`, createdAt: Date.now(), snapshot: shot.snapshot, thumbnail: shot.thumbnail };
    await dbPut("states", state);
    setStates(prev => [state, ...prev]);
    if (wasRunning) emu.run();
    setNotice("Save state created.");
  }

  async function restoreState(state: StoredState) {
    emulatorRef.current?.loadState(state.snapshot);
    emulatorRef.current?.run();
    setPanel("none");
    setNotice(`Loaded ${state.name}.`);
  }

  async function deleteStateItem(id: string) {
    await dbDelete("states", id);
    setStates(prev => prev.filter(s => s.id !== id));
  }

  async function exportBattery() {
    const data = emulatorRef.current?.gba.bus.readBackup();
    if (!data || !activeGame) { setNotice("This game has not created cartridge save data yet."); return; }
    downloadBlob(new Blob([data as BlobPart]), `${activeGame.title}.sav`);
  }

  async function importBattery(file: File) {
    if (!activeGame || !emulatorRef.current) return;
    const data = new Uint8Array(await file.arrayBuffer());
    emulatorRef.current.gba.bus.writeBackup(data);
    await dbPut("battery", { gameId: activeGame.id, data, updatedAt: Date.now() });
    setNotice("Cartridge save imported.");
  }

  function togglePause() {
    const emu = emulatorRef.current;
    if (!emu) return;
    if (emu.state === "running") emu.pause(); else emu.run();
  }

  function toggleSound() {
    const emu = emulatorRef.current;
    if (!emu) return;
    const enabled = emu.toggleAudio();
    setSound(enabled);
  }

  function changeFilter(value: string) {
    setFilter(value);
    localStorage.setItem("pocketlane-filter", value);
  }

  function beginCapture(button: ButtonName) {
    const pad = navigator.getGamepads()[gamepadIndex];
    if (!pad) { setNotice("Press a button on your controller so Chrome can detect it first."); return; }
    captureRef.current = { button, baseline: pad.buttons.map(b => b.pressed ? 1 : 0), axes: [...pad.axes] };
    setCapture(button);
  }

  function finishCapture(button: ButtonName, bind: Bind) {
    captureRef.current = null;
    setCapture(null);
    setProfiles(prev => {
      const next = prev.map(p => p.id === profile.id ? { ...p, mapping: { ...p.mapping, [button]: bind } } : p);
      saveProfiles(next);
      return next;
    });
  }

  function addProfile() {
    const next: Profile = { id: crypto.randomUUID(), name: `Controller ${profiles.length + 1}`, mapping: { ...DEFAULT_PROFILE.mapping } };
    const updated = [...profiles, next];
    setProfiles(updated); saveProfiles(updated); setProfileId(next.id); localStorage.setItem("pocketlane-profile", next.id);
  }

  function updateProfileName(value: string) {
    const next = profiles.map(p => p.id === profile.id ? { ...p, name: value } : p);
    setProfiles(next); saveProfiles(next);
  }

  function deleteProfile() {
    if (profiles.length === 1) return;
    const next = profiles.filter(p => p.id !== profile.id);
    setProfiles(next); saveProfiles(next); setProfileId(next[0].id); localStorage.setItem("pocketlane-profile", next[0].id);
  }

  return (
    <main className="app-shell" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); importGames(e.dataTransfer.files); }}>
      <input ref={fileRef} hidden type="file" accept=".gba" multiple onChange={e => e.target.files && importGames(e.target.files)} />

      {screen === "library" ? (
        <div className="library-view">
          <header className="topbar">
            <button className="wordmark" aria-label="Pocketlane home"><span className="brand-dot" />POCKETLANE</button>
            <div className="privacy-pill"><span /> LOCAL ONLY</div>
          </header>

          <section className="library-head">
            <div>
              <p className="eyebrow">YOUR GAME BOY ADVANCE</p>
              <h1>Pick up where<br />you left off.</h1>
              <p className="lede">A private game library that lives in this browser. No account, no uploads, no fuss.</p>
            </div>
            <button className="add-button" onClick={() => fileRef.current?.click()}><span>＋</span> Add games</button>
          </section>

          {games.length ? (
            <section className="game-section">
              <div className="section-title"><h2>Your library</h2><span>{games.length} {games.length === 1 ? "game" : "games"}</span></div>
              <div className="game-grid">
                {games.map((game, index) => (
                  <article className="game-card" key={game.id} style={{ "--card-index": index } as React.CSSProperties}>
                    <button className="cover" onClick={() => playGame(game)} aria-label={`Play ${game.title}`}>
                      <span className="cover-lines" /><span className="cover-kicker">GAME BOY ADVANCE</span>
                      <strong>{game.title.slice(0, 18)}</strong><i>▶</i>
                    </button>
                    <div className="game-meta">
                      <div><h3>{game.title}</h3><p>{game.lastPlayed ? `Played ${relativeTime(game.lastPlayed)}` : `${formatBytes(game.size)} · Ready to play`}</p></div>
                      <div className="card-actions"><button onClick={() => playGame(game)}>Play</button><button className="more" onClick={() => removeGame(game)} aria-label={`Remove ${game.title}`}>•••</button></div>
                    </div>
                  </article>
                ))}
                <button className="drop-card" onClick={() => fileRef.current?.click()}><span>＋</span><strong>Add another game</strong><small>or drop a .gba file here</small></button>
              </div>
            </section>
          ) : (
            <button className="empty-library" onClick={() => fileRef.current?.click()}>
              <span className="empty-plus">＋</span><strong>Drop your first .gba file here</strong><small>or click to choose from your computer</small>
            </button>
          )}

          <footer><span>{notice}</span><span>ROMs and saves never leave your browser.</span></footer>
        </div>
      ) : (
        <div className="player-view" ref={shellRef}>
          <header className="player-bar">
            <button className="back-button" onClick={returnToLibrary}>← <span>Library</span></button>
            <div className="now-playing"><small>NOW PLAYING</small><strong>{activeGame?.title}</strong></div>
            <div className="player-actions">
              <button onClick={toggleSound} className={sound ? "active" : ""} aria-label="Toggle sound">{sound ? "♪" : "♩"}</button>
              <button onClick={() => shellRef.current?.requestFullscreen()} aria-label="Fullscreen">⛶</button>
              <button onClick={() => setPanel(panel === "controls" ? "none" : "controls")} className={panel === "controls" ? "active" : ""} aria-label="Controller settings">⌁</button>
            </div>
          </header>

          <section className="console-stage">
            <div className="console">
              <div className="console-top"><span>POWER <i className={emuState === "running" ? "on" : ""} /></span><b>POCKETLANE</b><span>GBA / 001</span></div>
              <div className={`display filter-${filter}`}><canvas ref={canvasRef} width="240" height="160" /></div>
              <div className="console-bottom">
                <span>{emuState === "running" ? "RUNNING" : "PAUSED"}</span>
                <div className="status-dots"><i /><i /><i /></div>
                <span>AUDIO {sound ? "ON" : "OFF"}</span>
              </div>
            </div>
          </section>

          <nav className="dock" aria-label="Emulator controls">
            <button onClick={togglePause}><span>{emuState === "running" ? "Ⅱ" : "▶"}</span><small>{emuState === "running" ? "Pause" : "Resume"}</small></button>
            <button onClick={saveState}><span>＋</span><small>Quick save</small></button>
            <button onClick={() => setPanel(panel === "states" ? "none" : "states")} className={panel === "states" ? "active" : ""}><span>↶</span><small>Save states</small></button>
            <div className="dock-divider" />
            <label><small>Display</small><select value={filter} onChange={e => changeFilter(e.target.value)}><option value="pixel">Pixel perfect</option><option value="smooth">Smooth</option><option value="lcd">LCD grid</option><option value="vivid">Vivid color</option></select></label>
          </nav>

          {panel === "states" && (
            <aside className="side-panel state-panel">
              <div className="panel-head"><div><small>THIS GAME</small><h2>Save states</h2></div><button onClick={() => setPanel("none")}>×</button></div>
              <button className="primary-wide" onClick={saveState}>＋ Create save state</button>
              <div className="save-list">
                {states.length === 0 && <p className="empty-copy">No save states yet. Create one to return to an exact moment.</p>}
                {states.map(state => <div className="save-row" key={state.id}>
                  <button className="save-thumb" onClick={() => restoreState(state)}>{state.thumbnail ? <img src={URL.createObjectURL(state.thumbnail)} alt="" /> : "▶"}</button>
                  <div>{renaming === state.id ? <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onBlur={async () => { const updated = { ...state, name: newName || state.name }; await dbPut("states", updated); setStates(prev => prev.map(s => s.id === state.id ? updated : s)); setRenaming(null); }} /> : <strong>{state.name}</strong>}<small>{new Date(state.createdAt).toLocaleString()}</small></div>
                  <button onClick={() => { setRenaming(state.id); setNewName(state.name); }} aria-label="Rename">✎</button><button onClick={() => deleteStateItem(state.id)} aria-label="Delete">×</button>
                </div>)}
              </div>
              <div className="save-tools"><button onClick={exportBattery}>Export .sav</button><label>Import .sav<input hidden type="file" accept=".sav" onChange={e => e.target.files?.[0] && importBattery(e.target.files[0])} /></label></div>
            </aside>
          )}

          {panel === "controls" && (
            <aside className="side-panel controls-panel">
              <div className="panel-head"><div><small>INPUT</small><h2>Controller</h2></div><button onClick={() => setPanel("none")}>×</button></div>
              <label className="field"><span>Connected device</span><select value={gamepadIndex} onChange={e => setGamepadIndex(Number(e.target.value))}>{gamepads.length ? gamepads.map(p => <option key={p.index} value={p.index}>{p.id.slice(0, 42)}</option>) : <option>No controller detected</option>}</select></label>
              <div className="profile-line"><label className="field"><span>Mapping profile</span><select value={profileId} onChange={e => { setProfileId(e.target.value); localStorage.setItem("pocketlane-profile", e.target.value); }}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button onClick={addProfile}>＋</button></div>
              <label className="field"><span>Profile name</span><input value={profile?.name || ""} onChange={e => updateProfileName(e.target.value)} /></label>
              <p className="mapping-help">Select an action, then press the button you want to use.</p>
              <div className="mapping-grid">{BUTTONS.map(button => <button className={capture === button ? "listening" : ""} key={button} onClick={() => beginCapture(button)}><strong>{button}</strong><span>{capture === button ? "Press a button…" : bindLabel(profile?.mapping[button])}</span></button>)}</div>
              <button className="delete-profile" disabled={profiles.length === 1} onClick={deleteProfile}>Delete this profile</button>
              <p className="keyboard-note">Keyboard: arrows · Z = A · X = B · Enter = Start · Backspace = Select · A/S = R/L</p>
            </aside>
          )}
        </div>
      )}
    </main>
  );
}

function localStorageSafe(key: string) {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) || "";
}

function loadProfiles(): Profile[] {
  if (typeof window === "undefined") return [DEFAULT_PROFILE];
  try { return JSON.parse(localStorage.getItem("pocketlane-profiles") || "null") || [DEFAULT_PROFILE]; } catch { return [DEFAULT_PROFILE]; }
}

function saveProfiles(profiles: Profile[]) { localStorage.setItem("pocketlane-profiles", JSON.stringify(profiles)); }

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

function relativeTime(time: number) {
  const days = Math.floor((Date.now() - time) / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(time).toLocaleDateString();
}
