import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useBle } from "@/lib/ble";
import { clearHistory, loadHistory } from "@/lib/history";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Pestka Xense — Ustawienia" },
      { name: "description", content: "Konfiguracja Wi-Fi obroży i informacje o aplikacji." },
    ],
  }),
  component: SettingsPage,
});

const WIFI_KEY = "pestka_wifi";

function SettingsPage() {
  const ble = useBle();
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(loadHistory().length);
    try {
      const raw = localStorage.getItem(WIFI_KEY);
      if (raw) {
        const v = JSON.parse(raw);
        setSsid(v.ssid ?? "");
        setPass(v.pass ?? "");
      }
    } catch {
      // ignore
    }
  }, []);

  const save = () => {
    localStorage.setItem(WIFI_KEY, JSON.stringify({ ssid, pass }));
    toast.success("Zapisano lokalnie");
  };

  const wipe = () => {
    clearHistory();
    setCount(0);
    toast("🗑️ Historia lokalna wyczyszczona");
  };

  return (
    <div className="space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Ustawienia</h1>
        <p className="text-sm text-muted-foreground">Wi-Fi obroży i informacje o aplikacji</p>
      </header>

      <section className="card-surface space-y-3">
        <h2 className="font-semibold">📶 Wi-Fi / Cloud</h2>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">SSID sieci Wi-Fi</label>
          <input
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            placeholder="NazwaSieci"
            className="w-full rounded-xl bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Hasło Wi-Fi</label>
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-xl bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>
        <button onClick={save} className="w-full rounded-2xl bg-primary text-primary-foreground py-3 font-semibold">
          Zapisz i prześlij do obroży
        </button>
        <p className="text-xs text-muted-foreground">Połącz się z hotspotem obroży aby wysłać dane.</p>
      </section>

      <section className="card-surface space-y-3">
        <h2 className="font-semibold">ℹ️ O aplikacji</h2>
        <ul className="text-sm divide-y divide-border">
          <li className="flex justify-between py-2"><span className="text-muted-foreground">Wersja</span><span>Pestka Xense v1.0</span></li>
          <li className="flex justify-between py-2"><span className="text-muted-foreground">Urządzenie</span><span>{ble.deviceName ?? "—"}</span></li>
          <li className="flex justify-between py-2"><span className="text-muted-foreground">Zapisane zdarzenia</span><span>{count}</span></li>
        </ul>
        <button onClick={wipe} className="w-full flex items-center justify-center gap-2 rounded-2xl bg-destructive/20 text-destructive py-3 font-semibold border border-destructive/40">
          <Trash2 size={16} /> Wyczyść historię lokalną
        </button>
      </section>
    </div>
  );
}
