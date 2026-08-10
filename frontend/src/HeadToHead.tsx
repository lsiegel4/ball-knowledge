import { useState, useEffect, useRef, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";

const WS_URL = import.meta.env.VITE_WS_URL;
const API_URL = import.meta.env.VITE_API_URL;

type Phase = "idle" | "waiting" | "playing" | "over";
type Player = { playerId: string; name: string; fameScore: number };
type Reveal = { playerId: string; playerName: string; fameScore: number } | null;
type RoundResult = {
  round: number;
  replay: boolean;
  winnerIndex: number | null;
  scores: [number, number];
  picks: [Reveal, Reveal];
};

async function search(q: string): Promise<Player[]> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  const res = await fetch(`${API_URL}/players/search?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await res.json()).players ?? [];
}

export function HeadToHead() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [myIndex, setMyIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [category, setCategory] = useState<{ label: string } | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [myPick, setMyPick] = useState("");
  const [result, setResult] = useState<RoundResult | null>(null);
  const [finalWinner, setFinalWinner] = useState<number | null>(null);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Player[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const timedOut = useRef(false);

  // Cosmetic countdown. At 0, nudge the server once to resolve a no-show.
  useEffect(() => {
    if (phase !== "playing") return;
    const tick = () => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(rem);
      if (rem === 0 && !timedOut.current) {
        timedOut.current = true;
        wsRef.current?.send(JSON.stringify({ action: "roundTimeout" }));
      }
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [phase, deadline]);

  // Live search while picking.
  useEffect(() => {
    if (phase !== "playing" || myPick || q.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    search(q).then((p) => !cancelled && setHits(p));
    return () => {
      cancelled = true;
    };
  }, [q, phase, myPick]);

  const onMessage = useCallback((raw: string) => {
    const m = JSON.parse(raw);
    switch (m.type) {
      case "waiting":
        setPhase("waiting");
        break;
      case "matchFound":
        setMyIndex(m.playerIndex);
        setScores([0, 0]);
        setFinalWinner(null);
        setResult(null);
        break;
      case "roundStart":
        setRound(m.round);
        setCategory(m.category);
        setDeadline(m.deadline);
        setMyPick("");
        setQ("");
        setHits([]);
        setNote("");
        timedOut.current = false;
        setPhase("playing");
        // NB: keep `result` — it persists as the "last round" banner until the
        // next round resolves, so the reveal isn't lost between rounds.
        break;
      case "pickAccepted":
        setMyPick(m.playerName);
        setNote("");
        break;
      case "invalidPick":
        setNote("Not valid for this category — try another.");
        break;
      case "pickRejected":
        setNote("Pick locked or round closed.");
        break;
      case "tooLate":
        setNote("Too late!");
        break;
      case "roundResult":
        setScores(m.scores);
        setResult(m);
        break;
      case "matchOver":
        setScores(m.scores);
        setFinalWinner(m.winnerIndex);
        setPhase("over");
        break;
      case "opponentLeft":
        setFinalWinner(m.winnerIndex);
        setNote("Opponent left.");
        setPhase("over");
        break;
    }
  }, []);

  const findMatch = () => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ action: "findMatch" }));
    ws.onmessage = (e) => onMessage(e.data);
    ws.onclose = () => {
      if (phase === "waiting" || phase === "playing") setNote("Disconnected.");
    };
    setPhase("waiting");
    setNote("");
  };

  const pick = (p: Player) => {
    wsRef.current?.send(JSON.stringify({ action: "submitPick", playerId: p.playerId }));
  };

  const leave = () => {
    wsRef.current?.close();
    wsRef.current = null;
    setPhase("idle");
    setResult(null);
    setNote("");
  };

  useEffect(() => () => wsRef.current?.close(), []);

  const myScore = scores[myIndex];
  const oppScore = scores[1 - myIndex];

  if (phase === "idle") {
    return (
      <div>
        <h3>Head-to-Head</h3>
        <p>Best of 7. Same category, pick a valid player in 30s. Most obscure wins.</p>
        <button onClick={findMatch}>Find match</button>
        {note && <p>{note}</p>}
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div>
        <h3>Head-to-Head</h3>
        <p>Searching for an opponent…</p>
        <button onClick={leave}>Cancel</button>
      </div>
    );
  }

  if (phase === "over") {
    const won = finalWinner === myIndex;
    return (
      <div>
        <h3>Match over</h3>
        <p style={{ fontSize: "1.4rem" }}>{won ? "🏆 You win!" : "You lose."}</p>
        <p>
          You {myScore} — {oppScore} Opponent
        </p>
        {result && <ResultLine result={result} myIndex={myIndex} />}
        {note && <p>{note}</p>}
        <button onClick={leave}>Back</button>
      </div>
    );
  }

  // playing
  return (
    <div>
      <h3>Head-to-Head — round {round}</h3>
      <p>
        You <b>{myScore}</b> — <b>{oppScore}</b> Opponent
      </p>
      {result && (
        <div style={{ background: "#f4f4f4", padding: "0.5rem 0.75rem", marginBottom: "0.75rem", fontSize: "0.9rem" }}>
          <div style={{ color: "#666", fontSize: "0.8rem" }}>Round {result.round}</div>
          <ResultLine result={result} myIndex={myIndex} />
        </div>
      )}

      <div style={{ margin: "0.75rem 0", padding: "0.75rem", background: "#eef" }}>
        <div style={{ fontWeight: "bold" }}>{category?.label}</div>
        <div>⏱ {remaining}s</div>
      </div>

      {myPick ? (
        <p>
          You picked <b>{myPick}</b>. Waiting for opponent…
        </p>
      ) : (
        <>
          <input
            placeholder="search a valid player…"
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
        </>
      )}
      {note && <p style={{ color: "crimson" }}>{note}</p>}
      <button onClick={leave} style={{ marginTop: "1rem" }}>
        Forfeit
      </button>
    </div>
  );
}

function ResultLine({ result, myIndex }: { result: RoundResult; myIndex: number }) {
  const mine = result.picks[myIndex];
  const opp = result.picks[1 - myIndex];
  const outcome = result.replay
    ? "Replay — no point"
    : result.winnerIndex === myIndex
    ? "You won the round"
    : "You lost the round";
  return (
    <div>
      <p>
        You: {mine ? `${mine.playerName} (${mine.fameScore.toFixed(2)})` : "no pick"} · Opponent:{" "}
        {opp ? `${opp.playerName} (${opp.fameScore.toFixed(2)})` : "no pick"}
      </p>
      <p>
        <b>{outcome}</b>
      </p>
    </div>
  );
}
