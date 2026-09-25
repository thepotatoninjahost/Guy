# Gunther · design principles

Standing rules for every UI pass. Owner of the house sets these; code follows.

## Density & overlap (set 2026-09-18, from the owner)
- The interface must never read as *sterile* or *boring* — architectural ambition
  over minimal emptiness.
- **Overlapping is allowed.** Translucent glass panels may stack, float and
  layer; the glass-house metaphor wants depth.
- **Hard line: overlap must never interfere with reading text.** No panel,
  backdrop or ornament may sit under live copy at an opacity that hurts
  legibility. Readable text always wins over composition.

Concretely: decorative layers may pass *behind* text (with solid or blurred
backing where they cross it), but a text-bearing surface must stay clear of
other text-bearing surfaces. If a composition calls for crossing, the crossing
point gets a scrim, a frame or a z-shadow — not a coin flip.

## Restated house rules (from the original commission)
- Dark mode, high contrast, expansive structural borders; big glassmorphism
  panels like a $10k architectural window wall. No generic sidebars.
- Header (the Crest) is sculpted: asymmetrical cuts, curved panels, nothing
  sitting on a flat horizontal grid.
- All heavy controls (keys, trackers, overrides) live in the collapsible
  Service Slab bays. The main view stays pure and striking.
- Everything on a Galaxy S25 first: one thumb, no hover, safe areas respected.
- Zero placeholders in code; complete, robust blocks only.

## Layout law (born from the 2026-09-19 phone screenshots)
- `hidden` must mean `hidden`: any element given `display:` in CSS needs an
  explicit `[hidden] { display: none }` escape, or it will render on top of
  its replacement forever.
- Overlap is decoration only — glows, frames, hairlines. Two text-bearing
  surfaces NEVER occupy the same band; if a lane is tight, it scrolls.
- Fix a collision with LAYOUT, never with an opaque background over the
  wound. Glass stays glass: fills under 0.45 alpha with backdrop blur.
