'use strict';

// Restore before the first paint. This is a local layout preference, not content
// data, and a disabled/full storage must never prevent the workspace from opening.
(() => {
  const root = document.documentElement;
  if (!root.classList.contains('workbench')) return;
  const key = 'suira.sidebar.collapsed';
  try { root.classList.toggle('sidebar-collapsed', localStorage.getItem(key) === 'true'); } catch {}

  function init() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('workbench-sidebar');
    if (!toggle || !sidebar) return;
    const links = Array.from(sidebar.querySelectorAll('.nav-item'));
    function apply(collapsed, persist = false) {
      root.classList.toggle('sidebar-collapsed', collapsed);
      const label = collapsed ? '展开侧边栏' : '收起侧边栏';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.dataset.hint = `${label}（Ctrl + \\）`;
      toggle.dataset.hintWhenExpanded = 'true';
      links.forEach(link => {
        if (collapsed) link.dataset.hint = link.getAttribute('aria-label');
        else delete link.dataset.hint;
      });
      if (persist) {
        try { localStorage.setItem(key, String(collapsed)); } catch {}
      }
    }
    const flip = () => apply(!root.classList.contains('sidebar-collapsed'), true);
    toggle.addEventListener('click', flip);
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.shiftKey) return;
      if (!(event.ctrlKey || event.metaKey) || !(event.key === '\\' || event.code === 'Backslash')) return;
      // Do not take shortcuts away from an editor or an open modal dialog.
      if (toggle.closest('[inert]') || event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      flip();
    });
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) apply(event.key === key && event.newValue === 'true');
    });
    apply(root.classList.contains('sidebar-collapsed'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
