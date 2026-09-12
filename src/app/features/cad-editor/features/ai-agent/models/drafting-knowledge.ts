/**
 * Drafting fundamentals the assistant is briefed with on every LLM turn.
 *
 * This is the "senior drafter over your shoulder" block: layer and lineweight
 * conventions, typical sizes for building interiors and civil infrastructure,
 * and the placement rules that keep generated geometry sane. It is provider
 * neutral and stable across turns, so the gateway puts it first in the system
 * prompt where prompt caching can pick it up.
 *
 * Everything is in millimetres in model space. Text heights and offsets are
 * given as plotted sizes; multiply by the drawing scale factor (1:100 → ×100).
 */
export const DRAFTING_KNOWLEDGE = `
## Units and coordinates
- Model space is in millimetres. 1 m = 1000. Convert every user figure to mm before emitting geometry.
- Y is up (north is +Y on plans). Angles are degrees counter-clockwise from +X.
- Place new geometry at the coordinates the user names. Otherwise use the cursor position, then the centre of the current viewport, then just to the right of the drawing extents with a clear gutter (≥ 10 % of the extents width). Never overlap existing geometry unless asked.
- Coordinates are absolute world coordinates. When the user says "next to", "above", "beside" an existing view or selection, use its bbox from the context.

## Layers (AIA/ISO style names; create if missing)
- A-WALL walls (cut) · A-WALL-PRHT partition/low walls · A-DOOR doors & swings · A-GLAZ windows · A-FLOR floor finishes/fixtures · A-FURN furniture · A-AREA room outlines
- A-ANNO-TEXT text/labels · A-ANNO-DIMS dimensions · A-ANNO-SYMB symbols/tags · A-GRID column grid
- S-COLS columns · S-BEAM beams · S-SLAB slabs · S-FNDN foundations · S-GRID structural grid
- C-ROAD carriageway edges · C-ROAD-CNTR road centreline · C-STRM storm drains · C-SSWR sewer · C-TOPO contours · C-PROP property lines
- E-LITE lighting · E-POWR power · P-SANR sanitary · M-HVAC ducts · L-PLNT planting
- CL centrelines · HIDDEN hidden lines · HATCH hatching · DIM legacy dims · STRUCTURAL / DRAINAGE / ROAD (existing templates)
- Prefer an existing layer with the same purpose (e.g. the drawing already has WALLS) over creating a new one.

## Lineweights (mm) and linetypes
- Cut walls/sections 0.50–0.70 · object outlines 0.35 · hidden/above 0.18 HIDDEN · centrelines 0.18 CENTER · dimensions/text 0.18–0.25 · hatching 0.09–0.13 · grid lines 0.18 CENTER (or DASHDOT).
- Lineweights are sent in hundredths of a mm (0.35 mm → 35). Standard values: 0 5 9 13 15 18 20 25 30 35 40 50 53 60 70 80 90 100 106 120 140 158 200 211.

## Colours (ACI)
- red=1 yellow=2 green=3 cyan=4 blue=5 magenta=6 white/black=7 grey=8. Walls 7 or white, doors 3, glazing 4, grid 8, text 7, dims 3, hatch 8, centrelines 1 or 8. Leave entity colour BYLAYER (omit) unless the user asks for a colour.

## Text and dimensions
- Plotted text 2.5 mm (notes), 3.5 mm (room names), 5–7 mm (titles). Model text height = plotted × scale factor: at 1:100 notes are 250, room names 350, titles 500–700. At 1:50 halve those; at 1:200 double.
- Room label: NAME on one line, area (m²) below at 0.7× height, centred in the room.
- Dimensions sit outside the object, offset 8–10 mm plotted (800–1000 at 1:100) from the outline; stack a second run 8 mm further out for overall sizes. Dimension to wall faces or centrelines consistently, never mix.
- Title blocks, north arrows, scale bars go on A-ANNO-SYMB.

## Interior / architecture fundamentals (mm)
- Wall thickness: external brick 230, RCC shear 200, internal brick 115, drywall partition 100–150, block 200.
- Doors: main entrance 1000–1200, bedroom 900, bathroom/WC 750–800, sliding balcony 1800–2400. Door leaf drawn as a line from the hinge + a 90° swing arc; opening shown by removing the wall between the jambs.
- Windows: sill 900 (living) / 1100 (bathroom), width 1200–1800, height 1200–1500; draw as two parallel lines across the wall thickness with a thin glazing line in the middle.
- Ceiling 2700–3000 clear. Corridors ≥ 1000 (residential) / 1500 (public). Stairs: tread 250–300, riser 150–175, width ≥ 900, landing ≥ width.
- Kitchen: counter 600 deep, 850–900 high, 1200 min between parallel counters, work triangle 3.6–6.6 m total. Fridge 700×750, hob 600×600, sink 600–800 wide.
- Bathroom: WC 700×400 needs 800 wide × 1200 clear; basin 600×450; shower 900×900 min; bathtub 1700×750. Toilet room 900×1500 minimum.
- Bedrooms: single bed 900×1900, double 1500×1900, queen 1600×2000, king 1800×2000; wardrobe 600 deep; 750 clear beside a bed.
- Living: sofa 3-seat 2100×900, 2-seat 1600×900, armchair 900×900, coffee table 1200×600, TV unit 1800×450, dining table 4 seats 1200×800, 6 seats 1800×900, chair 450×450 with 600 push-back.
- Office: desk 1500×750, chair 600×600, 1200 clear behind desks, workstation 1500×1500 per person, meeting table 6 seats 2400×1200.
- Parking: bay 2500×5000 (2400×4800 min), aisle 6000 two-way, ramp ≤ 1:8, clear height 2200.
- Typical rooms: master bedroom 3.6×4.2 m, bedroom 3.0×3.6 m, living 4.2×5.4 m, kitchen 2.4×3.6 m, bathroom 1.8×2.4 m, WC 0.9×1.5 m.

## Civil / infrastructure fundamentals (mm)
- Roads: lane 3500 (3000 urban min), shoulder 1500–2500, kerb 150 high / 300 wide, footpath 1500–2000, median 1200–2000, cycle lane 1500–2000. Crossfall 2–2.5 %. Carriageway edges on C-ROAD, centreline on C-ROAD-CNTR with CENTER linetype.
- Drainage: open drain 600–1200 wide × 600–1200 deep, trapezoidal side slope 1:1 or 1.5:1, 150 wall; pipe culvert Ø600–1800; box culvert clear 1500–4000 with 300 walls/slabs. Manholes 1200×1200 or Ø1200 internal, 200 walls, spaced ≤ 30 m.
- Retaining walls: stem 300–500 top, base 0.5–0.7×H wide, 400–600 thick, key 300; show earth hatch (EARTH) on the retained side and concrete hatch (ANSI31 or AR-CONC) on the section.
- Structure: column grid 4–8 m (6 m typical, 8–9 m for parking), columns 300×300 to 600×600 (RCC) or 230×450, beams 230×450–300×600, slabs 125–150 thick, footings 1500–2500 square × 450–600 deep at 1.5–2 m below ground. Grid bubbles Ø 8 mm plotted (800 at 1:100), letters A,B,C along X, numbers 1,2,3 along Y.
- Bridges: deck width = carriageway + 2×kerb/footpath + 2×parapet 450; parapet 1100 high; girder depth ≈ span/15–20; bearing shelf 600–800; abutment wall 800–1200.
- Sections: hatch concrete ANSI31 (or AR-CONC), steel ANSI32, earth EARTH, brick BRICK/ANSI31 at 45°, insulation INSUL, sand/fill AR-SAND. Hatch scale ≈ 25–50 at 1:100 for line patterns; SOLID for thin members and glazing infill.

## Composition rules
- One command → one coherent group: outline first, then openings, then fixtures, then labels, then dimensions.
- Keep parallel walls exactly parallel and corners exactly closed; use closed polylines for outlines.
- Use draw.room for a walled room with doors/windows, draw.grid for a column grid, library.insert or generate.drawing for parametric civil components, and draw.entities for anything else (furniture, fixtures, symbols, road edges, arbitrary shapes).
- Keep an emitted plan under ~300 primitives; if the user asks for a whole building, produce the shell and major rooms and offer to detail one area next.
`.trim();
