import { useState } from "react";
import { api, type MePayload } from "../lib/api";

interface Props {
  me: MePayload;
  onAuthed: () => void;
}

export function Login({ me, onAuthed }: Props) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.login(password);
      if (!r.ok) {
        setError(r.error || "Wrong password.");
        setSubmitting(false);
        return;
      }
      onAuthed();
    } catch (err: any) {
      setError(err?.body?.error || "Wrong password.");
      setSubmitting(false);
    }
  }

  const brand = me.tenant.brandColor;

  return (
    <div className="relative z-10 min-h-screen flex items-center justify-center px-5 py-12">
      <form
        onSubmit={submit}
        className="surface w-full max-w-sm p-7 sm:p-8 text-center"
      >
        <div
          className="mx-auto w-12 h-12 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: brand, boxShadow: `0 12px 36px -12px ${brand}80` }}
        >
          <span className="text-black font-[family-name:var(--font-display)] font-bold text-lg">🌊</span>
        </div>

        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight mb-1">
          {me.tenant.name}
        </h1>
        <p className="text-xs text-[var(--color-text-muted)] mb-6">
          Lead Command · <span style={{ color: brand }}>Swell</span> by Blue Ocean
        </p>

        <input
          className="input mb-3"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && (
          <div className="text-xs text-red-400 mb-3 -mt-1 text-left pl-1">{error}</div>
        )}

        <button
          type="submit"
          disabled={submitting || !password}
          className="w-full mt-1 py-2.5 rounded-lg font-bold text-black text-sm tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-px active:translate-y-0"
          style={{ background: '#fbbf24', boxShadow: '0 1px 0 rgba(0,0,0,0.4), 0 8px 24px -8px rgba(251,191,36,0.4)' }}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-6 text-[10px] text-[var(--color-text-faint)] uppercase tracking-widest">
          {me.tenant.slug}.nopressurelaunch.com
        </p>
      </form>
    </div>
  );
}
