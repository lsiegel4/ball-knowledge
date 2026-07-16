import { useState, useEffect, type FormEvent } from "react";
import {
  signUp,
  confirmSignUp,
  signIn,
  signOut,
  getCurrentUser,
} from "aws-amplify/auth";
import { DailyChallenge } from "./DailyChallenge";

type Stage = "signIn" | "signUp" | "confirm" | "authed";

export function App() {
  const [stage, setStage] = useState<Stage>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    getCurrentUser()
      .then(() => setStage("authed"))
      .catch(() => setStage("signIn"));
  }, []);

  const wrap = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setStatus("");
    try {
      await fn();
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  const doSignUp = wrap(async () => {
    await signUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
    setStatus("Signed up. Check email for the confirmation code.");
    setStage("confirm");
  });

  const doConfirm = wrap(async () => {
    await confirmSignUp({ username: email, confirmationCode: code });
    setStatus("Confirmed. Now sign in.");
    setStage("signIn");
  });

  const doSignIn = wrap(async () => {
    await signIn({ username: email, password });
    setStage("authed");
  });

  const doSignOut = wrap(async () => {
    await signOut();
    setStage("signIn");
  });

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 420, margin: "3rem auto" }}>
      <h1>🏀 Ball Knowledge</h1>

      {stage === "authed" ? (
        <>
          <button onClick={doSignOut} style={{ float: "right" }}>Sign out</button>
          <DailyChallenge />
        </>
      ) : (
        <>
          <div>
            <button onClick={() => setStage("signIn")} disabled={stage === "signIn"}>
              Sign in
            </button>{" "}
            <button onClick={() => setStage("signUp")} disabled={stage === "signUp"}>
              Sign up
            </button>
          </div>

          {stage === "signUp" && (
            <form onSubmit={doSignUp}>
              <h3>Sign up</h3>
              <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="submit">Create account</button>
            </form>
          )}

          {stage === "confirm" && (
            <form onSubmit={doConfirm}>
              <h3>Confirm email</h3>
              <input placeholder="code from email" value={code} onChange={(e) => setCode(e.target.value)} />
              <button type="submit">Confirm</button>
            </form>
          )}

          {stage === "signIn" && (
            <form onSubmit={doSignIn}>
              <h3>Sign in</h3>
              <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="submit">Sign in</button>
            </form>
          )}
        </>
      )}

      {status && <p style={{ color: status.startsWith("Error") ? "crimson" : "green" }}>{status}</p>}
    </div>
  );
}
