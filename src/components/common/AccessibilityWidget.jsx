/**
 * Bundly — Accessibility menu widget.
 *
 * Mounted once at app root. Persists user preferences in localStorage so
 * the chosen adjustments survive page reloads. Toggles classes on the
 * <html> element which are picked up by CSS rules in index.css.
 *
 * Complies with Israeli law (תקנות שוויון זכויות לאנשים עם מוגבלות,
 * תשע״ג-2013, סעיף 35) and WCAG 2.0 AA — the menu itself is
 * keyboard-navigable, has labelled controls, and never blocks the page.
 */

import { useEffect, useState } from "react";

const FEATURES = [
  { key: "a11y-large",          label: "טקסט גדול",         icon: "A+" },
  { key: "a11y-xlarge",         label: "טקסט גדול מאוד",    icon: "A++" },
  { key: "a11y-high-contrast",  label: "ניגודיות גבוהה",     icon: "◐"  },
  { key: "a11y-grayscale",      label: "גווני אפור",         icon: "◑"  },
  { key: "a11y-underline-links", label: "הדגשת קישורים",     icon: "_"  },
  { key: "a11y-reduce-motion",  label: "עצירת אנימציות",     icon: "⏸"  },
  { key: "a11y-big-cursor",     label: "סמן עכבר מוגדל",     icon: "🖱"  },
];

// Only one font-size feature at a time
const EXCLUSIVE_GROUPS = [
  ["a11y-large", "a11y-xlarge"],
  ["a11y-high-contrast", "a11y-grayscale"],
];

const STORAGE_KEY = "bundly_a11y_v1";

function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}
function savePrefs(set) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set])); } catch {}
}

function applyToHtml(set) {
  const root = document.documentElement;
  // Remove all known classes first to avoid stale state
  for (const f of FEATURES) root.classList.remove(f.key);
  // Apply current
  for (const cls of set) root.classList.add(cls);
}

export default function AccessibilityWidget() {
  const [open, setOpen]   = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);

  // Re-apply whenever prefs change + on mount
  useEffect(() => {
    applyToHtml(prefs);
    savePrefs(prefs);
  }, [prefs]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = (key) => {
    setPrefs(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Enforce exclusive groups (font sizes, contrast modes)
        for (const group of EXCLUSIVE_GROUPS) {
          if (group.includes(key)) {
            for (const g of group) next.delete(g);
          }
        }
        next.add(key);
      }
      return next;
    });
  };

  const reset = () => setPrefs(new Set());

  // Speech synthesis — read the selected text aloud (Web Speech API)
  const readSelection = () => {
    try {
      const text = window.getSelection?.()?.toString().trim();
      if (!text) {
        alert("בחר טקסט במסך ולחץ שוב על 'הקראת טקסט'");
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "he-IL";
      u.rate = 0.95;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  };

  // Skip-to-content: the app has 14 different <main> tags per route. Instead
  // of forcing all of them to share an id, we hand the link a click handler
  // that finds the first visible <main> and moves focus + scroll to it.
  const handleSkip = (e) => {
    e.preventDefault();
    const main = document.querySelector("main");
    if (!main) return;
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: false });
    main.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      {/* Skip-to-content link — keyboard-only, jumps over the navbar */}
      <a href="#main" className="bundly-skip-link" onClick={handleSkip}>דלג לתוכן הראשי</a>

      {/* Toggle button — bottom-LEFT corner in RTL (insetInlineEnd = left in RTL).
          The chat advisor lives bottom-right (insetInlineStart), so we sit on the
          opposite corner and never overlap it. We clear the mobile bottom nav
          (~64px tall) plus a small breathing margin. Discreet styling: 40px disc,
          low default opacity, no white border ring. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "סגור תפריט נגישות" : "פתח תפריט נגישות"}
        aria-expanded={open}
        aria-haspopup="true"
        title="נגישות"
        style={{
          position: "fixed",
          insetInlineEnd: 10,                          // LTR: right; RTL: left
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 78px)", // above mobile nav
          zIndex: 9998,
          width: 40,
          height: 40,
          borderRadius: 20,
          background: "rgba(126, 34, 206, 0.78)",
          color: "#fff",
          fontSize: 17,
          fontWeight: 900,
          border: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          opacity: 0.62,
          transition: "opacity 0.15s ease",
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = "0.62"; }}
      >
        ♿
      </button>

      {/* Menu panel */}
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 9996, background: "rgba(0,0,0,0.25)" }}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label="הגדרות נגישות"
            dir="rtl"
            style={{
              position: "fixed",
              insetInlineEnd: 10,
              bottom: "calc(env(safe-area-inset-bottom, 0px) + 128px)", // sit above the toggle
              zIndex: 9997,
              width: 280,
              maxWidth: "calc(100vw - 24px)",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.1)",
              padding: 16,
              fontFamily: "Rubik, -apple-system, sans-serif",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "#1f2937" }}>
                ♿ הגדרות נגישות
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="סגור"
                style={{
                  background: "transparent", border: "none", fontSize: 20,
                  cursor: "pointer", color: "#6b7280", padding: 4,
                }}
              >×</button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {FEATURES.map(f => {
                const active = prefs.has(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggle(f.key)}
                    aria-pressed={active}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      padding: "10px 6px",
                      borderRadius: 10,
                      border: active ? "2px solid #7e22ce" : "1px solid #e5e7eb",
                      background: active ? "#faf5ff" : "#fff",
                      color: active ? "#581c87" : "#374151",
                      fontWeight: active ? 800 : 600,
                      fontSize: 12,
                      cursor: "pointer",
                      minHeight: 64,
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{f.icon}</span>
                    <span>{f.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={readSelection}
              style={{
                width: "100%",
                marginTop: 8,
                padding: "10px",
                borderRadius: 10,
                border: "1px solid #c084fc",
                background: "#faf5ff",
                color: "#581c87",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              🔊 הקראת טקסט מסומן
            </button>

            <button
              type="button"
              onClick={reset}
              style={{
                width: "100%",
                marginTop: 6,
                padding: "8px",
                borderRadius: 10,
                border: "none",
                background: "#f3f4f6",
                color: "#6b7280",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ↺ איפוס הגדרות
            </button>

            <a
              href="/accessibility.html"
              target="_blank"
              rel="noopener"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 10,
                fontSize: 11,
                color: "#7e22ce",
                textDecoration: "underline",
              }}
            >
              הצהרת נגישות מלאה →
            </a>
          </div>
        </>
      )}
    </>
  );
}
