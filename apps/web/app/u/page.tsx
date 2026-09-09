"use client";

import { useEffect, useState } from "react";
import { PublicPage } from "../ui";

// A static export cannot pre-render /u/<username> because usernames are not
// known at build time. CloudFront serves this one page for every /u/* path and
// the username is read from the URL in the browser.
export default function Page() {
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const segments = window.location.pathname.split("/").filter(Boolean);
    setUsername(segments[1] ?? "");
  }, []);

  if (username === null) {
    return <p className="muted">Loading…</p>;
  }

  return <PublicPage key={username} username={username} />;
}
