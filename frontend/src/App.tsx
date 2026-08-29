import { useState, useEffect } from "react";
import {
  signUp,
  confirmSignUp,
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from "aws-amplify/auth";
import {
  Container,
  Group,
  Stack,
  Text,
  Title,
  Tabs,
  Button,
  TextInput,
  PasswordInput,
  Card,
  Anchor,
  Loader,
  Center,
} from "@mantine/core";
import { DailyChallenge } from "./DailyChallenge";
import { HeadToHead } from "./HeadToHead";
import { ChooseHandle } from "./ChooseHandle";
import { Profile } from "./Profile";

const API_URL = import.meta.env.VITE_API_URL;

type Stage = "signIn" | "signUp" | "confirm" | "authed";
type Mode = "daily" | "h2h" | "profile";

async function authHeaders() {
  const session = await fetchAuthSession();
  return { Authorization: `Bearer ${session.tokens?.idToken?.toString()}` };
}

// Wordmark: quiet type, a single azure dot standing in for the ball.
function Wordmark() {
  return (
    <Group gap={8} align="center">
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "var(--mantine-color-azure-4)",
        }}
      />
      <Text fw={500} size="lg" style={{ letterSpacing: "0.01em" }}>
        Ball Knowledge
      </Text>
    </Group>
  );
}

export function App() {
  const [stage, setStage] = useState<Stage>("signIn");
  const [mode, setMode] = useState<Mode>("daily");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  // undefined = not yet loaded, null = no handle claimed, string = the handle.
  const [handle, setHandle] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getCurrentUser()
      .then(() => setStage("authed"))
      .catch(() => setStage("signIn"));
  }, []);

  // Once authed, load the profile so we know whether to gate on handle setup.
  useEffect(() => {
    if (stage !== "authed") return;
    (async () => {
      const res = await fetch(`${API_URL}/me/profile`, { headers: await authHeaders() });
      const p = await res.json();
      setHandle(p.handle);
    })();
  }, [stage]);

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("");
    setErr(false);
    setBusy(true);
    try {
      await fn();
    } catch (e2) {
      setErr(true);
      setStatus((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doSignUp = run(async () => {
    await signUp({ username: email, password, options: { userAttributes: { email } } });
    setStatus("Account created. Check your email for the confirmation code.");
    setStage("confirm");
  });

  const doConfirm = run(async () => {
    await confirmSignUp({ username: email, confirmationCode: code });
    setStatus("Confirmed — sign in to continue.");
    setStage("signIn");
  });

  const doSignIn = run(async () => {
    await signIn({ username: email, password });
    setStage("authed");
  });

  const doSignOut = run(async () => {
    await signOut();
    setStage("signIn");
    setHandle(undefined);
  });

  const statusLine = status && (
    <Text size="sm" c={err ? "red.5" : "azure.4"}>
      {status}
    </Text>
  );

  // ---- Signed in ----
  if (stage === "authed") {
    return (
      <Container size={520} py={40}>
        <Group justify="space-between" align="center" mb="xl">
          <Wordmark />
          <Group gap="md">
            {handle && (
              <Text size="sm" c="dimmed">
                @{handle}
              </Text>
            )}
            <Anchor component="button" size="sm" c="dimmed" onClick={doSignOut}>
              Sign out
            </Anchor>
          </Group>
        </Group>

        {handle === undefined ? (
          <Center py={60}>
            <Loader color="azure" size="sm" />
          </Center>
        ) : handle === null ? (
          <ChooseHandle onClaimed={setHandle} authHeaders={authHeaders} apiUrl={API_URL} />
        ) : (
          <>
            <Tabs value={mode} onChange={(v) => setMode(v as Mode)} variant="default" mb="xl">
              <Tabs.List>
                <Tabs.Tab value="daily">daily</Tabs.Tab>
                <Tabs.Tab value="h2h">head-to-head</Tabs.Tab>
                <Tabs.Tab value="profile">profile</Tabs.Tab>
              </Tabs.List>
            </Tabs>
            {mode === "daily" && <DailyChallenge />}
            {mode === "h2h" && <HeadToHead />}
            {mode === "profile" && <Profile authHeaders={authHeaders} apiUrl={API_URL} />}
          </>
        )}
      </Container>
    );
  }

  // ---- Signed out (auth) ----
  return (
    <Container size={420} py={80}>
      <Stack align="center" mb="xl">
        <Wordmark />
        <Text size="sm" c="dimmed" ta="center">
          Name the most obscure player who fits. Least-picked wins.
        </Text>
      </Stack>

      <Card withBorder radius="md" padding="lg" bg="dark.6">
        {stage === "confirm" ? (
          <form onSubmit={doConfirm}>
            <Stack>
              <Title order={3} fw={400}>
                Confirm your email
              </Title>
              <TextInput
                label="Confirmation code"
                placeholder="code from email"
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
              />
              <Button type="submit" loading={busy} fullWidth>
                Confirm
              </Button>
              {statusLine}
            </Stack>
          </form>
        ) : (
          <Stack>
            <Tabs value={stage} onChange={(v) => setStage(v as Stage)}>
              <Tabs.List grow>
                <Tabs.Tab value="signIn">Sign in</Tabs.Tab>
                <Tabs.Tab value="signUp">Sign up</Tabs.Tab>
              </Tabs.List>
            </Tabs>

            <form onSubmit={stage === "signIn" ? doSignIn : doSignUp}>
              <Stack>
                <TextInput
                  label="Email"
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <PasswordInput
                  label="Password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
                <Button type="submit" loading={busy} fullWidth>
                  {stage === "signIn" ? "Sign in" : "Create account"}
                </Button>
                {statusLine}
              </Stack>
            </form>
          </Stack>
        )}
      </Card>
    </Container>
  );
}
