// ponytail: empty pass-through worker - only exists so Chrome/Android count the
// site as installable. No offline cache (dashboard data is live-or-nothing
// anyway); add a cache strategy here if offline viewing is ever needed.
self.addEventListener("fetch", () => {});
