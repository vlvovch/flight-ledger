"use client";

/*
 * The dialog primitive — Base UI behavior wearing FlightLedger's clothes.
 *
 * This directory is the primitive layer (shadcn-style): generic interaction
 * machinery whose BEHAVIOR is somebody's full-time job — focus trapping and
 * restoration, topmost-only Escape in nested dialogs, reference-counted
 * scroll locking, press-origin outside-click detection, dialog ARIA — and
 * whose APPEARANCE is entirely this app's. Domain components (Panel,
 * StatCard, StatusChip, the forms) stay hand-made in src/components; only
 * behavior generic enough to have a spec lives here.
 *
 * The hand-rolled Modal this replaces had real holes the primitive closes:
 * no dialog role, no focus trap, no focus return — and with a Confirm
 * nested over a form, one Escape closed BOTH (two window listeners), while
 * the inner dialog's unmount unlocked page scroll under the outer one.
 *
 * Layout notes carried over from the old Modal, still binding:
 *  - the Viewport is the scroll container (fixed inset-0), the panel is
 *    capped to a PERCENTAGE of it and the CONTENT scrolls — a taller-than-
 *    screen dialog must not scroll its title and buttons away, and the cap
 *    is never dvh: the deck's --ui-scale zoom makes dvh resolve in unzoomed
 *    pixels and overflow the screen;
 *  - top-aligned (items-start), not centered: tall dialogs open at their
 *    head, and growing content doesn't re-center the view;
 *  - z-50, below the toast's z-[70].
 */

import type { ReactNode } from "react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";

export const Dialog = BaseDialog.Root;
export const DialogTitle = BaseDialog.Title;
export const DialogDescription = BaseDialog.Description;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  wide,
  children,
}: {
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(4,8,16,0.72)] backdrop-blur-[3px]" />
      <BaseDialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <BaseDialog.Popup
          className={`reveal panel my-4 flex max-h-[calc(100%_-_2rem)] w-full flex-col border-line2 bg-panel2 shadow-[0_24px_80px_var(--shadow-pop)] ${
            wide ? "max-w-3xl" : "max-w-xl"
          }`}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}
