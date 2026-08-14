import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bluetooth, BatteryFull, Moon, Zap, Footprints, Terminal, AlertTriangle } from "lucide-react";
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
        <p className="text-xs text-muted-foreground">{ble.browserInfo || "Sprawdzanie przeglądarki..."}</p>
      </header>

      {!ble.supported && (
        <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-3.5 text-xs text-destructive-foreground space-y-2">
          <div className="flex items-center gap-2 font-bold text-destructive">
            <AlertTriangle size={18} /> Brak Web Bluetooth w tej przeglądarce!
          </div>
          <p className="leading-relaxed text-muted-foreground">
            Twoja aktualna przeglądarka (np. Firefox, Opera, zwykłe Safari) blokuje łączność Bluetooth.
          </p>
          <div className="bg-background/60 p-2.5 rounded-xl text-foreground font-mono text-[11px] space-y-1">
            <div>👉 <b>Windows:</b> Otwórz stronę w <b>Google Chrome</b> lub <b>Microsoft Edge</b>.</div>
            <div>👉 <b>iPhone (iOS):</b> Otwórz stronę w darmowej przeglądarce <b>Bluefy</b> z App Store.</div>
          </div>
        </div>
      )}

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
                type="button"
                onClick={ble.connect}
                disabled={ble.connecting}
                className="w-full flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-4 font-bold text-base shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
              >
                <Bluetooth size={22} />
                {ble.connecting ? "Wybierz urządzenie w oknie..." : "🔍 SZUKAJ OBROŻY (BLE)"}
              </button>
              <p className="text-[11px] leading-relaxed text-muted-foreground text-center pt-1">
                Kliknięcie otworzy okienko wyboru Bluetooth. Wybierz obrożę i kliknij <b>Paruj</b>.
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
          {ble.connected ? "Testuj Korektę" : "Połącz najpierw z obrożą"}
        </button>
      </section>

      {/* BLE Console & Diagnostics */}
      <section className="card-surface space-y-2">
        <h2 className="text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
          <Terminal size={14} /> Logi i diagnostyka BLE
        </h2>
        <div className="bg-background/90 border border-border/40 rounded-xl p-3 font-mono text-[11px] text-muted-foreground max-h-48 overflow-y-auto space-y-1">
          {ble.logs && ble.logs.length > 0 ? (
            ble.logs.map((log, idx) => (
              <div key={idx} className="leading-tight">{log}</div>
            ))
          ) : (
            <div>Oczekiwanie na akcję użytkownika...</div>
          )}
        </div>
      </section>
    </div>
  );
}
