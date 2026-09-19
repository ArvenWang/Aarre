// Two 44px targets and 4px outer padding: 36px artwork has an 8px gap/inset.
export const SUITE_BAR_HEIGHT = 96;
export const suiteBarHeight = (count: number) => 8 + 44 * Math.max(1, count);
const icon = (path: string) => `<span class="suite-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;

// Figma A1 geometry, with a neutral dark palette: Aarre public/icons/icon{,-dark}.svg.
// NexAlign artwork:
// src/assets/nexalign-icon-{light,dark}.svg. Embedded for independent builds
// and for source pages that block image URLs with their Content Security Policy.
export const suiteIcons = {
  aarre: `<span class="product-icon product-icon-aarre product-icon-light" aria-hidden="true"><svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="128" height="128" rx="30" fill="#F2633D"/>
<path d="M95.1014 44.8442C96.9058 49.0682 96.3707 53.9282 93.6906 57.6585C91.0105 61.3888 86.5754 63.4466 81.9964 63.0844L48.8844 60.4648C44.5313 60.1204 40.7596 57.3145 39.1784 53.244C37.5972 49.1736 38.4858 44.5574 41.4649 41.3647L61.656 19.7269C65.0877 16.0493 70.1456 14.3551 75.1002 15.2237C80.0547 16.0923 84.2346 19.406 86.2107 24.0318L95.1014 44.8442Z" fill="#F9F0D5"/>
<path d="M58.5791 88.5637C62.3502 93.6546 61.9464 100.713 57.6193 105.34C53.2923 109.968 46.2773 110.844 40.9449 107.423L26.8749 98.3958C23.4674 96.2096 21.0983 92.729 20.3141 88.7572L17.656 75.2932C16.467 69.2708 19.6112 63.2287 25.2257 60.7467C30.8403 58.2647 37.4252 60.0059 41.0791 64.9387L58.5791 88.5637Z" fill="#F9F0D5"/>
<path d="M109.378 89.0898C112.005 95.7628 110.294 103.363 105.062 108.268C99.8301 113.172 92.1352 114.388 85.6457 111.336L73.5077 105.627C69.7455 103.858 67.0441 100.41 66.2257 96.3339C65.4073 92.2577 66.5686 88.0347 69.3562 84.9501L80.957 72.1134C84.2057 68.5187 89.0821 66.8592 93.8491 67.7262C98.6161 68.5933 102.596 71.8635 104.371 76.3719L109.378 89.0898Z" fill="#F9F0D5"/>
</svg></span><span class="product-icon product-icon-aarre product-icon-dark" aria-hidden="true"><svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="128" height="128" rx="30" fill="#000000"/>
<path d="M95.1014 44.8442C96.9058 49.0682 96.3707 53.9282 93.6906 57.6585C91.0105 61.3888 86.5754 63.4466 81.9964 63.0844L48.8844 60.4648C44.5313 60.1204 40.7596 57.3145 39.1784 53.244C37.5972 49.1736 38.4858 44.5574 41.4649 41.3647L61.656 19.7269C65.0877 16.0493 70.1456 14.3551 75.1002 15.2237C80.0547 16.0923 84.2346 19.406 86.2107 24.0318L95.1014 44.8442Z" fill="#F5F5F5"/>
<path d="M58.5791 88.5637C62.3502 93.6546 61.9464 100.713 57.6193 105.34C53.2923 109.968 46.2773 110.844 40.9449 107.423L26.8749 98.3958C23.4674 96.2096 21.0983 92.729 20.3141 88.7572L17.656 75.2932C16.467 69.2708 19.6112 63.2287 25.2257 60.7467C30.8403 58.2647 37.4252 60.0059 41.0791 64.9387L58.5791 88.5637Z" fill="#F5F5F5"/>
<path d="M109.378 89.0898C112.005 95.7628 110.294 103.363 105.062 108.268C99.8301 113.172 92.1352 114.388 85.6457 111.336L73.5077 105.627C69.7455 103.858 67.0441 100.41 66.2257 96.3339C65.4073 92.2577 66.5686 88.0347 69.3562 84.9501L80.957 72.1134C84.2057 68.5187 89.0821 66.8592 93.8491 67.7262C98.6161 68.5933 102.596 71.8635 104.371 76.3719L109.378 89.0898Z" fill="#F5F5F5"/>
</svg></span>`,
  nexalign: `<span class="product-icon product-icon-light" aria-hidden="true"><svg preserveAspectRatio="none" overflow="visible" style="display: block;" width="218" height="218" viewBox="0 0 218 218" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="Frame 2147208662" clip-path="url(#clip0_0_4)">
