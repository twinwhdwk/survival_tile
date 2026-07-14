// Sizes a backing panel rectangle to snugly wrap a Text object's actual
// rendered bounds rather than its bare `.width` — canvas measureText
// undercounts emoji glyphs (and ignores stroke), which let several title
// panels across the app (login, lobby, dashboard) visibly clip their own
// text. `getBounds()` reflects what's really drawn, so a much smaller,
// consistent padding works everywhere instead of every panel guessing its
// own oversized fudge factor.
export function fitPanelWidth(panel, text, paddingX) {
  const bounds = text.getBounds();
  panel.setSize(bounds.width + paddingX, panel.height);
}
