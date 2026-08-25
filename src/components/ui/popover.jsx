import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        // CHANGED: added max-h-[var(--radix-popover-content-available-height)] +
        // overflow-y-auto -- Radix exposes this CSS var specifically so popover
        // content can cap itself to whatever room is actually left on screen
        // (per Radix's own docs for this exact scenario). Without it, a popover
        // opened near the bottom of a mobile viewport (e.g. a staff picker inside
        // a bottom Sheet) could render taller than the visible area with no way
        // to reach the rest of the list -- an inner max-h-72/overflow-y-auto div
        // alone isn't enough if the *outer* popover itself already extends past
        // the viewport. Applies globally since it's additive/harmless: it only
        // ever shrinks content that wouldn't otherwise fit, never affects popovers
        // that already fit on screen.
        "z-50 w-72 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props} />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
