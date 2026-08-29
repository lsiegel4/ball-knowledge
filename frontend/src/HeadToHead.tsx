import { useState, useEffect, useRef, useCallback } from "react";
import { fetchAuthSession } from "aws-amplify/auth";
import {
  Card,
  Stack,
  Group,
  Text,
  Title,
  Button,
  TextInput,
  UnstyledButton,
  RingProgress,
  Badge,
  Loader,
  Center,
} from "@mantine/core";

const WS_URL = import.meta.env.VITE_WS_URL;
const API_URL = import.meta.env.VITE_API_URL;
const ROUND_SECONDS = 30;

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
      case "needHandle":
        setNote("Set a handle before playing.");
        setPhase("idle");
        break;
    }
  }, []);

  const findMatch = async () => {
    setPhase("waiting");
    setNote("");
    // Browsers can't set headers on new WebSocket, so the JWT rides the URL as
    // ?token=... — the $connect authorizer validates it before the socket opens.
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    const ws = new WebSocket(`${WS_URL}?token=${token}`);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify({ action: "findMatch" }));
    ws.onmessage = (e) => onMessage(e.data);
    ws.onclose = () => {
      if (phase === "waiting" || phase === "playing") setNote("Disconnected.");
    };
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

  // ---- idle ----
  if (phase === "idle") {
    return (
      <Card withBorder radius="md" padding="xl" bg="dark.6">
        <Stack align="center" gap="md">
          <Title order={3} fw={400} ta="center">
            Head-to-Head
          </Title>
          <Text size="sm" c="dimmed" ta="center" maw={360}>
            Best of 7. Same category for both players — name a valid player in 30
            seconds. Most obscure pick wins the round.
          </Text>
          <Button size="md" onClick={findMatch}>
            Find a match
          </Button>
          {note && (
            <Text size="sm" c="red.5">
              {note}
            </Text>
          )}
        </Stack>
      </Card>
    );
  }

  // ---- waiting ----
  if (phase === "waiting") {
    return (
      <Card withBorder radius="md" padding="xl" bg="dark.6">
        <Stack align="center" gap="lg">
          <Loader color="azure" />
          <Text c="dimmed">Searching for an opponent…</Text>
          <Button variant="subtle" color="gray" onClick={leave}>
            Cancel
          </Button>
        </Stack>
      </Card>
    );
  }

  // ---- over ----
  if (phase === "over") {
    const won = finalWinner === myIndex;
    return (
      <Card withBorder radius="md" padding="xl" bg="dark.6">
        <Stack align="center" gap="md">
          <Badge size="lg" variant="light" color={won ? "azure" : "gray"}>
            {won ? "You win" : "You lose"}
          </Badge>
          <ScoreLine my={myScore} opp={oppScore} />
          {result && <ResultLine result={result} myIndex={myIndex} />}
          {note && (
            <Text size="sm" c="dimmed">
              {note}
            </Text>
          )}
          <Button variant="light" onClick={leave}>
            Back
          </Button>
        </Stack>
      </Card>
    );
  }

  // ---- playing ----
  const ringColor = remaining <= 5 ? "red.5" : "azure.4";
  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={4} fw={400}>
          Round {round}
        </Title>
        <ScoreLine my={myScore} opp={oppScore} compact />
      </Group>

      {result && (
        <Card withBorder radius="md" padding="sm" bg="dark.6">
          <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.12em" }} mb={4}>
            Round {result.round}
          </Text>
          <ResultLine result={result} myIndex={myIndex} />
        </Card>
      )}

      <Card withBorder radius="md" padding="lg" bg="dark.6">
        <Group justify="space-between" align="center" wrap="nowrap">
          <div>
            <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.14em" }}>
              Category
            </Text>
            <Text size="xl" fw={300} mt={4}>
              {category?.label}
            </Text>
          </div>
          <RingProgress
            size={78}
            thickness={5}
            roundCaps
            sections={[{ value: (remaining / ROUND_SECONDS) * 100, color: ringColor }]}
            label={
              <Center>
                <Text fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {remaining}
                </Text>
              </Center>
            }
          />
        </Group>
      </Card>

      {myPick ? (
        <Group gap="sm" justify="center">
          <Loader size="xs" color="azure" />
          <Text size="sm" c="dimmed">
            You picked <b style={{ color: "var(--mantine-color-gray-3)" }}>{myPick}</b> — waiting for opponent…
          </Text>
        </Group>
      ) : (
        <div>
          <TextInput
            placeholder="Search a valid player…"
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            autoFocus
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
        </div>
      )}

      {note && (
        <Text size="sm" c="red.5" ta="center">
          {note}
        </Text>
      )}

      <Group justify="center">
        <Button variant="subtle" color="gray" size="xs" onClick={leave}>
          Forfeit
        </Button>
      </Group>
    </Stack>
  );
}

function ScoreLine({ my, opp, compact }: { my: number; opp: number; compact?: boolean }) {
  return (
    <Group gap="xs" align="baseline">
      <Text fw={500} size={compact ? "lg" : "xl"} style={{ fontVariantNumeric: "tabular-nums" }}>
        {my}
      </Text>
      <Text c="dimmed" size="sm">
        you
      </Text>
      <Text c="dimmed" mx={4}>
        ·
      </Text>
      <Text fw={500} size={compact ? "lg" : "xl"} style={{ fontVariantNumeric: "tabular-nums" }}>
        {opp}
      </Text>
      <Text c="dimmed" size="sm">
        opp
      </Text>
    </Group>
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
  const color = result.replay ? "dimmed" : result.winnerIndex === myIndex ? "azure.4" : "gray.5";
  return (
    <Stack gap={4}>
      <Text size="sm">
        <Text span c="dimmed">
          You:{" "}
        </Text>
        {mine ? `${mine.playerName} (${mine.fameScore.toFixed(2)})` : "no pick"}
        <Text span c="dimmed">
          {"  ·  Opp: "}
        </Text>
        {opp ? `${opp.playerName} (${opp.fameScore.toFixed(2)})` : "no pick"}
      </Text>
      <Text size="sm" fw={600} c={color}>
        {outcome}
      </Text>
    </Stack>
  );
}
