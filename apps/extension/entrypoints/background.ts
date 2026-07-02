export default defineBackground(() => {
  // Clicking the toolbar icon opens the refynr side panel.
  void browser.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {
      /* older Chrome without sidePanel API */
    });
});
