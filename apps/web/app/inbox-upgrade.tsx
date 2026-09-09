"use client";

import { useEffect, useRef, useState } from "react";
import brand from "../../../config/brand.json";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Kind = "truth" | "dare";
type Group = {
  id: string;
  kind: Kind;
  text: string;
  count: number;
  processing: boolean;
  latestAt: string;
};
type Variant = { id: string; text: string; createdAt: string };
type Page = { items: Group[]; nextOffset: number | null };
type VariantPage = { items: Variant[]; nextOffset: number | null };

async function api<T>(
  path: string,
  method = "GET"
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: "include",
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed.");
  return result;
}

const describe = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

function merge<T extends { id: string }>(a: T[], b: T[]) {
  return [...new Map([...a, ...b].map(item => [item.id, item])).values()];
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;

      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
      }

      if (context.measureText(word).width <= maxWidth) {
        line = word;
      } else {
        // Preserve combining sequences when splitting unusually long words.
        const Segmenter = (Intl as any).Segmenter;
        const segments: string[] = Segmenter
          ? Array.from(
              new Segmenter(undefined, { granularity: "grapheme" }).segment(word),
              (entry: any) => entry.segment
            )
          : Array.from(word);

        for (const segment of segments) {
          if (line && context.measureText(line + segment).width > maxWidth) {
            lines.push(line);
            line = segment;
          } else {
            line += segment;
          }
        }
      }
    }

    lines.push(line);
  }

  return lines.length ? lines : [""];
}

async function renderSticker(kind: Kind, text: string): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser cannot create images.");

  const font = '700 48px system-ui, -apple-system, "Noto Sans Devanagari", sans-serif';
  context.font = font;
  const lines = wrapText(context, text, 820);

  const cardHeight = 160 + Math.max(1, lines.length) * 68 + 130;
  canvas.height = cardHeight + 120;

  // Canvas resizing resets its drawing state.
  context.clearRect(0, 0, canvas.width, canvas.height);

  const x = 60;
  const y = 60;
  const width = 960;

  context.save();
  context.shadowColor = "rgba(44, 17, 62, 0.16)";
  context.shadowBlur = 26;
  context.shadowOffsetY = 10;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(x, y, width, cardHeight, 44);
  context.fill();
  context.restore();

  context.save();
  context.beginPath();
  context.roundRect(x, y, width, cardHeight, 44);
  context.clip();

  const gradient = context.createLinearGradient(x, y, x + width, y + 130);
  gradient.addColorStop(0, brand.colors.primary);
  gradient.addColorStop(0.55, brand.colors.secondary);
  gradient.addColorStop(1, brand.colors.accent);
  context.fillStyle = gradient;
  context.fillRect(x, y, width, 126);
  context.restore();

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.font = "800 33px system-ui, sans-serif";
  context.fillText(kind === "truth" ? "TELL THE TRUTH" : "TAKE THE DARE", 540, 123);

  context.fillStyle = "#2b2139";
  context.font = font;
  lines.forEach((line, index) => {
    context.fillText(line, 540, y + 185 + index * 68);
  });

  context.fillStyle = "#84738f";
  context.font = "700 25px system-ui, sans-serif";
  context.fillText(`${brand.name} · asked anonymously`, 540, y + cardHeight - 48);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error("PNG creation failed.")),
      "image/png"
    );
  });
}

