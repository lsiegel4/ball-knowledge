import { useState, useEffect } from "react";

type Match = {
  gameId: string;
  won: boolean;
  oppHandle: string | null;
  myScore: number;
  oppScore: number;
  endedAt: number;
};
type ProfileData = {
  handle: string | null;
  wins: number;
  losses: number;
  played: number;
  recent: Match[];
};

type Props = {
  authHeaders: () => Promise<Record<string, string>>;
  apiUrl: string;
};

export function Profile({ authHeaders, apiUrl }: Props) {
  const [data, setData] = useState<ProfileData | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`${apiUrl}/me/profile`, { headers: await authHeaders() });
      setData(await res.json());
    })();
  }, [authHeaders, apiUrl]);

  if (!data) return <p>Loading…</p>;

  return (
    <div>
      <h3>@{data.handle}</h3>
      <p style={{ fontSize: "1.2rem" }}>
        {data.wins}W – {data.losses}L{" "}
        <span style={{ color: "#666", fontSize: "0.9rem" }}>({data.played} played)</span>
      </p>

      <h4>Recent matches</h4>
      {data.recent.length === 0 ? (
        <p style={{ color: "#666" }}>No matches yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {data.recent.map((m) => (
            <li
              key={m.gameId}
              style={{ padding: "0.4rem 0", borderBottom: "1px solid #eee", display: "flex", gap: "0.5rem" }}
            >
              <b style={{ color: m.won ? "green" : "crimson", width: "2.5rem" }}>
                {m.won ? "WIN" : "LOSS"}
              </b>
              <span>
                {m.myScore}–{m.oppScore} vs @{m.oppHandle ?? "unknown"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
