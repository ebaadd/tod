"use client";

import { GroupedInbox } from "./inbox-upgrade";

import { useEffect, useRef, useState } from "react";
import brand from "../../../config/brand.json";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Kind = "truth" | "dare";
type Item = {
  id: string;
  key: string;
  kind: Kind;
  text: string;
  createdAt: string;
};
type HistoryCursor = { key: string; kind: Kind } | null;

async function api<T>(path: string, method = "GET", data?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

function merge(a: Item[], b: Item[]) {
  return [...new Map([...a, ...b].map(item => [item.id, item])).values()];
}

function Choices({
  kind, onChange, disabled = false
}: {
  kind: Kind;
  onChange: (value: Kind) => void;
  disabled?: boolean;
}) {
  return (
    <div className="choices">
      {(["truth", "dare"] as const).map(value => (
        <button
          key={value}
          type="button"
          disabled={disabled}
          aria-pressed={value === kind}
          className={`choice ${value === kind ? "active" : ""}`}
          onClick={() => onChange(value)}
        >
          <span aria-hidden="true">{value === "truth" ? "💬" : "⚡"}</span>
          {value === "truth" ? "Give the truth" : "Keep the dare coming"}
        </button>
      ))}
    </div>
  );
}

export function Home() {
  return (
    <section className="hero panel">
      <span className="eyebrow">{brand.name} · Anonymous Truth or Dare</span>
      <h1>Let curiosity<br />take over.</h1>
      <p className="muted">{brand.tagline}</p>
      <a className="primary" href="/account">Create my link ✦</a>
      <p className="muted">Your next story starts with a question.</p>
    </section>
  );
}

export function Account() {
  const [signup, setSignup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <>
      <section className="hero">
        <span className="eyebrow">Your link. Their curiosity.</span>
        <h1>{signup ? "Start something fun." : "Welcome back."}</h1>
      </section>
      <form className="panel stack" onSubmit={async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        setError("");
        try {
          await api(`/auth/${signup ? "signup" : "login"}`, "POST", data);
          window.location.assign("/dashboard");
        } catch (error) {
          setError(errorMessage(error));
        } finally {
          setBusy(false);
        }
      }}>
        {signup && <>
          <label>Your name
            <input name="name" autoComplete="name" required maxLength={80} />
          </label>
          <label>Your username
            <input
              name="username"
              autoComplete="username"
              pattern="[a-z0-9_]{3,30}"
              title="3–30 lowercase letters, numbers or underscores"
              placeholder="your_username"
              required
            />
          </label>
        </>}
        <label>Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>Password
          <input
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 10 : 1}
            maxLength={128}
            required
          />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "One moment…" : signup ? "Create my link ✦" : "Sign in"}
        </button>
        <button className="link" type="button" disabled={busy} onClick={() => {
          setSignup(!signup);
          setError("");
        }}>
          {signup ? "Already have an account? Sign in" : "Create an account"}
        </button>
      </form>
    </>
  );
}

export function PublicPage({ username }: { username: string }) {
  const path = `/public/${encodeURIComponent(username)}`;
  const [kind, setKind] = useState<Kind>("truth");
  const [text, setText] = useState("");
  const [remember, setRemember] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<HistoryCursor>(null);
  const pending = useRef<{
    kind: Kind; text: string; requestId: string; requestedAt: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await api<{ remembering: boolean }>(path);
      if (!active) return;
      setRemember(result.remembering);
      if (result.remembering) {
        const history = await api<{ items: Item[]; cursor: HistoryCursor }>(
          `${path}/history`
        );
        if (!active) return;
        setItems(history.items);
        setCursor(history.cursor);
      }
      setReady(true);
    })().catch(error => {
      if (active) setError(errorMessage(error));
    });
    return () => { active = false; };
  }, [path]);

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await work(); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <section className="hero">
        <span className="eyebrow">@{username}</span>
        <h1>A little truth.<br />A little trouble.</h1>
        <p className="muted">They see your message, not your identity.</p>
      </section>
      <form className="panel stack" onSubmit={event => {
        event.preventDefault();
        if (!ready || busy) return;
        void action(async () => {
          const value = text.trim();
          if (!pending.current ||
              pending.current.kind !== kind ||
              pending.current.text !== value ||
              Date.now() - Date.parse(pending.current.requestedAt) > 540000) {
            pending.current = {
              kind,
              text: value,
              requestId: crypto.randomUUID(),
              requestedAt: new Date().toISOString()
            };
          }
          const result = await api<{ submission: Item }>(
            `${path}/submissions`, "POST", pending.current
          );
          if (remember) setItems(old => merge([result.submission], old));
          pending.current = null;
          setText("");
          setSent(true);
        });
      }}>
        <Choices kind={kind} onChange={setKind} disabled={busy} />
        <label>
          {kind === "truth" ? "What do you want to ask?" : "What's the challenge?"}
          <textarea
            value={text}
            maxLength={500}
            required
            disabled={busy}
            placeholder={kind === "truth"
              ? "What's something nobody knows about you?"
              : "Show us your most dramatic dance move."}
            onChange={event => {
              setText(event.target.value);
              setSent(false);
            }}
          />
        </label>
        <div className="row muted">
          <span>No name attached</span><span>{text.length}/500</span>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            disabled={!ready || busy}
            onChange={event => {
              const enabled = event.target.checked;
              if (!enabled && !window.confirm(
                "Forget history access on this browser? Messages stay in the recipient's inbox."
              )) return;
              void action(async () => {
                await api("/visitor/remember", "POST", { enabled });
                setRemember(enabled);
                setItems([]);
                setCursor(null);
              });
            }}
          />
          <span>
            Remember my submissions on this device
            <small className="muted">
              Uses a cookie. Others using this browser may see your history.
            </small>
          </span>
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        {sent && <div className="success" role="status">Sent anonymously ✨</div>}
        <button className="primary" disabled={!ready || busy || !text.trim()}>
          {busy ? "One moment…" : "Send anonymously →"}
        </button>
        {sent && <a href="/account">Your turn. Create your own link ↗</a>}
      </form>

      {remember && <section className="section">
        <h2>Your previous submissions</h2>
        <p className="muted">
          Removing history does not retract a message from their inbox.
        </p>
        {!items.length && <p className="muted">Nothing here yet.</p>}
        {items.map(item => (
          <article className="question" key={item.id}>
            <span className="eyebrow">{item.kind}</span>
            <p>{item.text}</p>
            <button className="link" disabled={busy} onClick={() => {
              void action(async () => {
                await api(`${path}/history`, "DELETE", {
                  key: item.key, kind: item.kind
                });
                setItems(old => old.filter(entry => entry.id !== item.id));
              });
            }}>Remove from my history</button>
          </article>
        ))}
        {cursor && <button
          className="secondary section"
          disabled={busy}
          onClick={() => {
            void action(async () => {
              const result = await api<{ items: Item[]; cursor: HistoryCursor }>(
                `${path}/history?cursor=${encodeURIComponent(cursor.key)}&cursorKind=${cursor.kind}`
              );
              setItems(old => merge(old, result.items));
              setCursor(result.cursor);
            });
          }}
        >Load older submissions</button>}
      </section>}
    </>
  );
}


export function Dashboard() {
  return <GroupedInbox />;
}
