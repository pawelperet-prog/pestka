import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

// ─── BLE UUIDs ─────────────────────────────────────────────────────────────
export const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const TX_UUID      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const RX_UUID      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export type BleUuidConfig = { preset: string; serviceUuid: string; txUuid: string; rxUuid: string };

export const XENSE_BLE_CONFIG: BleUuidConfig = {
  preset: "xense", serviceUuid: SERVICE_UUID, txUuid: TX_UUID, rxUuid: RX_UUID,
};
export const BLE_CONFIG_KEY = "pestka_ble_uuid_config";
export const BLE_PRESETS = [
  { id: "xense", label: "Pestka Xense / NimBLE UART (domyślny)", config: XENSE_BLE_CONFIG },
] as const;

const AUTO_DISCONNECT_MS = 30 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBT = any;

export function loadBleConfig(): BleUuidConfig {
  try {
    const raw = localStorage.getItem(BLE_CONFIG_KEY);
    if (!raw) return XENSE_BLE_CONFIG;
    const p = JSON.parse(raw) as Partial<BleUuidConfig>;
    if (!p.serviceUuid || !p.txUuid || !p.rxUuid) return XENSE_BLE_CONFIG;
    return { preset: p.preset ?? "custom", serviceUuid: p.serviceUuid.trim().toLowerCase(), txUuid: p.txUuid.trim().toLowerCase(), rxUuid: p.rxUuid.trim().toLowerCase() };
  } catch { return XENSE_BLE_CONFIG; }
}

export function saveBleConfig(c: BleUuidConfig) {
  try { localStorage.setItem(BLE_CONFIG_KEY, JSON.stringify(c)); } catch { /**/ }
}

// ─── STATE TYPES ────────────────────────────────────────────────────────────
export type BleState = {
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  battery: number | null;
  countdownMs: number;
  spacerOn: boolean;
  escapedAlarm: boolean;
  logs: string[];
  // connectDevice is called AFTER requestDevice succeeds in the component
  connectDevice: (device: AnyBT) => Promise<void>;
  setConnectingState: (v: boolean) => void;
  addLog: (msg: string) => void;
  sleepCollar: () => void;
  testCorrection: () => void;
  setSpacer: (on: boolean) => void;
  dismissAlarm: () => void;
};

const Ctx = createContext<BleState | null>(null);

