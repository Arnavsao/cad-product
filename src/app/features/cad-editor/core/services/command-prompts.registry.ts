import type { ICommandDef } from '../models/command-prompt.model';

/**
 * Central registry mapping tool IDs to their AutoCAD-style command definitions.
 * All prompt text lives here — no message strings are hardcoded in individual tools.
 *
 * Phase IDs must match what each tool returns from getPhase().
 * Option keys are single uppercase letters that invoke the option when typed.
 * Label convention: key letter is always the FIRST character of the label
 *   (e.g. key:'U' label:'Undo' → rendered as [U]ndo).
 */
export const COMMAND_PROMPTS: Record<string, ICommandDef> = {

  // ── Draw ─────────────────────────────────────────────────────────────────

  line: {
    command: 'LINE',
    phases: [
      { id: 'first', message: 'Specify first point:' },
      {
        id: 'next', message: 'Specify next point or', options: [
          { key: 'U', label: 'Undo', hint: 'Remove the last segment' },
          { key: 'C', label: 'Close', hint: 'Close the line back to the start point' },
        ]
      },
    ],
  },

  polyline: {
    command: 'PLINE',
    phases: [
      { id: 'first', message: 'Specify start point:' },
      {
        id: 'next', message: 'Specify next point or', options: [
          { key: 'L', label: 'Line', hint: 'Switch to line mode (straight segments)' },
          { key: 'A', label: 'Arc', hint: 'Switch to arc mode (curved segments)' },
          { key: 'U', label: 'Undo', hint: 'Remove the last vertex' },
          { key: 'C', label: 'Close', hint: 'Close the polyline back to the start' },
        ]
      },
    ],
  },

  rect: {
    command: 'RECTANG',
    phases: [
      { id: 'first', message: 'Specify first corner point:' },
      { id: 'opposite', message: 'Specify other corner point:' },
    ],
  },

  polygon: {
    command: 'POLYGON',
    phases: [
      { id: 'sides', message: 'Enter number of sides:' },
      {
        id: 'center', message: 'Specify center of polygon or', options: [
          { key: 'E', label: 'Edge', hint: 'Define polygon by an edge' },
        ]
      },
      {
        id: 'type', message: 'Enter an option', options: [
          { key: 'I', label: 'Inscribed in circle', hint: 'Vertices lie on circle' },
          { key: 'C', label: 'Circumscribed about circle', hint: 'Edges are tangent to circle' },
        ]
      },
      { id: 'radius', message: 'Specify radius of circle:' },
      { id: 'edge_start', message: 'Specify first endpoint of edge:' },
      { id: 'edge', message: 'Specify second endpoint of edge:' },
    ],
  },

  circle: {
    command: 'CIRCLE',
    phases: [
      {
        id: 'center', message: 'Specify center point for circle:', options: [
          { key: '3', label: '3P', hint: '3-Point circle through three points' },
          { key: '2', label: '2P', hint: '2-Point circle by diameter endpoints' },
          { key: 'T', label: 'Ttr', hint: 'Circle tangent to two objects with radius' },
        ]
      },
      {
        id: 'radius', message: 'Specify radius of circle:', options: [
          { key: 'D', label: 'Diameter', hint: 'Specify diameter instead of radius' },
        ]
      },
    ],
  },
  circle_dia: {
    command: 'CIRCLE',
    phases: [
      {
        id: 'center', message: 'Specify center point for circle:', options: [
          { key: 'R', label: 'Radius', hint: 'Switch back to radius mode' },
        ]
      },
      { id: 'diameter', message: 'Specify diameter of circle:' },
    ],
  },
  circle_2p: {
    command: 'CIRCLE',
    phases: [
      { id: 'p1', message: 'Specify first end point of circle\'s diameter:' },
      { id: 'p2', message: 'Specify second end point of circle\'s diameter:' },
    ],
  },
  circle_3p: {
    command: 'CIRCLE',
    phases: [
      { id: 'p1', message: 'Specify first point on circle:' },
      { id: 'p2', message: 'Specify second point on circle:' },
      { id: 'p3', message: 'Specify third point on circle:' },
    ],
  },

  arc: {
    command: 'ARC',
    phases: [
      {
        id: 'p1', message: 'Specify start point of arc or', options: [
          { key: 'C', label: 'Center', hint: 'Specify center point first' },
        ]
      },
      {
        id: 'p2', message: 'Specify second point of arc or', options: [
          { key: 'C', label: 'Center', hint: 'Specify center point' },
          { key: 'E', label: 'End', hint: 'Specify end point' },
        ]
      },
      { id: 'p3', message: 'Specify end point of arc:' },
    ],
  },
  arc_sce: {
    command: 'ARC',
    phases: [
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'center', message: 'Specify center point of arc:' },
      { id: 'end', message: 'Specify end point of arc:' },
    ],
  },
  arc_sca: {
    command: 'ARC',
    phases: [
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'center', message: 'Specify center point of arc:' },
      { id: 'angle', message: 'Specify included angle:' },
    ],
  },
  arc_scl: {
    command: 'ARC',
    phases: [
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'center', message: 'Specify center point of arc:' },
      { id: 'length', message: 'Specify length of chord:' },
    ],
  },
  arc_cse: {
    command: 'ARC',
    phases: [
      { id: 'center', message: 'Specify center point of arc:' },
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'end', message: 'Specify end point of arc:' },
    ],
  },
  arc_csa: {
    command: 'ARC',
    phases: [
      { id: 'center', message: 'Specify center point of arc:' },
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'angle', message: 'Specify included angle:' },
    ],
  },
  arc_csl: {
    command: 'ARC',
    phases: [
      { id: 'center', message: 'Specify center point of arc:' },
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'length', message: 'Specify length of chord:' },
    ],
  },
  arc_sea: {
    command: 'ARC',
    phases: [
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'end', message: 'Specify end point of arc:' },
      { id: 'angle', message: 'Specify included angle:' },
    ],
  },
  arc_sed: {
    command: 'ARC',
    phases: [
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'end', message: 'Specify end point of arc:' },
      { id: 'direction', message: 'Specify tangent direction for start of arc:' },
    ],
  },
  arc_ser: {
    command: 'ARC',
    phases: [
      { id: 'start', message: 'Specify start point of arc:' },
      { id: 'end', message: 'Specify end point of arc:' },
      { id: 'radius', message: 'Specify radius of arc:' },
    ],
  },
  arc_cont: {
    command: 'ARC',
    phases: [
      { id: 'end', message: 'Specify endpoint of arc (continue from last):' },
      { id: 'idle', message: 'No previous arc or line to continue from.' },
    ],
  },

  ellipse: {
    command: 'ELLIPSE',
    phases: [
      {
        id: 'center', message: 'Specify center of ellipse:', options: [
          { key: 'A', label: 'Arc', hint: 'Create an elliptical arc' },
        ]
      },
      { id: 'axis', message: 'Specify endpoint of axis:' },
      { id: 'dist', message: 'Specify distance to other axis:' },
    ],
  },

  ellipse_axis: {
    command: 'ELLIPSE',
    phases: [
      {
        id: 'axis1', message: 'Specify axis endpoint of ellipse:', options: [
          { key: 'A', label: 'Arc', hint: 'Create an elliptical arc' },
          { key: 'C', label: 'Center', hint: 'Start from ellipse center' },
        ]
      },
      { id: 'axis2', message: 'Specify other endpoint of axis:' },
      { id: 'dist', message: 'Specify distance to other axis:' },
    ],
  },

  ellipse_arc: {
    command: 'ELLIPSE_ARC',
    phases: [
      { id: 'axis1', message: 'Specify axis endpoint of elliptical arc:' },
      { id: 'axis2', message: 'Specify other endpoint of axis:' },
      { id: 'dist', message: 'Specify distance to other axis:' },
      { id: 'startAng', message: 'Specify start angle:' },
      { id: 'endAng', message: 'Specify end angle:' },
    ],
  },

  spline: {
    command: 'SPLINE',
    phases: [
      { id: 'first', message: 'Specify first point:' },
      {
        id: 'next', message: 'Enter next point or', options: [
          { key: 'U', label: 'Undo', hint: 'Remove last point' },
          { key: 'C', label: 'Close', hint: 'Close the spline' },
        ]
      },
    ],
  },

  xline: {
    command: 'XLINE',
    phases: [
      {
        id: 'first', message: 'Specify a point or', options: [
          { key: 'H', label: 'Hor', hint: 'Create a horizontal XLine' },
          { key: 'V', label: 'Ver', hint: 'Create a vertical XLine' },
          { key: 'A', label: 'Ang', hint: 'Create an angled XLine' },
          { key: 'B', label: 'Bisect', hint: 'Bisect an angle' },
          { key: 'O', label: 'Offset', hint: 'Create XLine offset from existing line' },
        ]
      },
      { id: 'through', message: 'Specify through point:' },
      { id: 'hor-point', message: 'Specify through point (Hor):' },
      { id: 'ver-point', message: 'Specify through point (Ver):' },
      { id: 'ang-angle', message: 'Enter angle of XLine:' },
      { id: 'ang-point', message: 'Specify through point:' },
      { id: 'bisect-vertex', message: 'Specify vertex point:' },
      { id: 'bisect-angle1', message: 'Specify angle start point:' },
      { id: 'bisect-angle2', message: 'Specify angle end point:' },
      { id: 'offset-pick', message: 'Select a line object:' },
      { id: 'offset-dist', message: 'Specify offset distance:' },
      { id: 'offset-side', message: 'Specify side to offset:' },
    ],
  },

  point: {
    command: 'POINT',
    phases: [
      { id: 'place', message: 'Specify a point:' },
    ],
  },

  hatch: {
    command: 'HATCH',
    phases: [
      {
        id: 'select', message: 'Pick internal point or select objects or', options: [
          { key: 'B', label: 'Boundary', hint: 'Manually select boundary entities' },
        ]
      },
      {
        id: 'confirm', message: 'Press Enter to accept hatch or', options: [
          { key: 'U', label: 'Undo', hint: 'Remove last boundary' },
        ]
      },
    ],
  },

  text: {
    command: 'TEXT',
    phases: [
      { id: 'point', message: 'Specify insertion point:' },
      { id: 'enter', message: 'Enter text:' },
    ],
  },

  centerline: {
    command: 'CENTERLINE',
    phases: [
      { id: 'first', message: 'Select first line:' },
      { id: 'second', message: 'Select second line:' },
    ],
  },

  centermark: {
    command: 'CENTERMARK',
    phases: [
      { id: 'select', message: 'Select circle or arc:' },
    ],
  },

  dimension: {
    command: 'DIMLINEAR',
    phases: [
      { id: 'first-ext', message: 'Specify first extension line origin:' },
      { id: 'second-ext', message: 'Specify second extension line origin:' },
      {
        id: 'dim-line', message: 'Specify dimension line location or', options: [
          { key: 'M', label: 'Mtext', hint: 'Edit dimension text using multiline text' },
          { key: 'T', label: 'Text', hint: 'Edit dimension text' },
          { key: 'H', label: 'Horizontal', hint: 'Force horizontal dimension' },
          { key: 'V', label: 'Vertical', hint: 'Force vertical dimension' },
          { key: 'R', label: 'Rotated', hint: 'Force rotated dimension' },
        ]
      },
    ],
  },

  leader: {
    command: 'LEADER',
    phases: [
      { id: 'start', message: 'Specify leader start point:' },
      {
        id: 'next', message: 'Specify next point or', options: [
          { key: 'U', label: 'Undo', hint: 'Remove last point' },
        ]
      },
      { id: 'end', message: 'Specify leader endpoint:' },
    ],
  },

  viewport: {
    command: 'VPORTS',
    phases: [
      { id: 'first', message: 'Specify corner of viewport:' },
      { id: 'opposite', message: 'Specify opposite corner:' },
    ],
  },

  table: {
    command: 'TABLE',
    phases: [
      { id: 'place', message: 'Specify insertion point:' },
    ],
  },

  image: {
    command: 'IMAGE',
    phases: [
      { id: 'place', message: 'Specify insertion point:' },
    ],
  },

  symbol: {
    command: 'SYMBOL',
    phases: [
      { id: 'place', message: 'Specify insertion point:' },
    ],
  },

  // ── Modify ───────────────────────────────────────────────────────────────

  move: {
    command: 'MOVE',
    phases: [
      { id: 'select', message: 'Select objects:' },
      { id: 'base', message: 'Specify base point:' },
      { id: 'second', message: 'Specify second point:' },
    ],
  },

  chamfer: {
    command: 'CHAMFER',
    phases: [
      {
        id: 'first', message: 'Select first line or', options: [
          { key: 'U', label: 'Undo', hint: 'Undo the last action' },
          { key: 'P', label: 'Polyline', hint: 'Chamfer an entire 2D polyline' },
          { key: 'D', label: 'Distance', hint: 'Set the chamfer distances' },
          { key: 'A', label: 'Angle', hint: 'Set chamfer distance and angle' },
          { key: 'T', label: 'Trim', hint: 'Toggle trim mode on/off' },
          { key: 'E', label: 'mEthod', hint: 'Choose distance or angle method' },
          { key: 'M', label: 'Multiple', hint: 'Stay in chamfer mode after each commit' },
        ]
      },
      { id: 'second', message: 'Select second line or shift-select to apply corner:' },
    ],
  },

  blend_curves: {
    command: 'BLEND',
    phases: [
      {
        id: 'first', message: 'Select first curve or', options: [
          { key: 'CON', label: 'CONtinuity', hint: 'Set the continuity type' },
        ]
      },
      { id: 'second', message: 'Select second curve:' },
    ],
  },

  rotate: {
    command: 'ROTATE',
    phases: [
      { id: 'select', message: 'Select objects:' },
      { id: 'base', message: 'Specify base point:' },
      {
        id: 'angle', message: 'Specify rotation angle or', options: [
          { key: 'C', label: 'Copy', hint: 'Rotate a copy, keep original' },
          { key: 'R', label: 'Reference', hint: 'Rotate using a reference angle' },
        ]
      },
    ],
  },

  torient: {
    command: 'TORIENT',
    phases: [
      { id: 'select', message: 'Select text or block objects:' },
      { id: 'angle', message: 'Specify new absolute rotation or first point:' },
      { id: 'second-point', message: 'Specify second point:' },
    ],
  },

  scale: {
    command: 'SCALE',
    phases: [
      { id: 'select', message: 'Select objects:' },
      { id: 'base', message: 'Specify base point:' },
      {
        id: 'factor', message: 'Specify scale factor or', options: [
          { key: 'C', label: 'Copy', hint: 'Scale a copy, keep original' },
          { key: 'R', label: 'Reference', hint: 'Scale using a reference length' },
        ]
      },
    ],
  },

  mirror: {
    command: 'MIRROR',
    phases: [
      { id: 'select', message: 'Select objects:' },
      { id: 'first', message: 'Specify first point of mirror line:' },
      { id: 'second', message: 'Specify second point of mirror line:' },
      {
        id: 'erase', message: 'Erase source objects?', options: [
          { key: 'Y', label: 'Yes', hint: 'Delete original objects' },
          { key: 'N', label: 'No', hint: 'Keep original objects' },
        ]
      },
    ],
  },

  stretch: {
    command: 'STRETCH',
    phases: [
      { id: 'select', message: 'Select objects to stretch by crossing-window:' },
      { id: 'base', message: 'Specify base point:' },
      { id: 'second', message: 'Specify second point:' },
    ],
  },

  offset: {
    command: 'OFFSET',
    phases: [
      {
        id: 'select', message: 'Select object to offset or', options: [
          { key: 'T', label: 'Through', hint: 'Offset through a specified point instead of by distance' },
          { key: 'E', label: 'Erase', hint: 'Toggle erase source object after offset' },
          { key: 'L', label: 'Layer', hint: 'Offset to current layer or source layer' },
        ]
      },
      {
        id: 'side', message: 'Specify point on side to offset or', options: [
          { key: 'M', label: 'Multiple', hint: 'Create multiple offsets of the same object' },
          { key: 'U', label: 'Undo', hint: 'Undo the last offset' },
          { key: 'E', label: 'Erase', hint: 'Toggle erase source object after offset' },
        ]
      },
    ],
  },

  trim: {
    command: 'TRIM',
    phases: [
      {
        id: 'select', message: 'Select object to trim or', options: [
          { key: 'U', label: 'Undo', hint: 'Undo the last trim' },
          { key: 'E', label: 'eRase', hint: 'Erase selected objects' },
          { key: 'F', label: 'Fence', hint: 'Select objects with a fence line' },
        ]
      },
    ],
  },

  extend: {
    command: 'EXTEND',
    phases: [
      {
        id: 'select', message: 'Select boundary edges or', options: [
          { key: 'U', label: 'Undo', hint: 'Undo the last extension' },
          { key: 'F', label: 'Fence', hint: 'Select objects with a fence line' },
        ]
      },
      {
        id: 'target', message: 'Select object to extend or', options: [
          { key: 'U', label: 'Undo', hint: 'Undo the last extension' },
          { key: 'F', label: 'Fence', hint: 'Select objects with a fence line' },
        ]
      },
    ],
  },

  fillet: {
    command: 'FILLET',
    phases: [
      {
        id: 'first', message: 'Select first object or', options: [
          { key: 'R', label: 'Radius', hint: 'Set the fillet radius' },
          { key: 'T', label: 'Trim', hint: 'Toggle trim mode on/off' },
          { key: 'P', label: 'Polyline', hint: 'Fillet all segments of a polyline' },
          { key: 'M', label: 'Multiple', hint: 'Stay in fillet mode after each commit' },
        ]
      },
      { id: 'second', message: 'Select second object:' },
      { id: 'radius', message: 'Specify fillet radius:' },
    ],
  },

  join: {
    command: 'JOIN',
    phases: [
      { id: 'select', message: 'Select source object:' },
      { id: 'join', message: 'Select objects to join to source:' },
    ],
  },

  // ── Select / Modify ───────────────────────────────────────────────────────

  erase: {
    command: 'ERASE',
    phases: [
      { id: 'select', message: 'Select objects:' },
    ],
  },

  matchprop: {
    command: 'MATCHPROP',
    phases: [
      { id: 'source', message: 'Select source object:' },
      { id: 'dest', message: 'Select destination object(s):' },
    ],
  },

  // ── Block ────────────────────────────────────────────────────────────────

  create_block: {
    command: 'BLOCK',
    phases: [
      { id: 'select', message: 'Select objects:' },
      { id: 'origin', message: 'Specify insertion base point:' },
    ],
  },

  insert_block: {
    command: 'INSERT',
    phases: [
      { id: 'place', message: 'Specify insertion point:' },
    ],
  },

  insert_library_item: {
    command: 'INSERT',
    phases: [
      { id: 'place', message: 'Specify insertion point:' },
    ],
  },

  explode: {
    command: 'EXPLODE',
    phases: [
      { id: 'select', message: 'Select objects:' },
    ],
  },

  bedit: {
    command: 'BEDIT',
    phases: [
      { id: 'select', message: 'Select block reference to edit:' },
    ],
  },

  bclose: {
    command: 'BCLOSE',
    phases: [
      {
        id: 'prompt', message: 'Save changes to block definition?', options: [
          { key: 'Y', label: 'Yes', hint: 'Save and close block editor' },
          { key: 'N', label: 'No', hint: 'Discard changes and close' },
        ]
      },
    ],
  },

  rename_block: {
    command: 'RENAME',
    phases: [
      { id: 'select', message: 'Select block reference to rename:' },
    ],
  },

  // ── Layout / Paper Space ──────────────────────────────────────────────────

  mview: {
    command: 'MVIEW',
    phases: [
      { id: 'first', message: 'Specify corner of viewport:' },
      { id: 'opposite', message: 'Specify opposite corner:' },
    ],
  },

  mspace: {
    command: 'MSPACE',
    phases: [
      { id: 'switch', message: 'Entering Model Space through viewport…' },
    ],
  },

  pspace: {
    command: 'PSPACE',
    phases: [
      { id: 'switch', message: 'Returning to Paper Space…' },
    ],
  },

  layout: {
    command: 'LAYOUT',
    phases: [
      {
        id: 'manage', message: 'Enter layout name or option:', options: [
          { key: 'N', label: 'New', hint: 'Create a new layout' },
          { key: 'D', label: 'Delete', hint: 'Delete a layout' },
          { key: 'R', label: 'Rename', hint: 'Rename a layout' },
          { key: 'S', label: 'Set', hint: 'Make a layout current' },
        ]
      },
    ],
  },

  pagesetup: {
    command: 'PAGESETUP',
    phases: [
      { id: 'configure', message: 'Opening Page Setup for current layout…' },
    ],
  },

  // ── Clipboard ─────────────────────────────────────────────────────────────

  copy: {
    command: 'COPY',
    phases: [
      { id: 'select', message: 'Select objects:' },
      {
        id: 'base', message: 'Specify base point or', options: [
          { key: 'D', label: 'Displacement', hint: 'Specify displacement instead of base point' },
        ]
      },
      {
        id: 'second', message: 'Specify second point or [Exit/Undo]', options: [
          { key: 'U', label: 'Undo', hint: 'Undo last copy placement' },
        ]
      },
    ],
  },

  copybase: {
    command: 'COPYBASE',
    phases: [
      { id: 'base', message: 'Specify base point:' },
      { id: 'select', message: 'Select objects:' },
    ],
  },

  cutclip: {
    command: 'CUTCLIP',
    phases: [
      { id: 'select', message: 'Select objects to cut:' },
    ],
  },

  pasteclip: {
    command: 'PASTECLIP',
    phases: [
      { id: 'insert', message: 'Specify insertion point:' },
    ],
  },

  pasteorig: {
    command: 'PASTEORIG',
    phases: [
      { id: 'paste', message: 'Pasting at original coordinates…' },
    ],
  },

  pasteblock: {
    command: 'PASTEBLOCK',
    phases: [
      { id: 'insert', message: 'Specify insertion point for block:' },
    ],
  },

  // ── Circle sub-variants ───────────────────────────────────────────────────

  circle_ttr: {
    command: 'CIRCLE',
    phases: [
      { id: 'first-tangent', message: 'Select first tangent entity:' },
      { id: 'second-tangent', message: 'Select second tangent entity:' },
      { id: 'radius', message: 'Specify radius of circle:' },
    ],
  },

  circle_ttt: {
    command: 'CIRCLE',
    phases: [
      { id: 'first-tangent', message: 'Select first tangent entity:' },
      { id: 'second-tangent', message: 'Select second tangent entity:' },
      { id: 'third-tangent', message: 'Select third tangent entity:' },
    ],
  },

  // ── Leader sub-tools ──────────────────────────────────────────────────────

  leader_add: {
    command: 'MLEADERADD',
    phases: [
      { id: 'pick-leader', message: 'Select existing leader to add arm to:' },
      { id: 'pick-tip', message: 'Specify new arrowhead location:' },
    ],
  },

  leader_remove: {
    command: 'MLEADERREMOVE',
    phases: [
      { id: 'pick', message: 'Select leader to remove:' },
    ],
  },

  leader_align: {
    command: 'MLEADERALIGN',
    phases: [
      { id: 'pick-leaders', message: 'Select leaders to align (Enter when done):' },
      { id: 'pick-reference', message: 'Select reference leader to align to:' },
    ],
  },

  leader_collect: {
    command: 'MLEADERCOLLECT',
    phases: [
      { id: 'pick', message: 'Select leaders to collect (Enter when done):' },
    ],
  },

  // ── Dimension sub-tools ───────────────────────────────────────────────────

  dimlinear: {
    command: 'DIMLINEAR',
    phases: [
      { id: 'first-ext', message: 'Specify first extension line origin:' },
      { id: 'second-ext', message: 'Specify second extension line origin:' },
      {
        id: 'dim-line', message: 'Specify dimension line location or', options: [
          { key: 'H', label: 'Horizontal', hint: 'Force horizontal dimension' },
          { key: 'V', label: 'Vertical', hint: 'Force vertical dimension' },
        ]
      },
    ],
  },

  dimaligned: {
    command: 'DIMALIGNED',
    phases: [
      { id: 'first-ext', message: 'Specify first extension line origin:' },
      { id: 'second-ext', message: 'Specify second extension line origin:' },
      { id: 'dim-line', message: 'Specify dimension line location:' },
    ],
  },

  dimangular: {
    command: 'DIMANGULAR',
    phases: [
      { id: 'first', message: 'Select arc, circle or first line:' },
      { id: 'second', message: 'Select second line:' },
      { id: 'dim-line', message: 'Specify dimension arc line location:' },
    ],
  },

  dimarc: {
    command: 'DIMARC',
    phases: [
      { id: 'select', message: 'Select arc or polyline arc segment:' },
      { id: 'dim-line', message: 'Specify dimension arc line location:' },
    ],
  },

  dimradius: {
    command: 'DIMRADIUS',
    phases: [
      { id: 'select', message: 'Select arc or circle:' },
      { id: 'dim-line', message: 'Specify dimension line location:' },
    ],
  },

  dimdiameter: {
    command: 'DIMDIAMETER',
    phases: [
      { id: 'select', message: 'Select arc or circle:' },
      { id: 'dim-line', message: 'Specify dimension line location:' },
    ],
  },

  dimordinate: {
    command: 'DIMORDINATE',
    phases: [
      { id: 'point', message: 'Specify feature location:' },
      { id: 'leader', message: 'Specify leader endpoint:' },
    ],
  },

  dimjogged: {
    command: 'DIMJOGGED',
    phases: [
      { id: 'select', message: 'Select arc or circle:' },
      { id: 'center', message: 'Specify center location override:' },
      { id: 'dim-line', message: 'Specify dimension line location:' },
      { id: 'jogged', message: 'Specify jogged symbol location:' },
    ],
  },

  // ── Clipboard / paste ─────────────────────────────────────────────────────

  paste: {
    command: 'PASTE',
    phases: [
      { id: 'insert', message: 'Specify insertion point:' },
    ],
  },

  // ── Draw order ────────────────────────────────────────────────────────────

  draworder: {
    command: 'DRAWORDER',
    phases: [
      { id: 'select', message: 'Select objects:' },
    ],
  },

  // ── System variables ─────────────────────────────────────────────────────

  cursorsize: {
    command: 'CURSORSIZE',
    phases: [
      { id: 'value', message: 'Enter crosshair size (1-100):' },
    ],
  },

  pickboxsize: {
    command: 'PICKBOXSIZE',
    phases: [
      { id: 'value', message: 'Enter pickbox size in pixels (0-50):' },
    ],
  },
};
