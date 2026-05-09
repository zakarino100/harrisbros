/**
 * Anthropic API client — no SDK dependency, just fetch.
 * Single chat() function returns text + token counts + estimated cost.
 *
 * Pricing (cents per million tokens) — kept here so we can audit cost over time.
 * Update on Anthropic price changes.
 */
const PRICING_CENTS_PER_M_TOKENS: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6":  { in: 300,  out: 1500 }, // $3 / $15 per million
  "claude-haiku-4-5":   { in: 80,   out: 400  }, // $0.80 / $4
  "claude-opus-4-7":    { in: 1500, out: 7500 }, // $15 / $75
};

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicChatRequest {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface AnthropicChatResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  stopReason: string | null;
  raw: any;
}

export async function anthropicChat(req: AnthropicChatRequest & { tenantId?: string }): Promise<AnthropicChatResult> {
  // Per-tenant API key for cost isolation; falls back to global key
  const tenantKey = req.tenantId
    ? process.env[`${req.tenantId.toUpperCase()}_ANTHROPIC_API_KEY`]
    : undefined;
  const apiKey = tenantKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const body = {
    model: req.model,
    system: req.system,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 700,
    temperature: req.temperature ?? 0.4,
    stop_sequences: req.stopSequences,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic ${res.status}: ${t}`);
  }
  const data = (await res.json()) as any;

  const text =
    Array.isArray(data?.content)
      ? data.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("")
      : "";

  const tokensIn = Number(data?.usage?.input_tokens ?? 0);
  const tokensOut = Number(data?.usage?.output_tokens ?? 0);
  const pricing = PRICING_CENTS_PER_M_TOKENS[req.model] ?? PRICING_CENTS_PER_M_TOKENS["claude-sonnet-4-6"];
  const costCents = Math.ceil(
    (tokensIn * pricing.in + tokensOut * pricing.out) / 1_000_000
  );

  return {
    text,
    model: req.model,
    tokensIn,
    tokensOut,
    costCents,
    stopReason: data?.stop_reason ?? null,
    raw: data,
  };
}
