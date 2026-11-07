import { initBotId } from "botid/client/core";
import { BOTID_ROUTES } from "@/lib/botidRoutes";

// Vercel BotID: an invisible challenge that proves AI requests come from a real
// browser. It runs before the app hydrates and never shows the user anything.
initBotId({ protect: BOTID_ROUTES });
