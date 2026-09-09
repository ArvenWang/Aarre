export const hostStyles = `
:host { all: initial !important; position:fixed !important; inset:0 !important; width:100vw !important; height:100vh !important; max-width:none !important; max-height:none !important; margin:0 !important; padding:0 !important; border:0 !important; background:transparent !important; overflow:visible !important; pointer-events:none !important; z-index:2147483647 !important; color-scheme:light dark; }
:host([data-hidden="true"]), :host([data-capturing="true"]) { visibility:hidden !important; }
* { box-sizing:border-box; }
.ball { position:fixed; display:grid; place-items:center; width:52px; height:52px; padding:0; border:1px solid #dbe0e4; border-radius:50%; background:#fff; color:#17191c; box-shadow:0 4px 18px #0f11132b; cursor:grab; pointer-events:auto; touch-action:none; outline:none; transition:background 160ms ease,box-shadow 160ms ease; }
.ball:hover { background:#f3f5f6; box-shadow:0 6px 22px #0f111338; }
.ball:active { cursor:grabbing; }
.ball:focus-visible, .resize:focus-visible { outline:3px solid #497969; outline-offset:3px; }
.ball svg { display:block; width:24px; height:24px; pointer-events:none; }
.ball[aria-expanded="true"] { border-color:#9ba5ae; }
.panel { position:fixed; border:1px solid #dbe0e4; border-radius:20px; box-shadow:0 16px 54px #0f111330,0 3px 10px #0f111314; background:#fff; pointer-events:auto; overflow:hidden; }
.panel[hidden] { display:none; }
iframe { display:block; width:100%; height:100%; border:0; background:inherit; color-scheme:inherit; }
.resize { position:absolute; right:0; top:0; width:18px; height:18px; cursor:nesw-resize; touch-action:none; pointer-events:auto; color:#68717a; border:0; background:transparent; padding:3px; }
:host([data-edge="right"]) .resize { right:auto; left:0; cursor:nwse-resize; }
.resize svg { transform:rotate(180deg); width:14px; height:14px; display:block; }
.loading { position:absolute; inset:0; display:grid; place-content:center; gap:8px; text-align:center; background:inherit; color:inherit; font:13px/1.5 "Avenir Next","PingFang SC",sans-serif; }
.loading[hidden] { display:none; }
.loading button { font:inherit; padding:8px 16px; border:1px solid #9ba5ae; border-radius:8px; background:inherit; color:inherit; cursor:pointer; }
.loading strong { font-size:18px; }
:host([data-theme="dark"]) .ball, :host([data-theme="dark"]) .panel { background:#16181b; color:#eef0f2; border-color:#34383c; }
:host([data-theme="dark"]) .ball:hover { background:#24282c; }
:host([data-theme="dark"]) .resize { color:#adb5be; }
@media (prefers-reduced-motion:reduce) { * { transition:none !important; animation:none !important; } }
`;