<rect id="ART IPS logo &#231;&#153;&#189;&#232;&#137;&#178; 2" width="218" height="218" fill="white"/>
<path id="Rectangle 1329138824" d="M27 145L108.5 112L190 145L108.5 178L27 145Z" fill="#333333"/>
<path id="Rectangle 1329138826" d="M108.5 142V112L190 145L108.5 142Z" fill="#151515"/>
<path id="Rectangle 1329138823" d="M27 109L108.5 76L190 109L108.5 142L27 109Z" fill="#737373"/>
<path id="Rectangle 1329138825" d="M108.5 106V76L190 109L108.5 106Z" fill="#555555"/>
<path id="Rectangle 1329138822" d="M27 73L108.5 40L149.25 56.5L190 73L108.5 106L67.75 89.5L27 73Z" fill="#B8B8B8"/>
</g>
<defs>
<clipPath id="clip0_0_4">
<rect width="218" height="218" fill="white"/>
</clipPath>
</defs>
</svg></span><span class="product-icon product-icon-dark" aria-hidden="true"><svg preserveAspectRatio="none" overflow="visible" style="display: block;" width="218" height="218" viewBox="0 0 218 218" fill="none" xmlns="http://www.w3.org/2000/svg">
<g id="Frame 2147208661">
<rect id="ART IPS logo &#231;&#153;&#189;&#232;&#137;&#178; 2" width="218" height="218" fill="black"/>
<path id="Rectangle 1329138824" d="M27 145L108.5 112L190 145L108.5 178L27 145Z" fill="#A5A5A5"/>
<path id="Rectangle 1329138826" d="M108.5 142V112L190 145L108.5 142Z" fill="#575757"/>
<path id="Rectangle 1329138823" d="M27 109L108.5 76L190 109L108.5 142L27 109Z" fill="#D5D5D5"/>
<path id="Rectangle 1329138825" d="M108.5 106V76L190 109L108.5 106Z" fill="#9A9A9A"/>
<path id="Rectangle 1329138822" d="M27 73L108.5 40L149.25 56.5L190 73L108.5 106L67.75 89.5L27 73Z" fill="white"/>
</g>
</svg></span>`,
  nexcatcher: `<span class="product-icon product-icon-catcher" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M14 8H8v6m14-6h6v6M8 22v6h6m14-6v6h-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><rect x="15" y="15" width="6" height="6" rx="1.5" fill="currentColor"/></svg></span>`,
  save: icon('<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-3-5.6 3 1-6.2L2.9 9.6l6.3-.9L12 3Z"/>'),
};
export const suiteStyles = `
:host{--suite-icon-size:22px;--suite-product-icon-size:36px;--suite-icon-radius:8px;--suite-container-radius:16px;--suite-button-radius:12px;--suite-bg:#fff;--suite-ink:#666;--suite-line:rgba(0,0,0,.12);--suite-hover:#f5f5f5;--suite-active:#ececec}
:host([data-suite-theme="dark"]),:host([data-theme="dark"]),:host([data-floating-theme="dark"]){--suite-bg:#202020;--suite-ink:#bcbcbc;--suite-line:rgba(255,255,255,.13);--suite-hover:#2a2a2a;--suite-active:#323232}
:host([data-theme]),:host([data-floating-theme]){--dock-bg:var(--suite-bg);--dock-ink:var(--suite-ink);--dock-line:var(--suite-line);--dock-hover:var(--suite-hover);--dock-glass:var(--suite-bg)}
:host([data-suite-paired="true"]) .bar{grid-template-rows:repeat(var(--suite-count,2),44px);row-gap:0}
.product-icon{display:block;grid-area:1/1;width:var(--suite-product-icon-size);height:var(--suite-product-icon-size);border-radius:var(--suite-icon-radius);overflow:hidden;pointer-events:none}
.bar .product-icon svg,.launcher .product-icon svg{display:block;width:100%;height:100%;stroke:none}
.product-icon-aarre svg>rect{rx:calc(128 * var(--suite-icon-radius) / 36);ry:calc(128 * var(--suite-icon-radius) / 36)}
.product-icon-dark{display:none}
.product-icon-catcher{color:var(--suite-ink);display:grid;place-items:center}
:host([data-theme="dark"]) .product-icon-light,:host([data-floating-theme="dark"]) .product-icon-light{display:none}
:host([data-theme="dark"]) .product-icon-dark,:host([data-floating-theme="dark"]) .product-icon-dark{display:block}
.suite-icon{display:grid;place-items:center;width:var(--suite-icon-size);height:var(--suite-icon-size);pointer-events:none}
.bar .suite-icon svg,.launcher .suite-icon svg{display:block;width:100%;height:100%;stroke:currentColor;stroke-width:1.5;fill:none}
.bar button,.launcher{color:var(--suite-ink);border:0;transition:background-color 120ms ease-out,color 120ms ease-out;touch-action:none}
.bar button:hover,.launcher:hover{background:var(--suite-hover)}
.bar button:active,.bar button[aria-expanded="true"],.launcher:active{background:var(--suite-active)}
.bar button:focus-visible,.launcher:focus-visible{outline:1px solid var(--suite-ink);outline-offset:-2px}
/* A single floating action surface: no inset tile or persistent selection ring. */
.bar button.bar-save{background:transparent}
.bar-save[data-saved="true"] .suite-icon svg{fill:currentColor}
.quick-actions:has(.bar-save:hover){background:var(--suite-hover)}
.quick-actions:has(.bar-save:active){background:var(--suite-active)}
.bar,.anchor{touch-action:none;user-select:none}
:host([data-dragging="true"]) .bar,:host([data-dragging="true"]) .bar button,:host([data-dragging="true"]) .launcher{cursor:grabbing}
:host([data-dragging="true"]) .bar button,:host([data-dragging="true"]) .launcher{background:transparent}
:host([data-dragging="true"]) .dock-surface,:host([data-dragging="true"]) .dock-surface-nex{box-shadow:0 8px 28px #0003,0 1px 4px #0002}
:host([data-suite-away="true"]) .dock-surface,:host([data-suite-away="true"]) .bar,:host([data-suite-away="true"]) .anchor,:host([data-suite-away="true"]) .dock-surface-nex{visibility:hidden!important;pointer-events:none!important}
:host([data-suite-ready="false"]:not([data-open="true"]):not([data-menu-open="true"])) :is(.dock-surface,.bar,.anchor,.dock-surface-nex){visibility:hidden!important;pointer-events:none!important}
:host([data-suite-paired="true"]:not([data-suite-owner="true"]):not([data-menu-open="true"])) .anchor,:host([data-suite-paired="true"]:not([data-suite-owner="true"]):not([data-menu-open="true"]):not([data-suite-closing="true"])) .dock-surface-nex{visibility:hidden!important;pointer-events:none!important}
@media(prefers-reduced-motion:reduce){.bar button,.launcher{transition:none!important}}
@media(forced-colors:active){.bar button,.launcher{color:ButtonText}.bar button:focus-visible,.launcher:focus-visible{outline-color:Highlight}.quick-actions{outline:1px solid ButtonText}}
`;
