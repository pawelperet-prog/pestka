import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

// ─── BLE UUIDs (from ESP32 firmware) ────────────────────────────────────────
export const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const TX_UUID      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // app writes here
export const RX_UUID      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // collar notifies here

export type BleUuidConfig = { preset: string; serviceUuid: string; txUuid: string; rxUuid: string };
export const XENSE_BLE_CONFIG: BleUuidConfig = { preset: "xense", serviceUuid: SERVICE_UUID, txUuid: TX_UUID, rxUuid: RX_UUID };
export const NORDIC_UART_BLE_CONFIG: BleUuidConfig = { preset: "nordic-uart", serviceUuid: SERVICE_UUID, txUuid: TX_UUID, rxUuid: RX_UUID };
export const BLE_PRESETS = [
  { id: "xense", label: "Pestka Xense / NimBLE UART (6E40...)", config: XENSE_BLE_CONFIG },
  { id: "nordic-uart", label: "Nordic UART Service", config: NORDIC_UART_BLE_CONFIG },
] as const;
export const BLE_CONFIG_KEY = "pestka_ble_uuid_config";

const AUTO_DISCONNECT_MS = 30 * 60 * 1000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBT = any;

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
  browserInfo: string;
  connect: () => void;        // NOTE: plain void, NOT async — must be called synchronously
  sleepCollar: () => void;
  testCorrection: () => void;
  setSpacer: (on: boolean) => void;
  dismissAlarm: () => void;
};

const Ctx = createContext<BleState | null>(null);

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
  try { localStorage.setItem(BLE_CONFIG_KEY, JSON.stringify({ preset: c.preset, serviceUuid: c.serviceUuid.trim().toLowerCase(), txUuid: c.txUuid.trim().toLowerCase(), rxUuid: c.rxUuid.trim().toLowerCase() })); } catch { /* noop */ }
}

