"use client";

/*
 * The very last net: errors thrown by the root layout itself (the sidebar
 * lives there) land here, where no stylesheet is guaranteed — the layout
 * that imports globals.css is the thing that just crashed. Inline styles
 * only, and its own <html>/<body>, per the App Router contract.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a1120",
          color: "#c7d3e4",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 400, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 19, fontWeight: 600, color: "#eef3fa", marginBottom: 8 }}>
            Flight Ledger hit an error
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            Your data is safe; the app just failed to draw. If this keeps
            happening, check whether it is open in another tab, close that
            one, and reload.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #2b4162",
              background: "#16233c",
              color: "#eef3fa",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
