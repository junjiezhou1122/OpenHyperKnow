import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  // LLM provider (passed to pi as --provider flag)
  defaultProvider: process.env.DEFAULT_PROVIDER ?? "anthropic",
  defaultModel: process.env.DEFAULT_MODEL ?? "claude-sonnet-4-5",
  // CORS
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  // Storage (optional - can run without DB in dev)
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
};
