/**
 * Device icons — renders real Windows system icons when available,
 * falling back to hand-drawn SVGs.
 *
 * Real icons are extracted from Windows DLLs via SetupAPI on the Rust backend
 * and served as base64 PNG data URLs. The SVG fallbacks are clean 24x24 icons
 * designed to be crisp at small sizes.
 */

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { getClassIconUrl } from '~/lib/icon-cache';

interface DeviceIconProps {
  iconId: string;
  classGuid?: string;
  class?: string;
}

const DeviceIcon: Component<DeviceIconProps> = props => {
  const iconClass = () => props.class ?? 'w-5 h-5';
  const realIconUrl = () => props.classGuid ? getClassIconUrl(props.classGuid) : undefined;

  return (
    <Show
      when={realIconUrl()}
      fallback={
        <svg
          class={iconClass()}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          {iconPaths(props.iconId)}
        </svg>
      }
    >
      {url => <img src={url()} class={iconClass()} alt="" draggable={false} />}
    </Show>
  );
};

function iconPaths(id: string) {
  switch (id) {
    case 'display':
      return (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </>
      );
    case 'network':
      return (
        <>
          <rect x="1" y="6" width="6" height="12" rx="1" />
          <rect x="9" y="3" width="6" height="15" rx="1" />
          <rect x="17" y="8" width="6" height="10" rx="1" />
          <line x1="4" y1="18" x2="4" y2="18.01" />
          <line x1="12" y1="18" x2="12" y2="18.01" />
          <line x1="20" y1="18" x2="20" y2="18.01" />
        </>
      );
    case 'usb':
      return (
        <>
          <circle cx="10" cy="18" r="2" />
          <circle cx="18" cy="12" r="2" />
          <line x1="12" y1="2" x2="12" y2="16" />
          <polyline points="9,5 12,2 15,5" />
          <line x1="12" y1="10" x2="16" y2="12" />
        </>
      );
    case 'keyboard':
      return (
        <>
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <line x1="6" y1="10" x2="6" y2="10.01" />
          <line x1="10" y1="10" x2="10" y2="10.01" />
          <line x1="14" y1="10" x2="14" y2="10.01" />
          <line x1="18" y1="10" x2="18" y2="10.01" />
          <line x1="8" y1="14" x2="16" y2="14" />
        </>
      );
    case 'mouse':
      return (
        <>
          <rect x="6" y="2" width="12" height="20" rx="6" />
          <line x1="12" y1="2" x2="12" y2="10" />
        </>
      );
    case 'audio':
      return (
        <>
          <path d="M11 5L6 9H2v6h4l5 4V5z" />
          <path d="M19.07 4.93a10 10 0 010 14.14" />
          <path d="M15.54 8.46a5 5 0 010 7.07" />
        </>
      );
    case 'disk':
      return (
        <>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </>
      );
    case 'storage-controller':
      return (
        <>
          <rect x="2" y="4" width="20" height="6" rx="1" />
          <rect x="2" y="14" width="20" height="6" rx="1" />
          <circle cx="18" cy="7" r="1" />
          <circle cx="18" cy="17" r="1" />
        </>
      );
    case 'volume':
      return (
        <>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </>
      );
    case 'system':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.6.77 1.02 1.33 1.13h.18a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </>
      );
    case 'hid':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M9 9h1v1H9zM14 9h1v1h-1zM9 13h6v2H9z" fill="currentColor" stroke="none" />
        </>
      );
    case 'bluetooth':
      return (
        <>
          <polyline points="6.5,6.5 17.5,17.5" />
          <polyline points="6.5,17.5 17.5,6.5" />
          <polyline points="12,2 17.5,6.5 12,12 17.5,17.5 12,22" />
        </>
      );
    case 'optical':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </>
      );
    case 'port':
      return (
        <>
          <rect x="3" y="7" width="18" height="10" rx="1" />
          <circle cx="7" cy="12" r="1" fill="currentColor" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
          <circle cx="17" cy="12" r="1" fill="currentColor" />
        </>
      );
    case 'monitor':
      return (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <path d="M6 10l4 0M6 13l3 0" />
        </>
      );
    case 'printer':
      return (
        <>
          <polyline points="6,9 6,2 18,2 18,9" />
          <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </>
      );
    case 'processor':
      return (
        <>
          <rect x="6" y="6" width="12" height="12" rx="1" />
          <line x1="9" y1="1" x2="9" y2="6" />
          <line x1="15" y1="1" x2="15" y2="6" />
          <line x1="9" y1="18" x2="9" y2="23" />
          <line x1="15" y1="18" x2="15" y2="23" />
          <line x1="1" y1="9" x2="6" y2="9" />
          <line x1="1" y1="15" x2="6" y2="15" />
          <line x1="18" y1="9" x2="23" y2="9" />
          <line x1="18" y1="15" x2="23" y2="15" />
        </>
      );
    case 'battery':
      return (
        <>
          <rect x="1" y="6" width="18" height="12" rx="2" />
          <line x1="23" y1="10" x2="23" y2="14" />
          <rect x="3" y="8" width="8" height="8" rx="1" fill="currentColor" opacity="0.3" />
        </>
      );
    case 'camera':
      return (
        <>
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
          <circle cx="12" cy="13" r="4" />
        </>
      );
    case 'firmware':
      return (
        <>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M8 6h8M8 10h8M8 14h4" />
          <circle cx="16" cy="18" r="1" fill="currentColor" />
        </>
      );
    case 'software':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <polyline points="8,8 12,12 8,16" />
          <line x1="14" y1="16" x2="18" y2="16" />
        </>
      );
    case 'legacy':
      return (
        <>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 8h12M6 12h8" />
          <path d="M17 16l2-2-2-2" stroke-width="1.5" />
        </>
      );
    case 'media':
      return (
        <>
          <circle cx="5.5" cy="17.5" r="2.5" />
          <circle cx="17.5" cy="15.5" r="2.5" />
          <path d="M8 17V5l12-2v12" />
        </>
      );
    case 'security':
      return (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </>
      );
    case 'sensor':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
        </>
      );
    case 'imaging':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21,15 16,10 5,21" />
        </>
      );
    case 'firewire':
      return (
        <>
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </>
      );
    default:
      // Generic "other" device icon — a question mark in a box.
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </>
      );
  }
}

export default DeviceIcon;
