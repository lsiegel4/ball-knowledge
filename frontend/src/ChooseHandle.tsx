import { useState, type FormEvent } from "react";

const HANDLE_RE = /^[a-zA-Z0-9_]{3,20}$/;

type Props = {
  onClaimed: (handle: string) => void;
  authHeaders: () => Promise<Record<string, string>>;
  apiUrl: string;
};

// One-time gate: a signed-in user must claim a handle before reaching the app.
export function ChooseHandle({ onClaimed, authHeaders, apiUrl }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = HANDLE_RE.test(value);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/me/handle`, {
        method: "POST",
        headers: { ...(await authHeaders()), "content-type": "application/json" },
        body: JSON.stringify({ handle: value }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not claim handle.");
        return;
      }
      onClaimed(body.handle);
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <h3>Pick a handle</h3>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        3–20 characters: letters, numbers, underscore. This is permanent.
      </p>
      <input
        placeholder="handle"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ padding: "0.4rem" }}
      />{" "}
      <button type="submit" disabled={!valid || busy}>
        {busy ? "Claiming…" : "Claim"}
      </button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </form>
  );
}