export function BleProvider({ children }: { children: ReactNode }) {
  const [supported,     setSupported]     = useState(false);
  const [browserInfo,   setBrowserInfo]   = useState("");
  const [connected,     setConnected]     = useState(false);
  const [connecting,    setConnecting]    = useState(false);
  const [deviceName,    setDeviceName]    = useState<string | null>(null);
  const [battery,       setBattery]       = useState<number | null>(null);
  const [countdownMs,   setCountdownMs]   = useState(0);
  const [spacerOn,      setSpacerOn]      = useState(false);
  const [escapedAlarm,  setEscapedAlarm]  = useState(false);
  const [logs,          setLogs]          = useState<string[]>(["Czekam na akcję..."]);

  const deviceRef  = useRef<AnyBT>(null);
  const txRef      = useRef<AnyBT>(null);
  const discTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const spacerRef  = useRef(false);

  const log = useCallback((msg: string) => {
    console.log("[BLE]", msg);
    setLogs(p => [`${new Date().toLocaleTimeString()} ${msg}`, ...p.slice(0, 49)]);
  }, []);

  useEffect(() => {
    const hasBle = typeof navigator !== "undefined" && !!(navigator as AnyBT).bluetooth;
    setSupported(hasBle);
    const ua = navigator?.userAgent ?? "";
    const name = ua.includes("Bluefy") ? "Bluefy"
      : ua.includes("Edg/") ? "Edge"
      : ua.includes("Chrome/") ? "Chrome"
      : ua.includes("Firefox/") ? "Firefox"
      : ua.includes("Safari/") && !ua.includes("Chrome") ? "Safari"
      : "Przeglądarka";
    setBrowserInfo(`${name} | BLE: ${hasBle ? "✅ Dostępny" : "❌ Niedostępny"}`);
    log(`Init: ${name}, Web Bluetooth: ${hasBle ? "TAK" : "NIE"}`);
  }, [log]);

  const clearTimers = () => {
    if (discTimer.current)  { clearTimeout(discTimer.current);   discTimer.current  = null; }
    if (countTimer.current) { clearInterval(countTimer.current); countTimer.current = null; }
  };

  const handleDisconnect = useCallback(() => {
    setConnected(false); setDeviceName(null); setBattery(null); setCountdownMs(0);
    clearTimers(); txRef.current = null;
    log("🔴 Rozłączono");
    if (spacerRef.current) setEscapedAlarm(true);
    else toast("Rozłączono z obrożą");
  }, [log]);

  const startCountdown = useCallback(() => {
    clearTimers();
    const end = Date.now() + AUTO_DISCONNECT_MS;
    setCountdownMs(AUTO_DISCONNECT_MS);
    countTimer.current = setInterval(() => {
      const r = Math.max(0, end - Date.now());
      setCountdownMs(r);
      if (r <= 0 && countTimer.current) clearInterval(countTimer.current);
    }, 1000);
    discTimer.current = setTimeout(() => { try { deviceRef.current?.gatt?.disconnect(); } catch { /**/ } }, AUTO_DISCONNECT_MS);
  }, []);

  const onNotify = useCallback((e: Event) => {
    try {
      const view = (e.target as AnyBT).value as DataView;
      const txt  = new TextDecoder().decode(view.buffer);
      const m    = txt.match(/(\d+\.\d{1,3})/);
      if (m) { const v = parseFloat(m[1]); if (v > 1 && v < 6) setBattery(v); }
    } catch { /**/ }
  }, []);

  // ─── CONNECT ─────────────────────────────────────────────────────────────
  // CRITICAL: requestDevice MUST be the first async call inside a click handler.
  // Any setState / await before requestDevice breaks the "user gesture" on iOS (Bluefy).
  const connect = useCallback(() => {
    const bt = (navigator as AnyBT)?.bluetooth;
    if (!bt) {
      log("❌ navigator.bluetooth niedostępny");
      alert("Web Bluetooth niedostępny!\n\nWindows → otwórz w Google Chrome lub Microsoft Edge.\niPhone → otwórz w aplikacji Bluefy (App Store).");
      return;
    }

    const cfg = loadBleConfig();
    const svc = cfg.serviceUuid;
    const txc = cfg.txUuid;
    const rxc = cfg.rxUuid;

    log("🔵 Otwieram okno wyboru BLE...");
    setConnecting(true);

    // First try with service filter (required on iOS CoreBluetooth)
    bt.requestDevice({
      filters: [
        { services: [svc] },
        { namePrefix: "PESTKA" },
        { namePrefix: "Pestka" },
        { namePrefix: "pestka" },
      ],
      optionalServices: [svc, "battery_service", "device_information"],
    })
    .catch((filterErr: AnyBT) => {
      // If user cancelled → rethrow
      if (filterErr?.name === "NotFoundError" || filterErr?.message?.includes("cancel")) throw filterErr;
      // Otherwise try acceptAllDevices (desktop Chrome/Edge)
      log(`ℹ️ Filter failed (${filterErr?.message}), trying acceptAllDevices...`);
      return bt.requestDevice({ acceptAllDevices: true, optionalServices: [svc, "battery_service", "device_information"] });
    })
    .then(async (device: AnyBT) => {
      log(`✅ Wybrano: "${device.name || "Nieznane"}"`);
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", handleDisconnect);

      log("🔵 Łączę GATT...");
      const server = await device.gatt.connect();
      log("✅ GATT połączony. Pobieram usługę...");

      const service = await server.getPrimaryService(svc);
      log("✅ Usługa UART znaleziona. Pobieram charakterystyki...");

      const tx = await service.getCharacteristic(txc);
      txRef.current = tx;
      log("✅ TX (write) gotowy.");

      try {
        const rx = await service.getCharacteristic(rxc);
        await rx.startNotifications();
        rx.addEventListener("characteristicvaluechanged", onNotify);
        log("✅ RX (notify) aktywny.");
      } catch (rxErr: AnyBT) {
        log(`ℹ️ RX opcjonalny pominięty: ${rxErr?.message}`);
      }

      setConnected(true);
      setDeviceName(device.name ?? "Obroża Pestka");
      setEscapedAlarm(false);
      startCountdown();
      log(`🎉 Połączono z "${device.name ?? "Obroża Pestka"}"!`);
      toast.success(`Połączono: ${device.name ?? "Obroża Pestka"}`);
    })
    .catch((err: AnyBT) => {
      if (err?.name === "NotFoundError" || err?.message?.includes("cancel") || err?.message?.includes("User cancelled")) {
        log("ℹ️ Anulowano wybór urządzenia.");
      } else {
        const msg = err?.message ?? String(err);
        log(`❌ Błąd: ${msg}`);
        toast.error(`Błąd BLE: ${msg}`, { duration: 8000 });
      }
    })
    .finally(() => setConnecting(false));
  }, [handleDisconnect, log, onNotify, startCountdown]);

  // ─── WRITE ────────────────────────────────────────────────────────────────
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
      if (ok) { log("Wysłano uśpienie (0x21)"); toast("💤 Obroża uśpiona"); try { deviceRef.current?.gatt?.disconnect(); } catch { /**/ } }
    });
  }, [log, writeBytes]);

  const testCorrection = useCallback(() => {
    writeBytes([0x24]).then(ok => { if (ok) { log("Wysłano test korekty (0x24)"); toast.success("⚡ Test korekty wysłany"); } });
  }, [log, writeBytes]);

  const setSpacer = useCallback((on: boolean) => {
    writeBytes([0x20, on ? 1 : 0]).then(ok => {
      if (ok) {
        spacerRef.current = on;
        setSpacerOn(on);
        if (!on) setEscapedAlarm(false);
        log(`Spacer: ${on ? "ON" : "OFF"}`);
        toast(on ? "🚶 Tryb spaceru włączony" : "Tryb spaceru wyłączony");
      }
    });
  }, [log, writeBytes]);

  const dismissAlarm = useCallback(() => setEscapedAlarm(false), []);

  useEffect(() => () => clearTimers(), []);

  return (
    <Ctx.Provider value={{
      supported, connected, connecting, deviceName, battery, countdownMs,
      spacerOn, escapedAlarm, logs, browserInfo,
      connect, sleepCollar, testCorrection, setSpacer, dismissAlarm,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useBle(): BleState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBle must be used within BleProvider");
  return ctx;
}

export function formatCountdown(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