function StickerStudio({
  kind,
  initialText,
  onClose
}: {
  kind: Kind;
  initialText: string;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [image, setImage] = useState<{
    url: string;
    file: File;
    text: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [shareSupported, setShareSupported] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setError("");
    setShareSupported(false);

    if (!text.trim()) return;

    const timer = setTimeout(() => {
      void renderSticker(kind, text.trim()).then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const file = new File(
          [blob],
          `${brand.name.toLowerCase()}-${kind}.png`,
          { type: "image/png" }
        );

        setImage({ url: objectUrl, file, text });
        try {
          setShareSupported(
            Boolean(navigator.canShare?.({ files: [file] }))
          );
        } catch {
          setShareSupported(false);
        }
      }).catch(error => {
        if (!cancelled) setError(describe(error));
      });
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, text]);

  const ready = Boolean(image && image.text === text && text.trim());

  return (
    <section className="studio" aria-label="Question sticker creator">
      <div className="row">
        <div>
          <span className="eyebrow">Story-ready PNG</span>
          <h2>Create your sticker</h2>
        </div>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      <label>
        Sticker wording
        <textarea
          value={text}
          maxLength={500}
          onChange={event => setText(event.target.value)}
        />
      </label>

      <div className="sticker-checker">
        {ready && image ? (
          <img
            className="sticker-preview"
            src={image.url}
            alt={`Preview: ${text}`}
          />
        ) : (
          <p className="muted" role="status">
            {text.trim() ? "Creating preview…" : "Enter a question."}
          </p>
        )}
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      <div className="studio-actions">
        {ready && image ? (
          <a
            className="primary"
            href={image.url}
            download={image.file.name}
          >
            Download PNG ↓
          </a>
        ) : (
          <button className="primary" disabled>Download PNG ↓</button>
        )}

        {shareSupported && (
          <button
            className="secondary"
            disabled={!ready || sharing}
            onClick={async () => {
              if (!image || !ready) return;
              setError("");
              setSharing(true);
              try {
                // File already exists, preserving the browser's user gesture.
                await navigator.share({ files: [image.file] });
              } catch (error) {
                if (!(error instanceof Error && error.name === "AbortError")) {
                  setError("Sharing is unavailable. Download the PNG instead.");
                }
              } finally {
                setSharing(false);
              }
            }}
          >
            Share image ↗
          </button>
        )}
      </div>

      <p className="muted">
        Add this PNG over your photo or video inside Instagram.
        Availability depends on your device and Instagram version.
        We do not upload or store your media.
      </p>
    </section>
  );
}

