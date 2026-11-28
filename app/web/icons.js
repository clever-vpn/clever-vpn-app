/* 内联 SVG 图标（无外部资源）。stroke/fill 由 CSS 决定，颜色跟随 currentColor。 */
(function () {
  'use strict';

  window.ICONS = {
    connect: '<path d="M12 3v9"/><path d="M6.3 6.5a8 8 0 1 0 11.4 0"/>',
    lines: '<path d="M6.5 3.5v11a3 3 0 0 0 3 3h5a3 3 0 0 1 3 3"/><circle cx="6.5" cy="3.5" r="2"/><circle cx="17.5" cy="20.5" r="2"/>',
    plans: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M3 10.5h18"/>',
    account: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.6 3.8-5.6 7.5-5.6s6.9 2 7.5 5.6"/>',
    gear: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    back: '<path d="M15 4.5 7.5 12 15 19.5"/>',
    check: '<path d="M5 13l4 4 10-10"/>',
    chevron: '<path d="M9.5 5l7 7-7 7"/>',
    arrowDown: '<path d="M12 5v13M6.5 12.5 12 18l5.5-5.5"/>',
    arrowUp: '<path d="M12 19V6M6.5 11.5 12 6l5.5 5.5"/>',
    // 功能型线路的兜底占位（真机上图从 kit://line-icon/… 取；缺失时才用）
    services: {
      general: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
      streaming: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M10.5 9.5l4.5 2.5-4.5 2.5z"/>',
      ai: '<path d="M12 3.2l2.3 5.3 5.3 2.3-5.3 2.3L12 18.4l-2.3-5.3L4.4 10.8l5.3-2.3z"/>',
      gaming: '<rect x="2.5" y="8" width="19" height="9" rx="4.5"/><path d="M7.5 11v3M6 12.5h3M15.8 11.6h.01M17.8 13.4h.01"/>',
    },
  };
})();
