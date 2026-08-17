"use client";

/*
 * Page-level error boundary: a page that throws lands here with the app
 * chrome still standing. Before this existed, any uncaught render error
 * became Next's bare "Application error" line on a dark void — accurate,
 * useless, and frightening.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="mx-auto mt-16 max-w-md">
      <div className="panel border-line2 bg-panel2 p-6 text-center">
        <div className="t-display mb-2 text-[19px] text-ink">
          This page hit an error
        </div>
        <p className="text-[13.5px] leading-relaxed text-ink2">
          Your data is safe; the page just failed to draw. If this keeps
          happening, check whether the app is open in another tab.
        </p>
        {error?.message && (
          <p className="mt-2 break-words text-[11px] text-mute">{error.message}</p>
        )}
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn btn-ghost" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
