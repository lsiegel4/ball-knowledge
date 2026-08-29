import { useState, useEffect } from "react";
import {
  Card,
  Group,
  Stack,
  Text,
  Title,
  Badge,
  Divider,
  Center,
  Loader,
} from "@mantine/core";

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

  if (!data) {
    return (
      <Center py={60}>
        <Loader color="azure" size="sm" />
      </Center>
    );
  }

  const winRate = data.played ? Math.round((data.wins / data.played) * 100) : 0;

  return (
    <Stack gap="lg">
      <Card withBorder radius="md" padding="lg" bg="dark.6">
        <Text size="xl" fw={300} mb="md">
          @{data.handle}
        </Text>
        <Group gap={40}>
          <Stat label="Wins" value={data.wins} />
          <Stat label="Losses" value={data.losses} />
          <Stat label="Win rate" value={data.played ? `${winRate}%` : "—"} />
        </Group>
      </Card>

      <div>
        <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.14em" }} mb="xs">
          Recent matches
        </Text>
        {data.recent.length === 0 ? (
          <Text c="dimmed" size="sm">
            No matches yet. Head to Head-to-Head to play your first.
          </Text>
        ) : (
          <Card withBorder radius="md" padding={0} bg="dark.6">
            {data.recent.map((m, i) => (
              <div key={m.gameId}>
                {i > 0 && <Divider color="dark.5" />}
                <Group justify="space-between" px="md" py="sm">
                  <Group gap="sm">
                    <Badge
                      variant="light"
                      color={m.won ? "azure" : "gray"}
                      radius="sm"
                      w={52}
                    >
                      {m.won ? "Win" : "Loss"}
                    </Badge>
                    <Text size="sm" c="dimmed">
                      vs @{m.oppHandle ?? "unknown"}
                    </Text>
                  </Group>
                  <Text size="sm" fw={500} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {m.myScore}–{m.oppScore}
                  </Text>
                </Group>
              </div>
            ))}
          </Card>
        )}
      </div>
    </Stack>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <Title order={2} fw={300} style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Title>
      <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: "0.1em" }}>
        {label}
      </Text>
    </div>
  );
}
