export type BarkEvent = {
  timestamp: number; // unix seconds
  bark_number: number;
  probability: number;
  is_bark: number;
  rms: number;
  jerk: number;
};

const KEY = "pestka_history";

export function loadHistory(): BarkEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BarkEvent[];
  } catch {
    return [];
  }
}

export function saveHistory(events: BarkEvent[]) {
  localStorage.setItem(KEY, JSON.stringify(events));
}

export function clearHistory() {
  localStorage.removeItem(KEY);
}

export function mergeHistory(incoming: BarkEvent[]): BarkEvent[] {
  const existing = loadHistory();
  const map = new Map<number, BarkEvent>();
  for (const e of existing) map.set(e.timestamp, e);
  for (const e of incoming) map.set(e.timestamp, e);
  const merged = Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  saveHistory(merged);
  return merged;
}

export function parseHistoryCSV(csv: string): BarkEvent[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (n: string) => header.indexOf(n);
  const iTs = idx("timestamp");
  const iBn = idx("bark_number");
  const iPr = idx("probability");
  const iIb = idx("is_bark");
  const iRms = idx("rms");
  const iJ = idx("jerk");
  const out: BarkEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    out.push({
      timestamp: Number(cols[iTs]),
      bark_number: Number(cols[iBn]),
      probability: Number(cols[iPr]),
      is_bark: Number(cols[iIb]),
      rms: Number(cols[iRms]),
      jerk: Number(cols[iJ]),
    });
  }
  return out;
}
