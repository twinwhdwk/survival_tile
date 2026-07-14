// Sizes a backing panel rectangle to snugly wrap a Text object's actual
// rendered bounds rather than its bare `.width` — canvas measureText
// undercounts emoji glyphs (and ignores stroke), which let several title
// panels across the app (login, lobby, dashboard) visibly clip their own
// text. `getBounds()` reflects what's really drawn, so a much smaller,
// consistent padding works everywhere instead of every panel guessing its
// own oversized fudge factor.
// setSize() only updates the `width`/`height` properties (see Phaser's
// ComputedSize mixin) — it does NOT recompute `_displayOriginX/Y`, which are
// cached from `originX/Y * width/height` at the time they were last set
// (construction, or the last explicit setOrigin() call). Rectangle's
// renderer draws its fill/stroke every frame at `-_displayOriginX,
// -_displayOriginY` sized `width x height` (both live), so the geometry
// itself isn't stale — but for any origin other than 0 on an axis, the
// *offset* it's drawn from is still based on the old, smaller size. Calling
// updateDisplayOrigin() right after setSize() recomputes that cached offset
// from the current origin/width/height, which is exactly what fixes it.
export function fitPanelWidth(panel, text, paddingX) {
  const bounds = text.getBounds();
  panel.setSize(bounds.width + paddingX, panel.height);
  panel.updateDisplayOrigin();
}
