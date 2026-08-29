import { useState, useEffect, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  Card,
  Stack,
  Group,
  Text,
  Title,
  TextInput,
  UnstyledButton,
  Badge,
  Center,
  Loader,
} from "@mantine/core";

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
    <Card withBorder radius="md" padding="md" bg="dark.6">
      <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.12em" }} mb="xs">
        {label}
      </Text>
      <Text size="sm">
        Winner: <b>{results.winner.playerName}</b>{" "}
        <Text span c="dimmed">
          — {results.winner.count} of {results.totalPicks} picks
        </Text>
      </Text>
      {pick && (
        <Text size="sm" mt={4} c={iWon ? "azure.4" : "dimmed"}>
          You picked {pick.playerName}. {iWon ? "You won 🏆" : "Not this time."}
        </Text>
      )}
    </Card>
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
      setMsg(`Could not save pick (HTTP ${res.status}).`);
    }
  };

  if (!today) {
    return (
      <Center py={60}>
        <Loader color="azure" size="sm" />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Group justify="space-between" align="baseline">
          <Title order={3} fw={400}>
            Daily Challenge
          </Title>
          <Text size="xs" c="dimmed">
            {today.day}
          </Text>
        </Group>
        <Text size="sm" c="dimmed" mt={4}>
          Name a player. Least-picked wins. Resets midnight ET.
        </Text>
      </div>

      {today.pick && (
        <Card withBorder radius="md" padding="sm" bg="dark.6">
          <Group justify="space-between">
            <Text size="sm">
              <Text span c="dimmed">
                Your pick:{" "}
              </Text>
              <b>{today.pick.playerName}</b>
            </Text>
            <Badge variant="light" color="azure" radius="sm">
              change until tonight
            </Badge>
          </Group>
        </Card>
      )}

      <div>
        <TextInput
          placeholder="Search a player…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        {hits.length > 0 && (
          <Card withBorder radius="md" padding={4} bg="dark.6" mt={6}>
            {hits.map((p) => (
              <UnstyledButton
                key={p.playerId}
                onClick={() => pick(p)}
                p="xs"
                display="block"
                w="100%"
                style={{ borderRadius: 6 }}
                className="hoverrow"
              >
                <Text size="sm">{p.name}</Text>
              </UnstyledButton>
            ))}
          </Card>
        )}
        {msg && (
          <Text size="sm" c="dimmed" mt="xs">
            {msg}
          </Text>
        )}
      </div>

      <ResultsView label={`Today · ${today.day}`} {...today} />
      <ResultsView label={`Yesterday · ${today.yesterday.day}`} {...today.yesterday} />
    </Stack>
  );
}