export function BleProvider({ children }: { children: ReactNode }) {
  const [supported,    setSupported]    = useState(false);
  const [connected,    setConnected]    = useState(false);
  const [connecting,   setConnecting]   = useState(false);
  const [deviceName,   setDeviceName]   = useState<string | null>(null);
  const [battery,      setBattery]      = useState<number | null>(null);
  const [countdownMs,  setCountdownMs]  = useState(0);
  const [spacerOn,     setSpacerOn]     = useState(false);
  const [escapedAlarm, setEscapedAlarm] = useState(false);
  const [logs,         setLogs]         = useState<string[]>(["Czekam na akcję..."]);

  const deviceRef  = useRef<AnyBT>(null);
  const txRef      = useRef<AnyBT>(null);
  const discTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const spacerRef  = useRef(false);

  const addLog = useCallback((msg: string) => {
    console.log("[BLE]", msg);
    setLogs(p => [`${new Date().toLocaleTimeString()} ${msg}`, ...p.slice(0, 49)]);
  }, []);

  useEffect(() => {
    const hasBle = typeof navigator !== "undefined" && !!(navigator as AnyBT).bluetooth;
    setSupported(hasBle);
    addLog(`Web Bluetooth: ${hasBle ? "✅ dostępny" : "❌ niedostępny"} | ${navigator.userAgent.slice(0, 60)}`);
  }, [addLog]);

  const clearTimers = () => {
    if (discTimer.current)  { clearTimeout(discTimer.current);   discTimer.current  = null; }
    if (countTimer.current) { clearInterval(countTimer.current); countTimer.current = null; }
  };

  const handleDisconnect = useCallback(() => {
    setConnected(false); setDeviceName(null); setBattery(null); setCountdownMs(0);
    clearTimers(); txRef.current = null;
    addLog("🔴 Rozłączono");
    if (spacerRef.current) setEscapedAlarm(true);
    else toast("Rozłączono z obrożą");
  }, [addLog]);

  const startCountdown = useCallback(() => {
    clearTimers();
    const end = Date.now() + AUTO_DISCONNECT_MS;
    setCountdownMs(AUTO_DISCONNECT_MS);
    countTimer.current = setInterval(() => {
      const r = Math.max(0, end - Date.now());
      setCountdownMs(r);
      if (r <= 0 && countTimer.current) clearInterval(countTimer.current);
    }, 1000);
    discTimer.current = setTimeout(() => {
      try { deviceRef.current?.gatt?.disconnect(); } catch { /**/ }
    }, AUTO_DISCONNECT_MS);
  }, []);

  const onNotify = useCallback((e: Event) => {
    try {
      const view = (e.target as AnyBT).value as DataView;
      const txt  = new TextDecoder().decode(view.buffer);
      const m    = txt.match(/(\d+\.\d{1,3})/);
      if (m) { const v = parseFloat(m[1]); if (v > 1 && v < 6) setBattery(v); }
    } catch { /**/ }
  }, []);

  // Called from Dashboard AFTER requestDevice returns a device
  const connectDevice = useCallback(async (device: AnyBT) => {
    const cfg = loadBleConfig();
    addLog(`✅ Urządzenie: "${device.name}". Łączę GATT...`);
    deviceRef.current = device;
    device.addEventListener("gattserverdisconnected", handleDisconnect);

    try {
      const server = await device.gatt.connect();
      addLog("✅ GATT połączony. Szukam usługi UART...");

      const service = await server.getPrimaryService(cfg.serviceUuid);
      const tx = await service.getCharacteristic(cfg.txUuid);
      txRef.current = tx;
      addLog("✅ Charakterystyka zapisu gotowa.");

      try {
        const rx = await service.getCharacteristic(cfg.rxUuid);
        await rx.startNotifications();
        rx.addEventListener("characteristicvaluechanged", onNotify);
        addLog("✅ Telemetria aktywna.");
      } catch { addLog("ℹ️ Telemetria niedostępna (opcjonalne)."); }

      setConnected(true);
      setDeviceName(device.name ?? "Obroża Pestka");
      setEscapedAlarm(false);
      startCountdown();
      addLog(`🎉 Połączono z "${device.name ?? "Obroża"}"!`);
      toast.success(`Połączono: ${device.name ?? "Obroża Pestka"}`);
    } catch (err: AnyBT) {
      const msg = err?.message ?? String(err);
      addLog(`❌ GATT błąd: ${msg}`);
      toast.error(`Błąd połączenia: ${msg}`, { duration: 8000 });
    }
  }, [addLog, handleDisconnect, onNotify, startCountdown]);

  const writeBytes = useCallback(async (bytes: number[]): Promise<boolean> => {
    const tx = txRef.current;
    if (!tx) { toast.error("Nie połączono z obrożą"); return false; }
    try {
      const data = new Uint8Array(bytes);
      if (typeof tx.writeValueWithoutResponse === "function") await tx.writeValueWithoutResponse(data);
      else await tx.writeValue(data);
      return true;
    } catch (e) {
      toast.error(`Błąd wysyłania: ${(e as Error)?.message}`);
      return false;
    }
  }, []);

  const sleepCollar = useCallback(() => {
    writeBytes([0x21]).then(ok => {
      if (ok) { addLog("Uśpienie (0x21)"); toast("💤 Obroża uśpiona"); try { deviceRef.current?.gatt?.disconnect(); } catch { /**/ } }
    });
  }, [addLog, writeBytes]);

  const testCorrection = useCallback(() => {
    writeBytes([0x24]).then(ok => { if (ok) { addLog("Test korekty (0x24)"); toast.success("⚡ Test korekty wysłany"); } });
  }, [addLog, writeBytes]);

  const setSpacer = useCallback((on: boolean) => {
    writeBytes([0x20, on ? 1 : 0]).then(ok => {
      if (ok) {
        spacerRef.current = on;
        setSpacerOn(on);
        if (!on) setEscapedAlarm(false);
        addLog(`Spacer: ${on ? "ON" : "OFF"}`);
        toast(on ? "🚶 Tryb spaceru włączony" : "Tryb spaceru wyłączony");
      }
    });
  }, [addLog, writeBytes]);

  const dismissAlarm = useCallback(() => setEscapedAlarm(false), []);

  useEffect(() => () => clearTimers(), []);

  return (
    <Ctx.Provider value={{
      supported, connected, connecting, deviceName, battery, countdownMs,
      spacerOn, escapedAlarm, logs,
      connectDevice,
      setConnectingState: setConnecting,
      addLog,
      sleepCollar, testCorrection, setSpacer, dismissAlarm,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBle(): BleState {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback — never reaches here if BleProvider wraps app correctly
    const noop = () => {};
    return {
      supported: false, connected: false, connecting: false,
      deviceName: null, battery: null, countdownMs: 0,
      spacerOn: false, escapedAlarm: false,
      logs: ["[BŁĄD: BleProvider nie załadowany]"],
      connectDevice: async () => {}, setConnectingState: noop, addLog: noop,
      sleepCollar: noop, testCorrection: noop, setSpacer: noop, dismissAlarm: noop,
    };
  }
  return ctx;
}

export function formatCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
