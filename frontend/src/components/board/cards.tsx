/**
 * Note cards — Hyperknow-exact styling.
 * Wobbly hand-drawn borders via feTurbulence filters, Virgil/Xiaolai fonts,
 * marker-highlight titles in Excalidraw purple.
 */
import { memo, useEffect, useRef, useState } from "react";
import { FONT_STACK, MARKER_HIGHLIGHT, EXCAL_PURPLE, wobbleFilterFor } from "./theme";

/* ------------------------------------------------------------------ */
/* Title with marker highlight                                         */
/* ------------------------------------------------------------------ */

export function BoardTitle({ children, color = EXCAL_PURPLE }: { children: string; color?: string }) {
  return (
    <span
      className="board-note-title inline-block px-0.5 font-normal"
      style={{ color, backgroundImage: MARKER_HIGHLIGHT, fontSize: 24, lineHeight: 1.3 }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Markdown-ish content → HTML (bold, italic, code, lists, tables)     */
/* ------------------------------------------------------------------ */

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mdToHtml(md: string): string {
  let html = escapeHtml(md);
  // tables (| a | b |)
  const lines = html.split("\n");
  const out: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inTable = false;
  let rowIdx = 0;

  const closeList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
      rowIdx = 0;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    // table row
    if (/^\|.*\|$/.test(line)) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^[-: ]+$/.test(c))) continue; // separator row
      if (!inTable) {
        out.push(
          '<table class="board-table" style="filter:url(&quot;#tblwob-r3-a&quot;)"><tbody>',
        );
        inTable = true;
        rowIdx = 0;
      }
      const tag = rowIdx === 0 ? "th" : "td";
      out.push(`<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`);
      rowIdx++;
      continue;
    }
    closeTable();

    if (/^(\d+)\.\s+/.test(line)) {
      if (inList !== "ol") {
        closeList();
        out.push('<ol class="my-1 pl-5" style="list-style: decimal">');
        inList = "ol";
      }
      out.push(`<li>${inline(line.replace(/^(\d+)\.\s+/, ""))}</li>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (inList !== "ul") {
        closeList();
        out.push('<ul class="my-1 pl-5" style="list-style: disc">');
        inList = "ul";
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else {
      closeList();
      if (line) out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  return out.join("\n");

  function inline(s: string): string {
    return s
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.06);padding:0 4px;border-radius:4px;font-size:0.9em">$1</code>')
      .replace(/==(.+?)==/g, '<mark style="background:linear-gradient(rgba(0,0,0,0) 55%, rgba(254,243,199,.9) 55%)">$1</mark>');
  }
}

/* ------------------------------------------------------------------ */
/* Note card                                                           */
/* ------------------------------------------------------------------ */

export interface NoteCardData {
  uid: number;
  content: string;
  title?: string;
  keypoint?: boolean;
  highlights: { snippet?: string; color?: string }[];
}

export const NoteCard = memo(function NoteCard({ card, animate }: { card: NoteCardData; animate?: boolean }) {
  const [revealed, setRevealed] = useState(!animate);
  useEffect(() => {
    if (animate) {
      const t = requestAnimationFrame(() => setRevealed(true));
      return () => cancelAnimationFrame(t);
    }
  }, [animate]);

  // apply highlight decorations
  let html = mdToHtml(card.content);
  for (const h of card.highlights) {
    if (h.snippet && html.includes(escapeHtml(h.snippet))) {
      html = html.replaceAll(
        escapeHtml(h.snippet),
        `<mark style="background:none;border-bottom:3px solid ${h.color ?? "#ef4444"};color:${h.color ?? "#ef4444"};padding:0 1px;">${escapeHtml(h.snippet)}</mark>`,
      );
    }
  }

  return (
    <div
      className={`relative z-10 isolate w-full box-border ${revealed ? "board-card-in" : "board-card-out"}`}
      style={{ padding: "6px 13px 4px", ["--board-body-fs" as string]: "20px", ["--board-title-fs" as string]: "24px" }}
    >
      <div
        className="board-card-frame relative"
        style={{ filter: wobbleFilterFor(card.uid, 6), fontFamily: FONT_STACK }}
      >
        {/* hand-drawn frame */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <rect
            x="1.5"
            y="1.5"
            width="calc(100% - 3px)"
            height="calc(100% - 3px)"
            rx="6"
            fill="#fffdf5"
            stroke="#3d3d3d"
            strokeWidth="1.4"
          />
        </svg>
        <div className="relative z-10 px-3 pb-1 pt-2" style={{ fontSize: 20, lineHeight: 1.45 }}>
          {card.title && (
            <div className="mb-1">
              <BoardTitle>{card.title}</BoardTitle>
            </div>
          )}
          <div className="board-md" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Mermaid diagram card                                                */
/* ------------------------------------------------------------------ */

export const MermaidCard = memo(function MermaidCard({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", fontFamily: FONT_STACK });
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, source);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          const el = ref.current.querySelector("svg");
          if (el) {
            el.style.maxWidth = "100%";
            el.style.height = "auto";
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  return (
    <div
      className="board-card-frame relative"
      style={{ filter: "url(#tblwob-r3-b)", fontFamily: FONT_STACK }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <rect x="1.5" y="1.5" width="calc(100% - 3px)" height="calc(100% - 3px)" rx="9" fill="#ffffffcc" stroke="#6b7280" strokeWidth="1.2" strokeDasharray="7 4" />
      </svg>
      <div className="relative z-10 p-4">
        {error ? <pre className="overflow-x-auto text-xs text-neutral-500">{source}</pre> : <div ref={ref} className="flex justify-center" />}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Image card                                                          */
/* ------------------------------------------------------------------ */

export function ImageCard({ src, caption }: { src: string; caption?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="board-card-frame relative" style={{ filter: "url(#tblwob-r9-c)", fontFamily: FONT_STACK }}>
      <div className="relative z-10 p-2">
        {!loaded && <div className="board-skeleton" style={{ height: 200 }} />}
        <img
          src={src}
          alt={caption ?? ""}
          onLoad={() => setLoaded(true)}
          style={{ display: loaded ? "block" : "none", width: "100%", borderRadius: 8 }}
        />
        {caption && (
          <div className="mt-1 text-center" style={{ fontSize: 18, color: "#78716c" }}>
            {caption}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Animation card (sandboxed iframe)                                   */
/* ------------------------------------------------------------------ */

export function AnimationCard({ html, height }: { html: string; height?: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  return (
    <div className="board-card-frame relative" style={{ filter: "url(#tblwob-r6-b)" }}>
      <iframe
        ref={ref}
        title="Interactive widget"
        srcDoc={html}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        style={{
          display: "block",
          width: "100%",
          height: height ?? 320,
          border: "none",
          borderRadius: 12,
          background: "#fcfcfc",
          pointerEvents: "auto",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quiz card                                                           */
/* ------------------------------------------------------------------ */

export function QuizCard({ question, options, onAnswer }: { question: string; options: string[]; onAnswer: (i: number) => void }) {
  return (
    <div className="board-card-frame relative" style={{ filter: "url(#tblwob-r6-a)", fontFamily: FONT_STACK }}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        <rect x="1.5" y="1.5" width="calc(100% - 3px)" height="calc(100% - 3px)" rx="9" fill="#fffbeb" stroke="#d97706" strokeWidth="1.4" />
      </svg>
      <div className="relative z-10 p-4" style={{ fontSize: 20 }}>
        <div className="mb-2" style={{ fontWeight: 600 }}>{question}</div>
        <div className="flex flex-wrap gap-2">
          {options.map((o, i) => (
            <button
              key={i}
              onClick={() => onAnswer(i)}
              className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 transition hover:border-amber-600"
              style={{ fontSize: 18, pointerEvents: "auto" }}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
