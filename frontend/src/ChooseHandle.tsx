import { useState } from "react";
import { Card, Stack, Title, Text, TextInput, Button } from "@mantine/core";

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
  const touched = value.length > 0;

  const submit = async (e: React.FormEvent) => {
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
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card withBorder radius="md" padding="lg" bg="dark.6">
      <form onSubmit={submit}>
        <Stack>
          <div>
            <Title order={3} fw={400}>
              Pick a handle
            </Title>
            <Text size="sm" c="dimmed" mt={4}>
              3–20 characters: letters, numbers, underscore. This is permanent.
            </Text>
          </div>
          <TextInput
            placeholder="handle"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            leftSection={<Text c="dimmed">@</Text>}
            error={touched && !valid ? "Invalid format" : error || undefined}
            data-autofocus
          />
          <Button type="submit" loading={busy} disabled={!valid} fullWidth>
            Claim handle
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
