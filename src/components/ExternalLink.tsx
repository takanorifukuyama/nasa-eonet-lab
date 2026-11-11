import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useState } from 'react';
import type { AnchorHTMLAttributes } from 'react';

/** Keep sources in the user's browser instead of navigating the desktop app. */
export default function ExternalLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const [failed, setFailed] = useState(false);
  return <>
    <a {...props} href={href} target="_blank" rel="noopener noreferrer" onClick={async event => {
      if (!isTauri()) return;
      event.preventDefault();
      setFailed(false);
      try { await openUrl(href); }
      catch { setFailed(true); }
    }}>{children}</a>
    {failed && <span className="link-error" role="alert">ページを開けませんでした。もう一度お試しください。</span>}
  </>;
}
