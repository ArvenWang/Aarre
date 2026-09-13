export const hostStyles = `
:host { all:initial !important; position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; max-width:none !important; max-height:none !important; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; overflow:visible !important; pointer-events:none !important; z-index:2147483647 !important; color-scheme:light dark; --dock-bg:#fff; --dock-ink:#17191c; --dock-line:#dbe0e4; --dock-hover:#f3f5f6; --dock-accent:#b74624; --dock-glass:rgb(255 255 255 / .72); }
:host([data-hidden="true"]), :host([data-capturing="true"]) { visibility:hidden !important; }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
.dock-surface { position:fixed; background:var(--dock-bg); border:1px solid var(--dock-line); border-right:0; border-radius:var(--suite-container-radius) 0 0 var(--suite-container-radius); box-shadow:0 5px 24px #0f11131c,0 1px 4px #0f111312; transform-origin:top left; }
:host([data-open="true"]) .dock-surface { border-radius:20px 0 0 20px; box-shadow:0 12px 48px #0f111329,0 2px 8px #0f11130f; }
.bar { position:fixed; display:grid; grid-template-rows:44px; padding:4px; gap:4px; pointer-events:auto; }
.bar button { display:grid; place-items:center; width:44px; height:44px; aspect-ratio:1; min-height:0; max-width:100%; padding:0; border:0; border-radius:var(--suite-button-radius); background:transparent; color:var(--dock-ink); cursor:pointer; outline:none; transition:background 120ms,color 120ms; }
.bar-product { position:relative; width:44px; height:44px; }
.quick-actions { position:absolute; top:-4px; right:calc(100% + 10px); display:grid; width:52px; height:52px; padding:3px; border:1px solid var(--dock-line); border-radius:var(--suite-container-radius); background:var(--dock-bg); box-shadow:0 4px 18px #0f111324; opacity:0; visibility:hidden; pointer-events:none; transform:translateX(8px); transition:opacity 120ms ease-out,transform 160ms ease-out,visibility 0s linear 120ms; }
.quick-actions::after { content:""; position:absolute; left:100%; top:0; width:10px; height:100%; }
.bar-product[data-actions-open="true"] .quick-actions { opacity:1; visibility:visible; pointer-events:auto; transform:none; transition-delay:0s; }
.bar-save[data-saved="true"] { color:var(--dock-accent); }
.bar-save[data-saved="true"] path { fill:currentColor; }
.bar-save[aria-busy="true"] svg { opacity:.45; }
.bar button:hover { background:var(--dock-hover); }
.bar button:focus-visible { outline:1px solid var(--dock-accent); outline-offset:-2px; }
.bar button:disabled { cursor:wait; opacity:.55; }
.bar svg { width:20px; height:20px; pointer-events:none; }
.panel { position:fixed; border-radius:20px 0 0 20px; overflow:hidden; background:var(--dock-bg); color:var(--dock-ink); pointer-events:none; opacity:0; }
:host([data-open="true"]) .panel { pointer-events:auto; }
iframe { display:block; width:100%; height:100%; border:0; background:inherit; color-scheme:inherit; }
.resize { position:absolute; left:0; top:0; bottom:0; width:8px; cursor:ew-resize; touch-action:none; pointer-events:auto; outline:none; }
.resize::after { content:""; position:absolute; top:calc(50% - 20px); left:2px; width:2px; height:40px; border-radius:2px; background:var(--dock-accent); opacity:0; transition:opacity 120ms; }
.resize:hover::after, .resize:focus-visible::after, :host([data-resizing="true"]) .resize::after { opacity:.8; }
:host([data-resizing="true"]) iframe { pointer-events:none; }
.loading { position:absolute; inset:0; display:grid; place-content:center; gap:8px; padding:24px; overflow-wrap:anywhere; text-align:center; background:inherit; color:inherit; font:13px/1.5 "Avenir Next","PingFang SC",sans-serif; }
.loading button { font:inherit; margin-top:8px; padding:8px 16px; border:1px solid var(--dock-line); border-radius:8px; background:var(--dock-hover); color:inherit; cursor:pointer; }
.loading strong { font-size:18px; }
.loading.save-loading { display:flex; flex-direction:column; gap:0; padding:0; text-align:left; }
.loading-heading { display:flex; align-items:center; justify-content:space-between; flex:none; gap:12px; min-height:48px; padding:8px 12px; border-bottom:1px solid var(--dock-line); }
.loading-heading strong { font-size:16px; }
.loading .loading-heading button { display:grid; place-items:center; width:32px; height:32px; padding:0; margin:0; font-size:23px; line-height:1; border:0; background:transparent; }
.loading-content { flex:1; min-height:0; overflow:hidden; padding:16px; }
.loading-content > span { display:block; opacity:.7; }
.loading-skeleton { display:grid; gap:18px; margin-top:20px; }
.loading-skeleton i { display:block; height:38px; border-radius:10px; background:var(--dock-hover); animation:loading-pulse 1.4s ease-in-out infinite alternate; }
.loading-skeleton i:first-child { width:65%; height:16px; }
.loading-skeleton i:last-child { height:82px; }
.loading-actions { display:flex; justify-content:flex-end; flex:none; padding:12px 16px; border-top:1px solid var(--dock-line); }
.loading .loading-actions button { margin:0; padding:7px 16px; }
.loading button:focus-visible { outline:1px solid var(--dock-accent); outline-offset:2px; }
@keyframes loading-pulse { to { opacity:.45; } }
.quick-feedback { position:fixed; max-width:min(260px,calc(100vw - 68px)); padding:10px 14px; border:1px solid var(--dock-line); border-radius:10px; background:var(--dock-bg); color:var(--dock-ink); box-shadow:0 4px 20px #0f11131c; font:13px/1.5 "Avenir Next","PingFang SC",sans-serif; overflow-wrap:anywhere; }
.quick-feedback[data-error="true"] { color:#b93832; }
:host([data-theme="dark"]) { --dock-bg:#16181b; --dock-ink:#eef0f2; --dock-line:#34383c; --dock-hover:#24282c; --dock-accent:#dedede; --dock-glass:rgb(22 24 27 / .76); }
:host([data-theme="dark"]) .quick-feedback[data-error="true"] { color:#f69b93; }
@supports (backdrop-filter:blur(16px)) {
  :host(:not([data-open="true"])) .dock-surface { background:var(--dock-glass); backdrop-filter:blur(16px) saturate(1.3); }
}
@media (prefers-reduced-transparency:reduce) { .dock-surface { background:var(--dock-bg) !important; backdrop-filter:none !important; } }
@media (forced-colors:active) { .dock-surface { background:Canvas !important; backdrop-filter:none !important; border-color:CanvasText; } .bar button { color:ButtonText; } }
@media (prefers-reduced-motion:reduce) { * { transition:none !important; animation:none !important; } }
`;
