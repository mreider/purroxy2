// Inline SVG icon set — keep tiny, tree-shakable, currentColor.
const Icon = ({ name, size = 16, ...rest }) => {
  const paths = ICONS[name];
  if (!paths) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {paths}
    </svg>
  );
};

const ICONS = {
  library:   <><path d="M3 3v10M6 3v10M9 4l2.5-.5 2 9.5-2.5.5z"/></>,
  recent:    <><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/></>,
  archive:   <><rect x="2.5" y="3.5" width="11" height="3" rx="1"/><path d="M3.5 6.5v6a1 1 0 001 1h7a1 1 0 001-1v-6M6.5 9h3"/></>,
  failed:    <><circle cx="8" cy="8" r="5.5"/><path d="M6 6l4 4M10 6l-4 4"/></>,
  settings:  <><circle cx="8" cy="8" r="2"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4"/></>,
  search:    <><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L13 13"/></>,
  plus:      <><path d="M8 3v10M3 8h10"/></>,
  play:      <><path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/></>,
  back:      <><path d="M9.5 4L5 8l4.5 4"/></>,
  close:     <><path d="M4 4l8 8M12 4l-8 8"/></>,
  more:      <><circle cx="3.5" cy="8" r="0.8" fill="currentColor"/><circle cx="8" cy="8" r="0.8" fill="currentColor"/><circle cx="12.5" cy="8" r="0.8" fill="currentColor"/></>,
  chevron_r: <><path d="M6 4l4 4-4 4"/></>,
  chevron_d: <><path d="M4 6l4 4 4-4"/></>,
  alert:     <><path d="M8 2L1.5 13.5h13z"/><path d="M8 6.5v3M8 11.3v.3"/></>,
  check:     <><path d="M3.5 8.5L7 12l5.5-7"/></>,
  warn:      <><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.5M8 10.5v.3"/></>,
  copy:      <><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V4a1 1 0 011-1h7"/></>,
  folder:    <><path d="M2 5a1 1 0 011-1h3l1.5 1.5h5.5a1 1 0 011 1v5a1 1 0 01-1 1h-10a1 1 0 01-1-1z"/></>,
  external: <><path d="M9 3h4v4M13 3l-6 6M11 9v3a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1h3"/></>,
  trash:    <><path d="M3 4.5h10M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M5 4.5l.5 8a1 1 0 001 1h3a1 1 0 001-1l.5-8"/></>,
  pencil:   <><path d="M11 2.5l2.5 2.5L5.5 13l-3 .5.5-3z"/></>,
  duplicate:<><rect x="3" y="3" width="8" height="8" rx="1.5"/><path d="M5 11v1a1 1 0 001 1h7a1 1 0 001-1V6a1 1 0 00-1-1h-1"/></>,
  sidebar:  <><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M6 3v10"/></>,
  log:      <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 6h6M5 8h6M5 10h3"/></>,
  download: <><path d="M8 2v8M5 7l3 3 3-3M3 13h10"/></>,
  reveal:   <><path d="M2.5 8s2-4.5 5.5-4.5S13.5 8 13.5 8s-2 4.5-5.5 4.5S2.5 8 2.5 8z"/><circle cx="8" cy="8" r="1.5"/></>,
  zap:      <><path d="M9 2L4 9h3l-1 5 5-7H8z"/></>,
  stop:     <><rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" stroke="none"/></>,
  redo:     <><path d="M13 5h-5a4 4 0 100 8h5"/><path d="M10 2l3 3-3 3"/></>,
  globe:    <><circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11"/></>,
};

window.Icon = Icon;
