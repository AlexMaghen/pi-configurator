/**
 * Sends the user back to the unlock screen when a device's session ends (disconnect, idle
 * timeout, reboot) while one of its screens is open, and keeps locked users out of device
 * screens they deep-linked into. Renders nothing.
 */
import { useEffect } from "react";
import { router, usePathname } from "expo-router";
import { useAppState } from "@/lib/session/AppProvider";

const DEVICE_PAGE = /^\/device\/([^/]+)\/(.+)$/;

export function SessionGuard() {
  const pathname = usePathname();
  const match = DEVICE_PAGE.exec(pathname);
  const id = match?.[1] ? decodeURIComponent(match[1]) : undefined;
  const page = match?.[2];
  const phase = useAppState((s) => (id ? s.sessions[id]?.phase : undefined));

  useEffect(() => {
    if (!id || page === "unlock" || phase === "unlocked") return;
    if (router.canDismiss()) router.dismissAll();
    router.push({ pathname: "/device/[id]/unlock", params: { id } });
  }, [id, page, phase]);

  return null;
}
