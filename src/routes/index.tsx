import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  Bluetooth, BatteryFull, Moon, Zap, Footprints, Terminal,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pestka Xense — Dashboard" },
      { name: "description", content: "Połącz z obrożą Pestka przez Bluetooth." },
    ],
  }),
  component: Dashboard,
});

// UUIDs z firmware (NimBLE UART)
const SVC  = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const TXCH = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // app WRITE → collar
const RXCH = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // collar NOTIFY → app

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BT = any;

function Dashboard() {
  const [status,     setStatus]     = useState<"idle"|"picking"|"connecting"|"connected">("idle");
  const [devName,    setDevName]    = useState("");
  const [battery,    setBattery]    = useState<number|null>(null);
  const [spacerOn,   setSpacerOn]   = useState(false);
  const [logs,       setLogs]       = useState<string[]>(["Gotowy."]);

  const txRef  = useRef<BT>(null);
  const devRef = useRef<BT>(null);

  function log(msg: string) {
    console.log("[BLE]", msg);
    setLogs(p => [`${new Date().toLocaleTimeString()} ${msg}`, ...p.slice(0, 79)]);
  }

  async function writeCmd(bytes: number[]) {
    if (!txRef.current) { toast.error("Nie połączono"); return; }
    try {
      const buf = new Uint8Array(bytes);
      if (txRef.current.writeValueWithoutResponse) await txRef.current.writeValueWithoutResponse(buf);
      else await txRef.current.writeValue(buf);
    } catch (e: BT) { toast.error("Błąd: " + e?.message); }
  }

  function onDisconnect() {
    log("🔴 Rozłączono");
    setStatus("idle"); setDevName(""); setBattery(null); setSpacerOn(false);
    txRef.current = null;
    toast("Rozłączono z obrożą");
  }

  function onNotify(e: Event) {
    try {
      const v = (e.target as BT).value as DataView;
      const t = new TextDecoder().decode(v.buffer);
      const m = t.match(/vbat[=:]?\s*([\d.]+)/i) || t.match(/([\d]+\.[\d]{1,3})/);
      if (m) { const n = parseFloat(m[1]); if (n > 2 && n < 5.5) setBattery(n); }
    } catch { /**/ }
  }

  // ─── CONNECT: requestDevice wywołane jako PIERWSZA linia (user gesture) ──
  async function handleConnect() {
    const bt: BT = (navigator as BT).bluetooth;
    if (!bt) {
      alert("Web Bluetooth niedostępny!\n\n• Windows/Android → Google Chrome lub Edge\n• iPhone → aplikacja Bluefy (App Store)");
      return;
    }

    // KROK 1: Picker — MUST być pierwszą asynchroniczną operacją po kliknięciu
    setStatus("picking");
    log("📡 Otwieram picker BLE...");

    let device: BT;
    try {
      device = await bt.requestDevice({
        filters: [
          { services: [SVC] },
          { namePrefix: "PESTKA" },
          { namePrefix: "Pestka" },
          { namePrefix: "pestka" },
        ],
        optionalServices: [SVC, "battery_service"],
      });
      log(`✅ Wybrano: "${device.name}"`);
    } catch (e: BT) {
      if (e?.name === "NotFoundError" || String(e?.message).toLowerCase().includes("cancel")) {
        log("ℹ️ Anulowano picker.");
        setStatus("idle"); return;
      }
      // Fallback: acceptAllDevices (desktop Chrome bez filtrów)
      log(`⚠️ Filter error (${e?.message}) → acceptAllDevices`);
      try {
        device = await bt.requestDevice({
          acceptAllDevices: true,
          optionalServices: [SVC, "battery_service"],
        });
        log(`✅ Wybrano (fallback): "${device.name}"`);
      } catch (e2: BT) {
        log(`❌ Picker błąd: ${e2?.message}`);
        toast.error("Nie można wybrać urządzenia: " + e2?.message);
        setStatus("idle"); return;
      }
    }

    // KROK 2: GATT connect
    setStatus("connecting");
    log("🔵 Łączę GATT...");
    devRef.current = device;
    device.addEventListener("gattserverdisconnected", onDisconnect);

    try {
      const server = await device.gatt.connect();
      log("✅ GATT OK. Szukam usługi UART...");

      const svc = await server.getPrimaryService(SVC);
      log("✅ Usługa UART znaleziona. Pobieram TX...");

      const tx = await svc.getCharacteristic(TXCH);
      txRef.current = tx;
      log("✅ TX (zapis) gotowy.");

      // RX notify (opcjonalne — telemetria baterii)
      try {
        const rx = await svc.getCharacteristic(RXCH);
        await rx.startNotifications();
        rx.addEventListener("characteristicvaluechanged", onNotify);
        log("✅ RX (telemetria) aktywna.");
      } catch (rxErr: BT) {
        log(`ℹ️ RX pominięty (${rxErr?.message})`);
      }

      setStatus("connected");
      setDevName(device.name || "Obroża Pestka");
      log(`🎉 POŁĄCZONO z "${device.name}"!`);
      toast.success(`Połączono: ${device.name || "Obroża"}`);

    } catch (err: BT) {
      log(`❌ GATT BŁĄD: ${err?.message ?? err}`);
      toast.error(`Błąd połączenia GATT: ${err?.message ?? err}`, { duration: 10000 });
      setStatus("idle");
      try { device?.gatt?.disconnect(); } catch { /**/ }
    }
  }

  async function handleSleep() {
    await writeCmd([0x21]);
    log("💤 Uśpienie (0x21)");
    toast("💤 Obroża uśpiona");
    try { devRef.current?.gatt?.disconnect(); } catch { /**/ }
  }

  async function handleTest() {
    await writeCmd([0x24]);
    log("⚡ Test korekty (0x24)");
    toast.success("⚡ Test wysłany");
  }

  async function handleSpacer(on: boolean) {
    await writeCmd([0x20, on ? 1 : 0]);
    setSpacerOn(on);
    log(`🚶 Spacer: ${on ? "ON" : "OFF"}`);
    toast(on ? "🚶 Tryb spaceru aktywny" : "Tryb spaceru wyłączony");
  }

  const connected  = status === "connected";
  const picking    = status === "picking";
  const connecting = status === "connecting";
  const busy       = picking || connecting;

  // Przelicz % baterii (3.3V = 0%, 4.2V = 100%)
  const battPct = battery !== null
    ? Math.round(Math.min(100, Math.max(0, ((battery - 3.3) / (4.2 - 3.3)) * 100)))
    : null;

  return (
    <div className="space-y-4">
      <header className="pt-2 pb-1">
        <h1 className="text-2xl font-bold tracking-tight">Pestka Xense</h1>
        <p className="text-xs text-muted-foreground">Inteligentna obroża antyszczekowa</p>
      </header>

      {/* Status + Connect */}
      <section className="card-surface">
        <div className="flex items-center gap-3">
          <span
            className={`status-dot ${connected ? "bg-success" : "bg-destructive"}`}
            style={connected ? { boxShadow: "0 0 0 5px color-mix(in oklab, var(--color-success) 20%, transparent)" } : undefined}
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{connected ? devName : "Brak połączenia"}</div>
            <div className="text-xs text-muted-foreground">
              {picking ? "⏳ Otwieranie okna wyboru..." : connecting ? "⏳ Łączenie GATT..." : connected ? "BLE aktywne" : "Obroża rozłączona"}
            </div>
          </div>
          {battPct !== null && (
            <div className="flex items-center gap-1 text-sm font-semibold">
              <BatteryFull size={16} className={battPct > 30 ? "text-success" : "text-destructive"} />
              {battPct}%
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {!connected ? (
            <>
              <button
                type="button"
                onClick={handleConnect}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-4 font-bold text-base shadow-lg active:scale-[0.98] transition-all disabled:opacity-60"
              >
                <Bluetooth size={22} />
                {picking ? "Wybierz urządzenie w oknie..." : connecting ? "Łączenie..." : "🔍 Połącz z Obrożą (BLE)"}
              </button>
              <p className="text-[11px] text-muted-foreground text-center">
                Chrome / Edge (Windows) · Bluefy (iPhone)
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={handleSleep}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-secondary text-secondary-foreground py-3 font-semibold"
            >
              <Moon size={18} /> 💤 Uśpij Obrożę
            </button>
          )}
        </div>
      </section>

      {/* Spacer */}
      <section className={`card-surface ${spacerOn ? "border-warning/60" : ""}`}>
        <div className="flex items-start gap-3">
          <Footprints className="text-warning mt-1" size={22} />
          <div className="flex-1">
            <h2 className="font-semibold">🚶 Tryb Spaceru</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Gdy pies ucieknie i zerwie BLE, obroża zacznie pikać.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleSpacer(!spacerOn)}
          disabled={!connected}
          className={`mt-4 w-full rounded-2xl py-3 font-semibold disabled:opacity-40 transition-colors ${
            spacerOn ? "bg-destructive text-destructive-foreground" : "bg-success text-background"
          }`}
        >
          {spacerOn ? "Zakończ Spacer" : "Rozpocznij Spacer"}
        </button>
      </section>

      {/* Test korekty */}
      <section className="card-surface">
        <div className="flex items-start gap-3">
          <Zap className="text-destructive mt-1" size={22} />
          <div className="flex-1">
            <h2 className="font-semibold">⚡ Test Korekty</h2>
            <p className="text-xs text-muted-foreground mt-1">Uruchomi buzzer w obroży.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={!connected}
          className="mt-4 w-full rounded-2xl bg-destructive text-destructive-foreground py-3 font-semibold disabled:opacity-40"
        >
          {connected ? "Testuj Korektę" : "Najpierw połącz z obrożą"}
        </button>
      </section>

      {/* Diagnostyka */}
      <section className="card-surface space-y-2">
        <h2 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
          <Terminal size={13} /> Diagnostyka BLE
        </h2>
        <div className="bg-black/40 rounded-xl p-3 font-mono text-[11px] text-green-400 max-h-52 overflow-y-auto space-y-0.5">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </section>
    </div>
  );
}
