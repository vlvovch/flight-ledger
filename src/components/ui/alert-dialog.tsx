"use client";

/*
 * The alert-dialog primitive — for questions that must be ANSWERED, not
 * clicked away. Base UI's AlertDialog differs from Dialog by design: no
 * outside-press dismissal (a mis-click near "Delete" must not silently
 * cancel — or worse, silently *look* cancelled), role="alertdialog", and
 * focus placed where the caller says. Escape still cancels: it is the
 * explicit "no". Visually identical to dialog.tsx — same viewport, same
 * panel, same cap; see the layout notes there.
 */

import type { ReactNode, RefObject } from "react";
import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";

export const AlertDialog = BaseAlertDialog.Root;
export const AlertDialogTitle = BaseAlertDialog.Title;
export const AlertDialogDescription = BaseAlertDialog.Description;
export const AlertDialogClose = BaseAlertDialog.Close;

export function AlertDialogContent({
  children,
  initialFocus,
}: {
  children: ReactNode;
  /** where focus lands on open — a Confirm points this at Cancel, so Enter
   *  never falls on the destructive verb by default */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop className="fixed inset-0 z-50 bg-[rgba(4,8,16,0.72)] backdrop-blur-[3px]" />
      <BaseAlertDialog.Viewport className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <BaseAlertDialog.Popup
          initialFocus={initialFocus}
          className="reveal panel my-4 flex max-h-[calc(100%_-_2rem)] w-full max-w-xl flex-col border-line2 bg-panel2 shadow-[0_24px_80px_var(--shadow-pop)]"
        >
          {children}
        </BaseAlertDialog.Popup>
      </BaseAlertDialog.Viewport>
    </BaseAlertDialog.Portal>
  );
}