function QuestionRow({
  group,
  onSticker
}: {
  group: Group;
  onSticker: (kind: Kind, text: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load(offset = 0) {
    setBusy(true);
    setError("");
    try {
      const result = await api<VariantPage>(
        `/inbox/groups/${group.id}/variants?offset=${offset}`
      );
      setVariants(old => offset ? merge(old, result.items) : result.items);
      setNextOffset(result.nextOffset);
    } catch (error) {
      setError(describe(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="inbox-entry">
      <div className="inbox-grid">
        <div className="question-cell">
          <div className={`type-dot ${group.kind}`} aria-hidden="true">
            {group.kind === "truth" ? "?" : "↯"}
          </div>
          <div className="question-copy">
            <p>{group.text}</p>
            <span className="muted">
              {new Date(group.latestAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric"
              })}
              {group.processing ? " · Organizing…" : ""}
            </span>
          </div>
        </div>

        <button
          className="count-pill"
          aria-expanded={expanded}
          aria-controls={`variants-${group.id}`}
          disabled={busy}
          onClick={() => {
            const open = !expanded;
            setExpanded(open);
            if (open) void load();
          }}
        >
          {group.count} {group.count === 1 ? "submission" : "submissions"}
          <span aria-hidden="true"> {expanded ? "⌃" : "⌄"}</span>
        </button>

        <button
          className="sticker-button"
          onClick={() => onSticker(group.kind, group.text)}
        >
          Create sticker ↗
        </button>
      </div>

      {expanded && (
        <div className="variants" id={`variants-${group.id}`}>
          <span className="eyebrow">Original submissions</span>
          {error && <p className="error" role="alert">{error}</p>}
          {variants.map(variant => (
            <div className="variant" key={variant.id}>
              <p>{variant.text}</p>
              <button
                className="link"
                onClick={() => onSticker(group.kind, variant.text)}
              >
                Use this wording
              </button>
            </div>
          ))}
          {busy && <p className="muted" role="status">Loading…</p>}
          {!busy && !variants.length && (
            <p className="muted">The inbox changed. Refresh to see the latest group.</p>
          )}
          {nextOffset !== null && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void load(nextOffset)}
            >
              More variants
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function GroupedInbox() {
  const [user, setUser] = useState<{
    name: string;
    username: string;
  } | null>(null);
  const [kind, setKind] = useState<Kind>("truth");
  const [items, setItems] = useState<Group[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [origin, setOrigin] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [sticker, setSticker] = useState<{
    kind: Kind;
    text: string;
    key: number;
  } | null>(null);
  const studioRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setItems([]);
    setNextOffset(null);

    void (async () => {
      const account = await api<{
        user: { name: string; username: string }
      }>("/auth/me");
      const page = await api<Page>(`/inbox/groups?kind=${kind}`);

      if (!active) return;
      setUser(account.user);
      setItems(page.items);
      setNextOffset(page.nextOffset);
      setLoading(false);
    })().catch(error => {
      if (active) {
        setError(describe(error));
        setLoading(false);
      }
    });

    return () => { active = false; };
  }, [kind, refresh]);

  useEffect(() => {
    if (sticker) {
      studioRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }, [sticker]);

  function createSticker(type: Kind, text: string) {
    setSticker({ kind: type, text, key: Date.now() });
  }

  return (
    <div className="modern-inbox">
      <section className="inbox-hero">
        <span className="eyebrow">Your private inbox</span>
        <h1>{user ? `Hey, ${user.name}.` : "Your next story."}</h1>
        <p className="muted">
          A little curiosity. A little chaos. Pick your next question.
        </p>
      </section>

      {error && (
        <div className="error" role="alert">
          {error} <a href="/account">Sign in</a>
        </div>
      )}

      {user && (
        <section className="share-strip">
          <div>
            <span className="eyebrow">Your public link</span>
            <a href={`/u/${user.username}`} className="break">
              {origin}/u/{user.username}
            </a>
          </div>
          <button
            className="primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  `${origin}/u/${user.username}`
                );
                setNotice("Link copied. Add it to your Instagram Story link sticker.");
              } catch {
                setNotice("Copy is unavailable. Copy your public link manually.");
              }
            }}
          >
            Copy link ↗
          </button>
        </section>
      )}

      {notice && <p className="muted" role="status">{notice}</p>}

      <div className="inbox-toolbar">
        <div className="inbox-tabs" aria-label="Question category">
          {(["truth", "dare"] as const).map(value => (
            <button
              key={value}
              disabled={moreBusy}
              aria-pressed={kind === value}
              className={kind === value ? "selected" : ""}
              onClick={() => setKind(value)}
            >
              {value === "truth" ? "💬 Truth" : "⚡ Dare"}
            </button>
          ))}
        </div>
        <button
          className="secondary"
          disabled={loading || moreBusy}
          onClick={() => setRefresh(value => value + 1)}
        >
          Refresh
        </button>
      </div>

      <div className="inbox-table">
        <div className="inbox-head inbox-grid" aria-hidden="true">
          <span>QUESTION</span>
          <span>RECEIVED</span>
          <span>ACTION</span>
        </div>

        {loading && <p className="inbox-empty" role="status">Loading your inbox…</p>}

        {!loading && !error && !items.length && (
          <div className="inbox-empty">
            <h2>Your next story starts here.</h2>
            <p className="muted">Share your link to receive your first {kind}.</p>
          </div>
        )}

        {items.map(group => (
          <QuestionRow
            key={`${group.id}:${group.count}`}
            group={group}
            onSticker={createSticker}
          />
        ))}
      </div>

      {items.some(item => item.processing) && (
        <p className="muted">
          New questions are available immediately. Similar ones combine after
          background processing—use Refresh to see the latest results.
        </p>
      )}

      {nextOffset !== null && (
        <button
          className="secondary section"
          disabled={moreBusy || loading}
          onClick={async () => {
            setMoreBusy(true);
            try {
              const page = await api<Page>(
                `/inbox/groups?kind=${kind}&offset=${nextOffset}`
              );
              setItems(old => merge(old, page.items));
              setNextOffset(page.nextOffset);
            } catch (error) {
              setError(describe(error));
            } finally {
              setMoreBusy(false);
            }
          }}
        >
          {moreBusy ? "Loading…" : "Load older questions"}
        </button>
      )}

      {sticker && (
        <div ref={studioRef} className="section">
          <StickerStudio
            key={sticker.key}
            kind={sticker.kind}
            initialText={sticker.text}
            onClose={() => setSticker(null)}
          />
        </div>
      )}

      {user && (
        <button
          className="link section"
          onClick={async () => {
            try {
              await api("/auth/logout", "POST");
              window.location.assign("/account");
            } catch (error) {
              setError(describe(error));
            }
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );
}
