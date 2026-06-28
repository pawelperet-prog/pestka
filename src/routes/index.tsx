import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bluetooth, BatteryFull, Moon, Zap, Footprints } from "lucide-react";
import { useBle, formatCountdown } from "@/lib/ble";
import { loadHistory, type BarkEvent } from "@/lib/history";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pestka Xense — Dashboard" },
      { name: "description", content: "Połącz się z obrożą i steruj trybem spaceru." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const ble = useBle();
  const [history, setHistory] = useState<BarkEvent[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const now = Math.floor(Date.now() / 1000);
  const last10h = history.filter((e) => e.is_bark === 1 && now - e.timestamp < 10 * 3600).length;
  const lastBark = history.find((e) => e.is_bark === 1);

  return (
    <div className="space-y-4">
      <header className="pt-2 pb-1">
        <h1 className="text-2xl font-bold tracking-tight">Pestka Xense</h1>
        <p className="text-sm text-muted-foreground">Inteligentna obroża antyszczekowa</p>
      </header>

      {/* Connection */}
      <section className="card-surface">
        <div className="flex items-center gap-3">
          <span
            className={`status-dot ${ble.connected ? "bg-success pulse-danger" : "bg-destructive"}`}
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

        <div className="mt-4 grid grid-cols-1 gap-2">
          {!ble.connected ? (
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => ble.connect(false)}
                disabled={ble.connecting || !ble.supported}
                className="flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-3 font-semibold disabled:opacity-50 transition-opacity"
              >
                <Bluetooth size={18} />
                {ble.connecting ? "Łączenie..." : "Szukaj Obroży"}
              </button>
              <button
                onClick={() => ble.connect(true)}
                disabled={ble.connecting || !ble.supported}
                className="text-xs text-muted-foreground underline py-1"
              >
                Nie widzisz obroży? Pokaż wszystkie urządzenia BLE
              </button>
              <p className="text-[11px] leading-relaxed text-muted-foreground text-center">
                Błąd „No Services matching UUID” oznacza zwykle zły profil BLE w firmware — zmień go w Ustawieniach → Bluetooth.
              </p>
            </div>
          ) : (
            <button
              onClick={ble.sleepCollar}
              className="flex items-center justify-center gap-2 rounded-2xl bg-secondary text-secondary-foreground py-3 font-semibold"
            >
              <Moon size={18} /> 💤 Uśpij Obrożę
            </button>
          )}
        </div>
      </section>

      {/* Spacer Mode */}
      <section className={`card-surface ${ble.spacerOn ? "pulse-spacer border-warning" : ""}`}>
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
          onClick={() => ble.setSpacer(!ble.spacerOn)}
          disabled={!ble.connected}
          className={`mt-4 w-full rounded-2xl py-3 font-semibold disabled:opacity-40 transition-colors ${
            ble.spacerOn ? "bg-destructive text-destructive-foreground" : "bg-success text-background"
          }`}
        >
          {ble.spacerOn ? "Zakończ Spacer" : "Rozpocznij Spacer"}
        </button>
      </section>

      {/* Quick Stats */}
      <section className="card-surface">
        <h2 className="font-semibold mb-3">📊 Statystyki</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
            <span className="text-muted-foreground">Ostatnie 10 godzin</span>
            <span className="font-semibold">{last10h} szczekań</span>
          </li>
          <li className="flex justify-between">
            <span className="text-muted-foreground">🔋 Bateria obroży</span>
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

      {/* Correction Test */}
      <section className="card-surface">
        <div className="flex items-start gap-3">
          <Zap className="text-destructive mt-1" size={22} />
          <div className="flex-1">
            <h2 className="font-semibold">⚡ Test Korekty</h2>
            <p className="text-xs text-muted-foreground mt-1">Uruchomi buzzer w obroży.</p>
          </div>
        </div>
        <button
          onClick={ble.testCorrection}
          disabled={!ble.connected}
          className="mt-4 w-full rounded-2xl bg-destructive text-destructive-foreground py-3 font-semibold disabled:opacity-40"
        >
          Testuj Korektę
        </button>
      </section>
    </div>
  );
}
