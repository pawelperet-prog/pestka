import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bluetooth, BatteryFull, Moon, Zap, Footprints, Terminal } from "lucide-react";
import { useBle, formatCountdown, loadBleConfig, SERVICE_UUID } from "@/lib/ble";
import { loadHistory, type BarkEvent } from "@/lib/history";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pestka Xense — Dashboard" },
      { name: "description", content: "Połącz się z obrożą Pestka przez Bluetooth." },
    ],
  }),
  component: Dashboard,
});

// ─── HANDLE CLICK ─────────────────────────────────────────────────────────────
// requestDevice MUSI być pierwszą asynchroniczną akcją po kliknięciu.
// Dlatego wywołujemy je tutaj bezpośrednio, a nie przez kontekst.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBT = any;

function Dashboard() {
  const ble = useBle();
  const [history, setHistory] = useState<BarkEvent[]>([]);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const now    = Math.floor(Date.now() / 1000);
  const last10h = history.filter(e => e.is_bark === 1 && now - e.timestamp < 10 * 3600).length;
  const lastBark = history.find(e => e.is_bark === 1);

  // ─── DIRECT BLE CONNECT ───────────────────────────────────────────────────
  function handleConnect() {
    const bt = (navigator as AnyBT)?.bluetooth;

    if (!bt) {
      ble.addLog("❌ navigator.bluetooth = undefined");
      alert(
        "Twoja przeglądarka NIE obsługuje Web Bluetooth!\n\n" +
        "• Windows: otwórz w Google Chrome lub Microsoft Edge\n" +
        "• iPhone: otwórz w aplikacji Bluefy (App Store)"
      );
      return;
    }

    ble.addLog("🔵 Wywołuję requestDevice...");
    ble.setConnectingState(true);

    const cfg = loadBleConfig();
    const svcUuid = cfg.serviceUuid || SERVICE_UUID;

    // requestDevice musi być wywołane NATYCHMIAST — bez żadnych await przed nim
    bt.requestDevice({
      filters: [
        { services: [svcUuid] },
        { namePrefix: "PESTKA" },
        { namePrefix: "Pestka" },
        { namePrefix: "pestka" },
      ],
      optionalServices: [svcUuid, "battery_service"],
    })
    .catch((e: AnyBT) => {
      // iOS: filter error → retry z acceptAllDevices
      if (e?.name === "NotFoundError" || e?.message?.toLowerCase().includes("cancel")) throw e;
      ble.addLog(`⚠️ Filter failed (${e?.message}) → próba acceptAllDevices`);
      return bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: [svcUuid, "battery_service"],
      });
    })
    .then((device: AnyBT) => {
      ble.addLog(`✅ Wybrano: "${device.name || "Nieznane"}"`);
      return ble.connectDevice(device);
    })
    .catch((e: AnyBT) => {
      ble.setConnectingState(false);
      if (e?.name === "NotFoundError" || e?.message?.toLowerCase().includes("cancel")) {
        ble.addLog("ℹ️ Anulowano wybór.");
      } else {
        ble.addLog(`❌ Błąd: ${e?.message ?? e}`);
        toast_error(`Błąd: ${e?.message ?? e}`);
      }
    })
    .finally(() => ble.setConnectingState(false));
  }

  return (
    <div className="space-y-4">
      <header className="pt-2 pb-1">
        <h1 className="text-2xl font-bold tracking-tight">Pestka Xense</h1>
        <p className="text-xs text-muted-foreground">Inteligentna obroża antyszczekowa</p>
      </header>

      {/* Connection card */}
      <section className="card-surface">
        <div className="flex items-center gap-3">
          <span
            className={`status-dot ${ble.connected ? "bg-success" : "bg-destructive"}`}
            style={ble.connected ? { boxShadow: "0 0 0 4px color-mix(in oklab, var(--color-success) 25%, transparent)" } : undefined}
          />
          <div className="flex-1">
            <div className="font-semibold">{ble.connected ? ble.deviceName : "Brak połączenia"}</div>
            <div className="text-xs text-muted-foreground">
              {ble.connected ? `BLE aktywne · ${formatCountdown(ble.countdownMs)}` : "Obroża rozłączona"}
            </div>
          </div>
          {ble.battery !== null && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <BatteryFull size={16} /> {ble.battery.toFixed(2)}V
            </div>
          )}
        </div>

        <div className="mt-4">
          {!ble.connected ? (
            <div className="space-y-2">
              {/* BEZPOŚREDNI onClick — requestDevice wywoływany natychmiast po kliknięciu */}
              <button
                type="button"
                onClick={handleConnect}
                disabled={ble.connecting}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-4 font-bold text-base shadow-lg active:scale-[0.98] transition-all disabled:opacity-50"
              >
                <Bluetooth size={22} />
                {ble.connecting ? "Wybierz urządzenie..." : "🔍 Połącz z Obrożą (BLE)"}
              </button>
              <p className="text-[11px] text-muted-foreground text-center">
                Chrome / Edge na Windows · Bluefy na iPhone
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={ble.sleepCollar}
              className="w-full flex items-center justify-center gap-2 rounded-2xl bg-secondary text-secondary-foreground py-3 font-semibold"
            >
              <Moon size={18} /> 💤 Uśpij Obrożę
            </button>
          )}
        </div>
      </section>

      {/* Spacer Mode */}
      <section className={`card-surface ${ble.spacerOn ? "border-warning/60" : ""}`}>
        <div className="flex items-start gap-3">
          <Footprints className="text-warning mt-1" size={22} />
          <div className="flex-1">
            <h2 className="font-semibold">🚶 Tryb Spaceru</h2>
            <p className="text-xs text-muted-foreground mt-1">Gdy pies ucieknie i zerwie BLE, obroża zacznie pikać.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => ble.setSpacer(!ble.spacerOn)}
          disabled={!ble.connected}
          className={`mt-4 w-full rounded-2xl py-3 font-semibold disabled:opacity-40 transition-colors ${
            ble.spacerOn ? "bg-destructive text-destructive-foreground" : "bg-success text-background"
          }`}
        >
          {ble.spacerOn ? "Zakończ Spacer" : "Rozpocznij Spacer"}
        </button>
      </section>

      {/* Stats */}
      <section className="card-surface">
        <h2 className="font-semibold mb-3">📊 Statystyki</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
            <span className="text-muted-foreground">Ostatnie 10h</span>
            <span className="font-semibold">{last10h} szczekań</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted-foreground">🔋 Bateria</span>
            <span className="font-semibold">{ble.battery !== null ? `${ble.battery.toFixed(2)} V` : "—"}</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted-foreground">📅 Ostatnie szczekanie</span>
            <span className="font-semibold">
              {lastBark ? new Date(lastBark.timestamp * 1000).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
          </li>
        </ul>
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
          onClick={ble.testCorrection}
          disabled={!ble.connected}
          className="mt-4 w-full rounded-2xl bg-destructive text-destructive-foreground py-3 font-semibold disabled:opacity-40"
        >
          {ble.connected ? "Testuj Korektę" : "Połącz najpierw z obrożą"}
        </button>
      </section>

      {/* BLE Logs */}
      <section className="card-surface space-y-2">
        <h2 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
          <Terminal size={13} /> Diagnostyka BLE
        </h2>
        <div className="bg-black/40 rounded-xl p-3 font-mono text-[11px] text-green-400 max-h-48 overflow-y-auto space-y-0.5">
          {ble.logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </section>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toast_error(msg: string) {
  // Dynamic import to avoid top-level sonner import issues
  import("sonner").then(m => m.toast.error(msg, { duration: 8000 })).catch(() => alert(msg));
}
