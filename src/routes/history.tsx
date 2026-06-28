import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Cloud, Download, Music, Play } from "lucide-react";
import { toast } from "sonner";
import { loadHistory, mergeHistory, parseHistoryCSV, type BarkEvent } from "@/lib/history";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Pestka Xense — Historia szczekań" },
      { name: "description", content: "Historia zdarzeń szczekania i nagrania WAV z obroży." },
    ],
  }),
  component: HistoryPage,
});

const HOTSPOT = "http://192.168.4.1";

type WavFile = { name: string; size: number };

function HistoryPage() {
  const [events, setEvents] = useState<BarkEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [wavs, setWavs] = useState<WavFile[]>([]);
  const [wavLoading, setWavLoading] = useState(false);
  const [isHttps, setIsHttps] = useState(false);

  useEffect(() => {
    setEvents(loadHistory());
    if (typeof window !== "undefined") {
      setIsHttps(window.location.protocol === "https:");
    }
  }, []);

  const mixedContentError = () => {
    toast.error(
      "Przeglądarka zablokowała żądanie HTTP z https. Otwórz aplikację po http:// LUB włącz w Chrome flagę 'Insecure origins treated as secure' dla http://192.168.4.1",
      { duration: 8000 },
    );
  };

  const fetchHistory = async () => {
    if (isHttps) { mixedContentError(); return; }
    setLoading(true);
    try {
      const res = await fetch(`${HOTSPOT}/api/history`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const csv = await res.text();
      const parsed = parseHistoryCSV(csv);
      const merged = mergeHistory(parsed);
      setEvents(merged);
      toast.success(`Pobrano ${parsed.length} zdarzeń`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Błąd pobierania";
      toast.error("Brak połączenia z hotspotem: " + msg);
    } finally {
      setLoading(false);
    }
  };

  const triggerUpload = async () => {
    if (isHttps) { mixedContentError(); return; }
    try {
      const res = await fetch(`${HOTSPOT}/api/upload_now`, { method: "POST" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      toast.success("☁️ Upload do chmury wyzwolony");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Błąd";
      toast.error("Błąd: " + msg);
    }
  };

  const fetchWavs = async () => {
    if (isHttps) { mixedContentError(); return; }
    setWavLoading(true);
    try {
      const res = await fetch(`${HOTSPOT}/api/wavs`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data: WavFile[] = await res.json();
      const sorted = [...data].sort((a, b) => b.name.localeCompare(a.name)).slice(0, 20);
      setWavs(sorted);
      toast.success(`Pobrano ${sorted.length} nagrań`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Błąd";
      toast.error("Brak połączenia: " + msg);
    } finally {
      setWavLoading(false);
    }
  };


  const playWav = (name: string) => {
    try {
      const audio = new Audio(`${HOTSPOT}/${name}`);
      audio.play().catch((e) => toast.error("Nie można odtworzyć: " + e.message));
    } catch {
      toast.error("Błąd odtwarzania");
    }
  };

  // Last 7 days bar chart
  const dailyCounts = useMemo(() => {
    const days: { label: string; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const start = d.getTime() / 1000;
      const end = start + 86400;
      const count = events.filter((e) => e.is_bark === 1 && e.timestamp >= start && e.timestamp < end).length;
      days.push({ label: d.toLocaleDateString("pl-PL", { weekday: "short" }), count });
    }
    return days;
  }, [events]);

  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));
  const barks = events.filter((e) => e.is_bark === 1);

  return (
    <div className="space-y-4">
      <header className="pt-2">
        <h1 className="text-2xl font-bold">Historia Szczekań</h1>
        <p className="text-sm text-muted-foreground">Zdarzenia i nagrania z obroży</p>
      </header>

      <section className="card-surface space-y-3">
        <h2 className="font-semibold">📊 Ostatnie 7 dni</h2>
        <div className="flex items-end justify-between gap-1 h-32">
          {dailyCounts.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[10px] text-muted-foreground">{d.count}</div>
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-primary to-secondary"
                style={{ height: `${(d.count / maxCount) * 100}%`, minHeight: "4px" }}
              />
              <div className="text-[10px] text-muted-foreground">{d.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="card-surface space-y-3">
        <div className="flex gap-2">
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-primary text-primary-foreground py-3 font-semibold disabled:opacity-50"
          >
            <Download size={18} />
            {loading ? "Pobieranie..." : "📡 Pobierz z Obroży"}
          </button>
        </div>
        <button
          onClick={triggerUpload}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-warning text-background py-3 font-semibold"
        >
          <Cloud size={18} /> ☁️ Wyślij na Cloud
        </button>

        <div className="divide-y divide-border">
          {barks.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">Brak zdarzeń. Pobierz dane z obroży lub poczekaj na nowe szczekania.</p>
          )}
          {barks.slice(0, 50).map((e) => {
            const pct = Math.round(e.probability * 100);
            const cls = pct > 80 ? "bg-success/20 text-success" : pct >= 50 ? "bg-warning/20 text-warning" : "bg-destructive/20 text-destructive";
            return (
              <div key={e.timestamp} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <div className="font-medium">
                    {new Date(e.timestamp * 1000).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  <div className="text-xs text-muted-foreground">#{e.bark_number} · RMS {e.rms}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-semibold ${cls}`}>{pct}%</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card-surface space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Music size={18} /> Nagrania WAV</h2>
        <button
          onClick={fetchWavs}
          disabled={wavLoading}
          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-secondary text-secondary-foreground py-3 font-semibold disabled:opacity-50"
        >
          {wavLoading ? "Pobieranie..." : "🎵 Pobierz listę nagrań"}
        </button>
        <ul className="divide-y divide-border">
          {wavs.map((w) => (
            <li key={w.name} className="flex items-center justify-between py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{w.name}</div>
                <div className="text-xs text-muted-foreground">{(w.size / 1024).toFixed(1)} KB</div>
              </div>
              <button
                onClick={() => playWav(w.name)}
                className="ml-2 rounded-full bg-primary text-primary-foreground p-2"
                aria-label={`Odtwórz ${w.name}`}
              >
                <Play size={14} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
