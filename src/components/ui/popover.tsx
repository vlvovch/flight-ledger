"use client";

/*
 * The popover primitive — Base UI behavior, CSS anchoring.
 *
 * For composite popups that are NOT menus: content with nested interactive
 * elements (a remove button inside a row, an inline text input) that
 * menuitem semantics cannot hold and menu typeahead would fight. Base UI
 * supplies what every hand-rolled dropdown here lacked — outside-press
 * dismissal, Escape, focus moved in on open and returned on close.
 *
 * What Base UI does NOT supply here is the position. The deck is zoomed
 * (body { zoom: var(--ui-scale) }), and Floating UI's translate-based
 * placement breaks under CSS zoom: it measures rects in visual pixels,
 * writes a transform inside the zoomed body, and the browser scales that
 * transform AGAIN — measured live, a popup asked to sit above its trigger
 * landed 25% low at --ui-scale: 1.25. So the popup is portaled into the
 * TRIGGER'S own positioned wrapper and placed by plain CSS, exactly like
 * the hand-rolled dropdown it replaced — the same zoom-immunity choice the
 * dialog primitive makes by positioning with a fixed viewport. The caller
 * passes placement classes (e.g. "bottom-full left-0 mb-1 w-full"); the
 * Positioner's inline styles are neutralized with !important utilities,
 * and anchor tracking is off because there is nothing to track.
 */

import { useRef, type ReactNode } from "react";
import { Popover as BasePopover } from "@base-ui/react/popover";

export const Popover = BasePopover.Root;
export const PopoverTrigger = BasePopover.Trigger;

export function PopoverAnchorBox({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  /* the positioned wrapper the popup anchors to — render the Trigger and
     the PopoverContent inside it */
  return <div className={`relative ${className}`}>{children}</div>;
}

export function PopoverContent({
  placement,
  className = "",
  children,
}: {
  /** CSS placement relative to the anchor box, e.g. "bottom-full left-0 mb-1 w-full" */
  placement: string;
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      {/* the portal target lives inside the anchor box, so the popup shares
          every ancestor style — the zoom included — with its trigger */}
      <div ref={containerRef} className="contents" />
      <BasePopover.Portal container={containerRef}>
        <BasePopover.Positioner
          disableAnchorTracking
          className={`!absolute !top-auto !right-auto !transform-none z-50 ${placement}`}
        >
          <BasePopover.Popup
            className={`w-full overflow-hidden rounded-md border border-line2 bg-panel shadow-[0_12px_28px_var(--shadow-pop)] ${className}`}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </>
  );
}
