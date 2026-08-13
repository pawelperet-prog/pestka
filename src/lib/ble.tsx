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
  { id: "xense", label: "Pestka Xense / ESP32 custom", config: XENSE_BLE_CONFIG },
  { id: "nordic-uart", label: "Nordic UART / ESP32 BLE UART", config: NORDIC_UART_BLE_CONFIG },
] as const;

export const BLE_CONFIG_KEY = "pestka_ble_uuid_config";

const AUTO_DISCONNECT_MS = 30 * 60 * 1000;

type BleState = {
  supported: boolean;
  connected: boolean;
  connecting: boolean;
  deviceName: string | null;
  battery: number | null;
  countdownMs: number;
  spacerOn: boolean;
  escapedAlarm: boolean;
  connect: (showAll?: boolean) => Promise<void>;
  sleepCollar: () => Promise<void>;
  testCorrection: () => Promise<void>;
  setSpacer: (on: boolean) => Promise<void>;
  dismissAlarm: () => void;
};

const Ctx = createContext<BleState | null>(null);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBT = any;

const normalizeUuid = (value: string) => value.trim().toLowerCase();

const uniqueConfigs = (configs: BleUuidConfig[]) => {
  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = `${normalizeUuid(config.serviceUuid)}:${normalizeUuid(config.txUuid)}:${normalizeUuid(config.rxUuid)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [countdownMs, setCountdownMs] = useState(0);
  const [spacerOn, setSpacerOn] = useState(false);
  const [escapedAlarm, setEscapedAlarm] = useState(false);

  const deviceRef = useRef<AnyBT>(null);
  const txRef = useRef<AnyBT>(null);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const spacerRef = useRef(false);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && !!(navigator as AnyBT).bluetooth);
  }, []);

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
    if (spacerRef.current) {
      setEscapedAlarm(true);
    } else {
      toast("Rozłączono z obrożą");
    }
  }, []);

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
    // Try parse: if starts with "B:" voltage e.g. "B:3.87" or first byte command code
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

  const connect = useCallback(async (showAll = false) => {
    const bt = (navigator as AnyBT).bluetooth;
    if (!bt) {
      toast.error("Web Bluetooth nie jest wspierany w standardowym Safari. Na iOS (iPhone) otwórz ten adres w darmowej przeglądarce 'Bluefy' lub 'WebBLE' z App Store!", { duration: 7000 });
      return;
    }
    if (typeof window !== "undefined" && window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
      toast.error("BLE wymaga HTTPS. Otwórz aplikację przez https://");
      return;
    }
    setConnecting(true);
    try {
      const savedConfig = loadBleConfig();
      const knownConfigs = uniqueConfigs([savedConfig, XENSE_BLE_CONFIG, NORDIC_UART_BLE_CONFIG]);
      const optionalServices = Array.from(
        new Set([...knownConfigs.map((config) => normalizeUuid(config.serviceUuid)), "battery_service", "device_information"]),
      );
      const options: AnyBT = showAll
        ? { acceptAllDevices: true, optionalServices }
        : {
            filters: [
              { namePrefix: "Pestka" },
              { namePrefix: "Xense" },
              { namePrefix: "PESTKA" },
              ...knownConfigs.map((config) => ({ services: [normalizeUuid(config.serviceUuid)] })),
            ],
            optionalServices,
          };
      const device = await bt.requestDevice(options);
      deviceRef.current = device;
      device.addEventListener("gattserverdisconnected", handleDisconnected);
      const server = await device.gatt.connect();
      let connectedConfig: BleUuidConfig | null = null;
      let lastError: unknown = null;

      for (const config of knownConfigs) {
        try {
          const service = await server.getPrimaryService(normalizeUuid(config.serviceUuid));
          const tx = await service.getCharacteristic(normalizeUuid(config.txUuid));
          txRef.current = tx;
          connectedConfig = config;
          try {
            const rx = await service.getCharacteristic(normalizeUuid(config.rxUuid));
            await rx.startNotifications();
            rx.addEventListener("characteristicvaluechanged", onNotify);
          } catch {
            // RX optional
          }
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!connectedConfig) {
        try {
          device.gatt?.disconnect();
        } catch {
          // ignore
        }
        console.info("Pestka BLE service discovery failed", {
          deviceName: device.name,
          triedServices: knownConfigs.map((config) => config.serviceUuid),
          lastError,
        });
        throw new Error(
          `Wybrane urządzenie nie ma usługi Pestka Xense. Sprawdź, czy to obroża, albo ustaw właściwy BLE UUID w Ustawieniach → Bluetooth. Próbowano: ${knownConfigs
            .map((config) => config.serviceUuid)
            .join(", ")}`,
        );
      }

      setConnected(true);
      setDeviceName(device.name ?? "Obroża");
      setEscapedAlarm(false);
      startAutoDisconnect();
      toast.success(`Połączono: ${device.name ?? "Obroża"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Błąd połączenia";
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  }, [handleDisconnected, startAutoDisconnect]);

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
      toast("💤 Obroża uśpiona");
      try {
        deviceRef.current?.gatt?.disconnect();
      } catch {
        // ignore
      }
    }
  }, [writeBytes]);

  const testCorrection = useCallback(async () => {
    const ok = await writeBytes([0x24]);
    if (ok) toast.success("⚡ Test korekty wysłany");
  }, [writeBytes]);

  const setSpacer = useCallback(
    async (on: boolean) => {
      const ok = await writeBytes([0x20, on ? 1 : 0]);
      if (ok) {
        spacerRef.current = on;
        setSpacerOn(on);
        if (!on) setEscapedAlarm(false);
        toast(on ? "🚶 Tryb spaceru włączony" : "Tryb spaceru wyłączony");
      }
    },
    [writeBytes],
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
      supported: typeof navigator !== "undefined" && !!(navigator as AnyBT).bluetooth,
      connected: false,
      connecting: false,
      deviceName: null,
      battery: null,
      countdownMs: 0,
      spacerOn: false,
      escapedAlarm: false,
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
