"use client";
// Who answers the assistant, as a short label for the composer ("Your Anthropic key",
// "OpenRouter · free", "Demo mode"), and whether web search is on offer (Claude only).
// Mirrors the order the server uses (src/lib/ai/keys.ts): the user's key, then the server's.
import { useEffect, useState } from "react";
import { useUserKeys } from "./byok";

type Status = { anthropic?: boolean; openrouter?: boolean };
let status: Promise<Status> | null = null;
const serverStatus = () => (status ??= fetch("/api/ai/status").then((r) => r.json()).catch(() => ({})));

export function useAiRoute() {
  const { keys } = useUserKeys();
  const [server, setServer] = useState<Status | null>(null);
  useEffect(() => { serverStatus().then(setServer); }, []);
  if (keys.anthropicKey) return { label: "Your Anthropic key", canSearchWeb: true };
  if (keys.openrouterKey) return { label: "Your OpenRouter key", canSearchWeb: false };
  if (!server) return { label: "", canSearchWeb: false };
  if (server.anthropic) return { label: "Claude", canSearchWeb: true };
  if (server.openrouter) return { label: "OpenRouter · free", canSearchWeb: false };
  return { label: "Demo mode", canSearchWeb: false };
}
