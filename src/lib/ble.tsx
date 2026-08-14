import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

export const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const TX_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const RX_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export type BleUuidConfig = {
  preset: string;
  serviceUuid: string;
  txUuid: string;
  rxUuid: string;
};

export const XENSE_BLE_CONFIG: BleUuidConfig = {
  preset: "xense",
  serviceUuid: SERVICE_UUID,
  txUuid: TX_UUID,
  rxUuid: RX_UUID,
};

export const NORDIC_UART_BLE_CONFIG: BleUuidConfig = {
  preset: "nordic-uart",
  serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  txUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  rxUuid: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
};

export const BLE_PRESETS = [
  { id: "xense", label: "Pestka Xense / ESP32 custom (6E40...)", config: XENSE_BLE_CONFIG },
  { id: "nordic-uart", label: "Nordic UART / ESP32 BLE UART", config: NORDIC_UART_BLE_CONFIG },
] as const;

export const BLE_CONFIG_KEY = "pestka_ble_uuid_config";

const AUTO_DISCONNECT_MS = 30 * 60 * 1000;

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
  connect: () => Promise<void>;
  sleepCollar: () => Promise<void>;
  testCorrection: () => Promise<void>;
  setSpacer: (on: boolean) => Promise<void>;
  dismissAlarm: () => void;
};

const Ctx = createContext<BleState | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBT = any;

const normalizeUuid = (value: string) => value.trim().toLowerCase();

export function loadBleConfig(): BleUuidConfig {
  if (typeof localStorage === "undefined") return XENSE_BLE_CONFIG;
  try {
    const raw = localStorage.getItem(BLE_CONFIG_KEY);
    if (!raw) return XENSE_BLE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<BleUuidConfig>;
    if (!parsed.serviceUuid || !parsed.txUuid || !parsed.rxUuid) return XENSE_BLE_CONFIG;
    return {
      preset: parsed.preset ?? "custom",
      serviceUuid: normalizeUuid(parsed.serviceUuid),
      txUuid: normalizeUuid(parsed.txUuid),
      rxUuid: normalizeUuid(parsed.rxUuid),
    };
  } catch {
    return XENSE_BLE_CONFIG;
  }
}

export function saveBleConfig(config: BleUuidConfig) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    BLE_CONFIG_KEY,
    JSON.stringify({
      preset: config.preset,
      serviceUuid: normalizeUuid(config.serviceUuid),
      txUuid: normalizeUuid(config.txUuid),
      rxUuid: normalizeUuid(config.rxUuid),
    }),
  );
}

