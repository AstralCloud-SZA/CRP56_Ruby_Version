/* ============================================================
   CRP56 — Custom title bar wiring
   Include on every page (after the .titlebar markup). Wires the
   min/maximize/close buttons to window.winControls (exposed by preload.js)
   and keeps the maximize/restore icon in sync.
   Degrades gracefully in a plain browser (no winControls).
   ============================================================ */
(() => {
    "use strict";

    const api = window.winControls;
    const bar = document.querySelector(".titlebar");
    if (!bar) return;

    const btnMin   = bar.querySelector(".tb-min");
    const btnMax   = bar.querySelector(".tb-max");
    const btnClose = bar.querySelector(".tb-close");

    // In a plain browser there's no IPC bridge — hide controls, leave the bar as chrome.
    if (!api)
    {
        bar.dataset.demo = "true";
        return;
    }

    btnMin   && btnMin.addEventListener("click",   () => api.minimize());
    btnClose && btnClose.addEventListener("click", () => api.close());
    btnMax   && btnMax.addEventListener("click",   () => api.toggleMaximize());

    function reflectMaximized(isMax)
    {
        document.body.dataset.maximized = isMax ? "true" : "false";
    }

    // Initial state
    if (typeof api.isMaximized === "function")
    {
        Promise.resolve(api.isMaximized()).then(reflectMaximized).catch(() => {});
    }

    // Live updates pushed from main when the user double-clicks the bar,
    // snaps the window, or uses OS shortcuts.
    if (typeof api.onMaximizeChange === "function")
    {
        api.onMaximizeChange(reflectMaximized);
    }

    // Double-click the drag region to toggle maximize (standard behavior).
    bar.addEventListener("dblclick", (e) =>
    {
        if (e.target.closest(".tb-controls")) return;
        api.toggleMaximize();
    });
})();