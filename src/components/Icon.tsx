import type { ReactNode, SVGProps } from 'react';

type Name = 'search' | 'refresh' | 'external' | 'close' | 'globe' | 'map' | 'list' | 'info' | 'locate' | 'arrow';
const paths: Record<Name, ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" /></>,
  external: <><path d="M14 4h6v6M20 4 10 14" /><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18M5 7h14M5 17h14" /></>,
  map: <><path d="m9 4-6 3v14l6-3 6 3 6-3V4l-6 3-6-3Z" /><path d="M9 4v14M15 7v14" /></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  locate: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
};

export default function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: Name }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
