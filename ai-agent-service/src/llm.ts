import OpenAI from "openai";
import { parsedIntentSchema, type ParsedIntent } from "./schemas.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const SYSTEM = `You are SendR's intent parser. Output ONLY valid JSON matching this shape:
- Register name for wallet (user signs tx): {"kind":"admin","action":"REGISTER_USERNAME","username":"lowercase_no_at"}
- Payment send to one user: {"kind":"payment","action":"SEND_SINGLE","amount":number,"recipient":"username without @"}
- Payment to group (same USDC each member): {"kind":"payment","action":"SEND_TO_GROUP","perRecipientAmount":number,"groupName":"string"}
- Split total USDC across a group (payGroupSplit): {"kind":"payment","action":"GROUP_SPLIT_TOTAL","amount":number,"groupName":"string"}
- Split total equally: {"kind":"payment","action":"SPLIT_EQUAL","amount":number,"members":["user1","user2",...] without @}
- Approve USDC for SendrPay: {"kind":"admin","action":"APPROVE_USDC","amount":number}
- Add members to group by id: {"kind":"admin","action":"ADD_MEMBERS","groupId":number,"members":["u1","u2"]}
- Remove members: {"kind":"admin","action":"REMOVE_MEMBERS","groupId":number,"members":["u1"]}
- Cancel group: {"kind":"admin","action":"CANCEL_GROUP","groupId":number}
- Create group: {"kind":"admin","action":"CREATE_GROUP","groupName":"string","members":["u1","u2"]}
- List groups: {"kind":"admin","action":"LIST_GROUPS"}
- Help: {"kind":"admin","action":"HELP"}
- If unclear: {"kind":"unknown","rawSummary":"short reason"}

Rules: amounts are USDC (user may say dollars or $ — use the number). Usernames: a–z 0–9 only, 3–32 chars, no @ in JSON.`;

/** Groq exposes an OpenAI-compatible Chat Completions API. */
export function createGroqClient(): OpenAI | null {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: GROQ_BASE_URL,
  });
}

export async function parseWithLlm(
  client: OpenAI,
  userMessage: string,
): Promise<ParsedIntent> {
  const model =
    process.env.GROQ_CHAT_MODEL?.trim() || "llama-3.3-70b-versatile";
  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    return { kind: "unknown", rawSummary: "empty model response" };
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "unknown", rawSummary: "invalid json from model" };
  }
  const parsed = parsedIntentSchema.safeParse(data);
  if (!parsed.success) {
    return { kind: "unknown", rawSummary: parsed.error.message };
  }
  return parsed.data;
}
