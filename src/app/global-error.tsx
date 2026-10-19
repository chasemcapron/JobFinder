"use client";

// Replaces the root layout when it fails, so it brings its own document and cannot use the
// app's stylesheet. The hex values mirror the light/dark tokens in globals.css.
const css = `
  .ge { --bg:#f7f7f8; --surface:#ffffff; --fg:#18181b; --muted:#5f5f69; --border:#e4e4e7; --accent:#4f46e5; --accent-hover:#4338ca; --danger-bg:#fef3f2; --danger-fg:#b42318; --danger-border:#fecdca; }
  @media (prefers-color-scheme: dark) {
    .ge { --bg:#09090b; --surface:#111114; --fg:#ededf0; --muted:#a0a0ab; --border:#26262c; --accent:#5b5bf0; --accent-hover:#6d6ff3; --danger-bg:#331314; --danger-fg:#f97066; --danger-border:#5c1d1a; }
  }
  .ge { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  .ge-card { box-sizing:border-box; max-width:28rem; margin:16px; padding:32px 24px; text-align:center; background:var(--surface); border:1px solid var(--border); border-radius:12px; }
  .ge-icon { display:inline-grid; place-items:center; width:44px; height:44px; border-radius:9999px; background:var(--danger-bg); color:var(--danger-fg); border:1px solid var(--danger-border); font-weight:700; font-size:20px; }
  .ge h1 { margin:12px 0 4px; font-size:20px; font-weight:600; letter-spacing:-0.01em; }
  .ge p { margin:0; font-size:14px; color:var(--muted); }
  .ge button { margin-top:20px; padding:8px 16px; border-radius:8px; border:0; background:var(--accent); color:#fff; font:inherit; font-size:14px; font-weight:500; cursor:pointer; }
  .ge button:hover { background:var(--accent-hover); }
  .ge button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
`;

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body className="ge">
        <title>Error · Job Finder</title>
        <style>{css}</style>
        <div role="alert" className="ge-card">
          <span className="ge-icon" aria-hidden>
            !
          </span>
          <h1>Job Finder hit an unexpected error</h1>
          <p>Something went wrong while loading the app. Try again in a moment.</p>
          <button type="button" onClick={() => retry()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
