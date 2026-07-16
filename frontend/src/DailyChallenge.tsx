import { useState, useEffect, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

const API_URL = import.meta.env.VITE_API_URL;

async function authedFetch(path: string, init?: RequestInit) {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

type Player = { playerId: string; name: string; fameScore: number };
type Pick = { playerId: string; playerName: string };
type Results = {
  winner: { playerId: string; playerName: string; count: number };
  totalPicks: number;
};
type DayResult = { day: string; pick: Pick | null; results: Results | null };
type Today = {
  day: string;
  pick: Pick | null;
  results: Results | null;
  yesterday: DayResult;
};

function ResultsView({ pick, results, label }: DayResult & { label: string }) {
  if (!results) return null;
  const iWon = pick && results.winner.playerId === pick.playerId;
  return (
    <div style={{ background: "#f4f4f4", padding: "0.75rem", marginTop: "1rem" }}>
      <h3 style={{ margin: "0 0 0.5rem" }}>{label}</h3>
      <p style={{ margin: "0.25rem 0" }}>
        Winner: <b>{results.winner.playerName}</b> — {results.winner.count} of{" "}
        {results.totalPicks} picks
      </p>
      {pick && (
        <p style={{ margin: "0.25rem 0" }}>
          You picked {pick.playerName}. {iWon ? "🏆 You won!" : "Not this time."}
        </p>
      )}
    </div>
  );
}

export function DailyChallenge() {
  const [today, setToday] = useState<Today | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Player[]>([]);
  const [msg, setMsg] = useState("");

  const loadToday = useCallback(async () => {
    const res = await authedFetch("/daily/today");
    setToday(await res.json());
  }, []);

  useEffect(() => {
    loadToday();
  }, [loadToday]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    authedFetch(`/players/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setHits(d.players);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  const pick = async (p: Player) => {
    setMsg("");
    const res = await authedFetch("/daily/pick", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: p.playerId }),
    });
    if (res.ok) {
      setQ("");
      setHits([]);
      setMsg(`Picked ${p.name}.`);
      loadToday();
    } else {
      setMsg(`Error: HTTP ${res.status}`);
    }
  };

  if (!today) return <p>Loading…</p>;

  return (
    <div>
      <h3>Daily Challenge — {today.day}</h3>
      <p>Name a player. Least-picked wins. Resets midnight ET.</p>
      {today.pick && (
        <p>
          Current pick: <b>{today.pick.playerName}</b> (change until tonight)
        </p>
      )}
      <input
        placeholder="search player…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ width: "100%", padding: "0.4rem" }}
      />
      <ul style={{ listStyle: "none", padding: 0 }}>
        {hits.map((p) => (
          <li key={p.playerId} style={{ margin: "0.25rem 0" }}>
            <button onClick={() => pick(p)}>{p.name}</button>
          </li>
        ))}
      </ul>
      {msg && <p>{msg}</p>}

      <ResultsView label={`Today's results — ${today.day}`} {...today} />
      <ResultsView label={`Yesterday — ${today.yesterday.day}`} {...today.yesterday} />
    </div>
  );
}
