// Local, reviewed brand assets. See assets/brands/preferences/sources.json for provenance.
// Only this fixed registry can select an asset or style; caller input is never HTML.
const BRAND_ASSETS = Object.freeze({
  stripe: { file: 'stripe', background: '#635BFF' },
  paypal: { file: 'paypal', background: '#FFFFFF' },
  phantom: { file: 'phantom', background: '#AB9FF2', size: 32 },
  ethereum: { file: 'ethereum', background: '#F1F3F8' },
  bitcoin: { file: 'bitcoin', background: '#F7931A' },
  x: { file: 'x', background: '#101114' },
  grok: { file: 'grok', background: '#101114' },
  discord: { file: 'discord', background: '#5865F2' },
  github: { file: 'github', background: '#181717' },
  twitch: { file: 'twitch', background: '#9146FF' },
  kick: { file: 'kick', background: '#101114' },
  'google-drive': { file: 'google-drive', background: '#FFFFFF' },
  'google-calendar': { file: 'google-calendar', background: '#FFFFFF' },
  outlook: { file: 'outlook', background: '#FFFFFF', size: 28 },
  unknown: { file: 'app-connection', background: '#F1F3F8' },
});

const ALIASES = Object.freeze({
  'wallet-eth': 'ethereum', eth: 'ethereum', metamask: 'ethereum',
  'wallet-btc': 'bitcoin', btc: 'bitcoin',
  twitter: 'x', 'stream-x': 'x', 'stream-twitter': 'x', 'x-live': 'x', 'stream-x_live': 'x',
  grok_bot: 'grok', 'grok-bot': 'grok', xai: 'grok',
  'stream-twitch': 'twitch', 'stream-kick': 'kick',
  google_drive: 'google-drive', drive: 'google-drive',
  google_calendar: 'google-calendar', calendar: 'google-calendar',
  microsoft: 'outlook', 'microsoft-outlook': 'outlook', 'outlook-calendar': 'outlook',
});

/** Decorative logo beside a visible provider label. No remote requests or raw SVG injection. */
export function authorizedAppLogoHtml(key, label = '') {
  const requested = String(key || '').trim().toLowerCase();
  const normalized = Object.hasOwn(ALIASES, requested) ? ALIASES[requested] : requested;
  const brand = Object.hasOwn(BRAND_ASSETS, normalized) ? BRAND_ASSETS[normalized] : BRAND_ASSETS.unknown;
  const size = brand.size || 24;
  // label is intentionally not reflected: the adjacent text names the app accessibly.
  void label;
  return `<span class="authorized-app-logo" data-app-brand="${brand.file}" aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;flex:0 0 40px;width:40px;height:40px;border-radius:11px;background:${brand.background};overflow:hidden"><img src="/assets/brands/preferences/${brand.file}.svg?v=20260916-preferences-brands1" alt="" width="${size}" height="${size}" style="display:block;object-fit:contain;max-width:100%;max-height:100%" decoding="async" draggable="false"></span>`;
}