export function BleProvider({ children }: { children: ReactNode }) {
  const [supported, setSupported] = useState(true);
  const [browserInfo, setBrowserInfo] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const [spacerOn, setSpacerOn] = useState(false);
  const [escapedAlarm, setEscapedAlarm] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const deviceRef = useRef<AnyBT>(null);
  const txRef = useRef<AnyBT>(null);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const spacerRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    console.log(`[Pestka BLE] ${msg}`);
    setLogs((prev) => [`${new Date().toLocaleTimeString()} - ${msg}`, ...prev.slice(0, 29)]);
  }, []);

  useEffect(() => {
    const isBt = typeof navigator !== "undefined" && !!(navigator as AnyBT)?.bluetooth;
    setSupported(isBt);
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    let bName = "Nieznana";
    if (ua.includes("Edg/")) bName = "Microsoft Edge";
    else if (ua.includes("Chrome/")) bName = "Google Chrome";
    else if (ua.includes("Firefox/")) bName = "Mozilla Firefox (brak Web Bluetooth)";
    else if (ua.includes("Safari/") && !ua.includes("Chrome")) bName = "Safari (brak Web Bluetooth)";
    else if (ua.includes("Bluefy")) bName = "Bluefy (iOS BLE)";
    
    setBrowserInfo(`${bName} · Web Bluetooth: ${isBt ? "Dostępny ✅" : "Niedostępny ❌"}`);
    addLog(`Inicjalizacja: ${bName} (Web Bluetooth: ${isBt ? "TAK" : "NIE"})`);
  }, [addLog]);

  const clearTimers = () => {
    if (disconnectTimer.current) clearTimeout(disconnectTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    disconnectTimer.current = null;
    countdownTimer.current = null;
  };

  const handleDisconnected = useCallback(() => {
    setConnected(false);
    setDeviceName(null);
    setBattery(null);
    setCountdownMs(0);
    clearTimers();
    txRef.current = null;
    addLog("Rozłączono z urządzeniem.");
    if (spacerRef.current) {
      setEscapedAlarm(true);
    } else {
      toast("Rozłączono z obrożą");
    }
  }, [addLog]);

  const startAutoDisconnect = useCallback(() => {
    clearTimers();
    const endsAt = Date.now() + AUTO_DISCONNECT_MS;
    setCountdownMs(AUTO_DISCONNECT_MS);
    countdownTimer.current = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now());
      setCountdownMs(remaining);
      if (remaining <= 0 && countdownTimer.current) clearInterval(countdownTimer.current);
    }, 1000);
    disconnectTimer.current = setTimeout(() => {
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        // ignore
      }
    }, AUTO_DISCONNECT_MS);
  }, []);

  const onNotify = (e: Event) => {
    const target = e.target as AnyBT;
    const value: DataView = target.value;
    try {
      const text = new TextDecoder().decode(value.buffer);
      const m = text.match(/(\d+\.\d{1,3})/);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 1 && v < 6) setBattery(v);
      }
    } catch {
      // ignore
    }
  };

  const connect = useCallback(async () => {
    const bt = typeof navigator !== "undefined" ? (navigator as AnyBT)?.bluetooth : null;
    if (!bt) {
      const msg = "Przeglądarka NIE obsługuje Web Bluetooth! Na Windows otwórz stronę w Google Chrome lub Microsoft Edge. Na iPhone pobierz darmowe Bluefy z App Store.";
      addLog(`❌ BŁĄD: ${msg}`);
      alert(msg);
      return;
    }

    addLog("🟡 Otwieranie systemowego okna wyboru Bluetooth...");
    setConnecting(true);

    try {
      // Direct requestDevice call
      const device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
          "battery_service",
          "device_information",
        ],
      });

      addLog(`✅ Wybrano urządzenie: "${device.name || "Nieznane"}". Łączenie z GATT...`);
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", handleDisconnected);

      const server = await device.gatt.connect();
      addLog("✅ Połączono z GATT. Pobieranie usługi UART (6E400001...)...");

      const service = await server.getPrimaryService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
      const tx = await service.getCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e");
      txRef.current = tx;
      addLog("✅ Znaleziono charakterystykę zapisu (RX/TX).");

      try {
        const rx = await service.getCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e");
        await rx.startNotifications();
        rx.addEventListener("characteristicvaluechanged", onNotify);
        addLog("✅ Włączono powiadomienia telemetryczne.");
      } catch (e) {
        addLog("ℹ️ Powiadomienia opcjonalne pominięte.");
      }

      setConnected(true);
      setDeviceName(device.name ?? "Obroża Pestka");
      setEscapedAlarm(false);
      startAutoDisconnect();
      addLog(`🎉 SUKCES! Połączono pomyślnie z "${device.name ?? "Obroża Pestka"}"!`);
      toast.success(`Połączono: ${device.name ?? "Obroża Pestka"}`);
    } catch (err: any) {
      if (err?.name === "NotFoundError" || err?.message?.includes("cancelled") || err?.message?.includes("canceled")) {
        addLog("ℹ️ Użytkownik zamknął okno wyboru.");
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        addLog(`❌ BŁĄD POŁĄCZENIA: ${errMsg}`);
        toast.error(`Błąd: ${errMsg}`, { duration: 8000 });
      }
    } finally {
      setConnecting(false);
    }
  }, [addLog, handleDisconnected, startAutoDisconnect]);

  const writeBytes = useCallback(async (bytes: number[]) => {
    const tx = txRef.current;
    if (!tx) {
      toast.error("Brak połączenia z obrożą");
      return false;
    }
    try {
      if (typeof tx.writeValueWithoutResponse === "function") {
        await tx.writeValueWithoutResponse(new Uint8Array(bytes));
      } else {
        await tx.writeValue(new Uint8Array(bytes));
      }
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Błąd wysyłania";
      toast.error(msg);
      return false;
    }
  }, []);

  const sleepCollar = useCallback(async () => {
    const ok = await writeBytes([0x21]);
    if (ok) {
      addLog("Wysłano uśpienie obroży (0x21)");
      toast("💤 Obroża uśpiona");
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        // ignore
      }
    }
  }, [addLog, writeBytes]);

  const testCorrection = useCallback(async () => {
    const ok = await writeBytes([0x24]);
    if (ok) {
      addLog("Wysłano test korekty buzzerem (0x24)");
      toast.success("⚡ Test korekty wysłany");
    }
  }, [addLog, writeBytes]);

  const setSpacer = useCallback(
    async (on: boolean) => {
      const ok = await writeBytes([0x20, on ? 1 : 0]);
      if (ok) {
        spacerRef.current = on;
        setSpacerOn(on);
        if (!on) setEscapedAlarm(false);
        addLog(`Tryb spaceru: ${on ? "WŁĄCZONY" : "WYŁĄCZONY"}`);
        toast(on ? "🚶 Tryb spaceru włączony" : "Tryb spaceru wyłączony");
      }
    },
    [addLog, writeBytes],
  );

  const dismissAlarm = () => setEscapedAlarm(false);

  useEffect(() => () => clearTimers(), []);

  const value: BleState = {
    supported,
    connected,
    connecting,
    deviceName,
    battery,
    countdownMs,
    spacerOn,
    escapedAlarm,
    logs,
    browserInfo,
    connect,
    sleepCollar,
    testCorrection,
    setSpacer,
    dismissAlarm,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBle(): BleState {
  const v = useContext(Ctx);
  if (!v) {
    return {
      supported: typeof navigator !== "undefined" && !!(navigator as AnyBT)?.bluetooth,
      connected: false,
      connecting: false,
      deviceName: null,
      battery: null,
      countdownMs: 0,
      spacerOn: false,
      escapedAlarm: false,
      logs: [],
      browserInfo: "",
      connect: async () => {},
      sleepCollar: async () => {},
      testCorrection: async () => {},
      setSpacer: async () => {},
      dismissAlarm: () => {},
    };
  }
  return v;
}

export function formatCountdown(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
