import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  // Known on the first render (2026-10-24): the dashboard lays out a different page on a
  // phone, and starting as "not mobile" would mount the desktop cards first, then swap.
  const [isMobile, setIsMobile] = React.useState(() => typeof window !== "undefined" ? window.innerWidth < MOBILE_BREAKPOINT : undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange);
  }, [])

  return !!isMobile
}
