import { Injectable } from '@angular/core';

export interface ToolMeta {
  id: string;
  title: string;
  svg: string;
  group: string;
  aliases: string[];
  stub?: boolean;
  hidden?: boolean;
  subTools?: ToolMeta[];
}

export interface ToolSection {
  label: string;
  tools: ToolMeta[];
}

const DRAW: ToolMeta[] = [
  {
    id: 'line', title: 'Line (L)', group: 'Draw', aliases: ['l', 'line'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="14" x2="14" y2="2"/></svg>`
  },
  {
    id: 'polyline', title: 'Polyline (PL)', group: 'Draw', aliases: ['pl', 'polyline'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,13 5,5 9,9 13,3"/></svg>`
  },
  {
    id: 'circle', title: 'Circle (C)', group: 'Draw', aliases: ['c', 'circle'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.5"/><line x1="8" y1="8" x2="13.5" y2="8" stroke-width="1" opacity="0.5"/></svg>`,
    subTools: [
      { id: 'circle', title: 'Center, Radius', group: 'Draw', aliases: ['c', 'circle'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.5"/><line x1="8" y1="8" x2="13.5" y2="8" stroke-width="1" opacity="0.5"/></svg>` },
      { id: 'circle_dia', title: 'Center, Diameter', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.5"/><line x1="2.5" y1="8" x2="13.5" y2="8" stroke-width="1.2"/><polygon points="2.5,8 4.5,7 4.5,9" fill="currentColor" stroke="none"/><polygon points="13.5,8 11.5,7 11.5,9" fill="currentColor" stroke="none"/></svg>` },
      { id: 'circle_2p', title: '2-Point', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.5"/><circle cx="2.5" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="13.5" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>` },
      { id: 'circle_3p', title: '3-Point', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="2.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="11" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="11" r="1.5" fill="currentColor" stroke="none"/></svg>` },
      { id: 'circle_ttr', title: 'Tan, Tan, Radius', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="1" y1="1" x2="1" y2="15"/><line x1="1" y1="15" x2="15" y2="15"/><circle cx="6" cy="10" r="4"/></svg>` },
      { id: 'circle_ttt', title: 'Tan, Tan, Tan', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><polygon points="1,15 15,15 8,1" opacity="0.5"/><circle cx="8" cy="10" r="4"/></svg>` },
    ]
  },
  {
    id: 'arc', title: 'Arc (A)', group: 'Draw', aliases: ['a', 'arc'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/></svg>`,
    subTools: [
      { id: 'arc', title: '3-Point', group: 'Draw', aliases: ['a', 'arc'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="3" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="6" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="3" r="1.5" fill="currentColor" stroke="none"/></svg>` },
      { id: 'arc_sce', title: 'Start, Center, End', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><line x1="10" y1="10" x2="3" y2="13" stroke-width="1" opacity="0.6"/><line x1="10" y1="10" x2="13" y2="3" stroke-width="1" opacity="0.6"/></svg>` },
      { id: 'arc_sca', title: 'Start, Center, Angle', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><line x1="10" y1="10" x2="3" y2="13" stroke-width="1" opacity="0.6"/><line x1="10" y1="10" x2="13" y2="3" stroke-width="1" opacity="0.6"/><path d="M8 11 A2.5 2.5 0 0 1 11 8" stroke-width="1"/></svg>` },
      { id: 'arc_scl', title: 'Start, Center, Length', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><line x1="3" y1="13" x2="13" y2="3" stroke-width="1" stroke-dasharray="2 1" opacity="0.8"/></svg>` },
      { id: 'arc_sea', title: 'Start, End, Angle', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="3" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="3" r="1.5" fill="currentColor" stroke="none"/><path d="M6 10 L10 6" stroke-width="1" opacity="0.6"/><path d="M4 11 A3 3 0 0 1 11 4" stroke-width="1"/></svg>` },
      { id: 'arc_sed', title: 'Start, End, Direction', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="3" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="3" r="1.5" fill="currentColor" stroke="none"/><line x1="3" y1="13" x2="1.5" y2="7.5" stroke-width="1"/><polygon points="1.5,6.5 0,9 3,9" fill="currentColor" stroke="none"/></svg>` },
      { id: 'arc_ser', title: 'Start, End, Radius', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="3" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="3" r="1.5" fill="currentColor" stroke="none"/><line x1="10" y1="10" x2="7" y2="7" stroke-width="1"/><polygon points="6,6 8,6.5 6.5,8" fill="currentColor" stroke="none"/></svg>` },
      { id: 'arc_cse', title: 'Center, Start, End', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="10" cy="10" r="2" stroke-width="1"/><line x1="10" y1="10" x2="3" y2="13" stroke-width="1" opacity="0.6"/><line x1="10" y1="10" x2="13" y2="3" stroke-width="1" opacity="0.6"/></svg>` },
      { id: 'arc_csa', title: 'Center, Start, Angle', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="10" cy="10" r="2" stroke-width="1"/><line x1="10" y1="10" x2="3" y2="13" stroke-width="1" opacity="0.6"/><line x1="10" y1="10" x2="13" y2="3" stroke-width="1" opacity="0.6"/><path d="M8 11 A2.5 2.5 0 0 1 11 8" stroke-width="1"/></svg>` },
      { id: 'arc_csl', title: 'Center, Start, Length', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><circle cx="10" cy="10" r="2" stroke-width="1"/><line x1="3" y1="13" x2="13" y2="3" stroke-width="1" stroke-dasharray="2 1" opacity="0.8"/></svg>` },
      { id: 'arc_cont', title: 'Continue', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 13 A7 7 0 0 1 13 3"/><path d="M1 16 A3 3 0 0 1 3 13" stroke-dasharray="1.5 1.5" stroke-width="1"/><circle cx="3" cy="13" r="1.5" fill="currentColor" stroke="none"/></svg>` },
    ]
  },
  {
    id: 'rect', title: 'Rectangle (REC)', group: 'Draw', aliases: ['rec', 'rect', 'rectangle'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="4" width="12" height="8" rx="0.5"/></svg>`,
    subTools: [
      { id: 'rect', title: 'Rectangle', group: 'Draw', aliases: ['rec', 'rect'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="4" width="12" height="8" rx="0.5"/></svg>` },
      { id: 'polygon', title: 'Polygon', group: 'Draw', aliases: ['pol'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><polygon points="8,2 14,6 12,13 4,13 2,6"/></svg>` }
    ]
  },
  {
    id: 'ellipse', title: 'Ellipse (EL)', group: 'Draw', aliases: ['el', 'ellipse'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="8" cy="8" rx="6" ry="3.5"/></svg>`,
    subTools: [
      { id: 'ellipse', title: 'Center', group: 'Draw', aliases: ['el', 'ellipse'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="8" cy="8" rx="6" ry="3.5"/></svg>` },
      { id: 'ellipse_axis', title: 'Axis, End', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="8" cy="8" rx="6" ry="3.5"/></svg>` },
      { id: 'ellipse_arc', title: 'Elliptical Arc', group: 'Draw', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><ellipse cx="8" cy="8" rx="6" ry="3.5"/></svg>` }
    ]
  },
  {
    id: 'hatch', title: 'Hatch (H)', group: 'Draw', aliases: ['h', 'hatch'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="0.5"/><line x1="2" y1="8" x2="8" y2="2"/><line x1="2" y1="13" x2="13" y2="2"/><line x1="7" y1="14" x2="14" y2="7"/><line x1="12" y1="14" x2="14" y2="12"/></svg>`
  },
  {
    id: 'xline', title: 'XLine (XL)', group: 'Draw', aliases: ['xl', 'xline', 'construction'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 1.5"><line x1="1" y1="15" x2="15" y2="1"/></svg>`,
    subTools: [
      {
        id: 'xline', title: 'XLine (XL)', group: 'Draw', aliases: ['xl', 'xline'],
        svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 1.5"><line x1="1" y1="15" x2="15" y2="1"/></svg>`
      },
      {
        id: 'xline_hor', title: 'XL-H (Horizontal)', group: 'Draw', aliases: ['xlh', 'xline_hor'],
        svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 1.5"><line x1="1" y1="8" x2="15" y2="8"/></svg>`
      },
      {
        id: 'xline_ver', title: 'XL-V (Vertical)', group: 'Draw', aliases: ['xlv', 'xline_ver'],
        svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 1.5"><line x1="8" y1="1" x2="8" y2="15"/></svg>`
      },
    ]
  },
  {
    id: 'spline', title: 'Spline (SP)', group: 'Draw', aliases: ['sp', 'spline'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 12 C4 4, 8 12, 14 4"/></svg>`
  },
  {
    id: 'point', title: 'Point (PO)', group: 'Draw', aliases: ['po', 'point'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="2"/><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/></svg>`
  },
  {
    id: 'table', title: 'Table (TB)', group: 'Draw', aliases: ['tb', 'table'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="9.5" x2="14" y2="9.5"/><line x1="6" y1="6" x2="6" y2="13"/><line x1="10" y1="6" x2="10" y2="13"/></svg>`
  },
  {
    id: 'image', title: 'Image (IM)', group: 'Draw', aliases: ['im', 'image', 'img'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.5"/><polyline points="2,13 6,9 10,13"/><polyline points="8,11 11,8 14,11"/></svg>`
  },
  {
    id: 'symbol', title: 'Symbol (SYM)', group: 'Draw', aliases: ['sym', 'symbol'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13 A4 4 0 1 1 12 13 L14 13 L14 15 L2 15 L2 13 Z"/></svg>`
  },
];

const ANNOTATE: ToolMeta[] = [
  {
    id: 'text', title: 'Text (T)', group: 'Annotate', aliases: ['t', 'text'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="butt" stroke-linejoin="miter"><path d="M3.5 13.5 L8 2.5 L12.5 13.5 M5 10 L11 10"/></svg>`
  },
  {
    id: 'dimension', title: 'Dimension (D)', group: 'Annotate', aliases: ['d', 'dim', 'dimension'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="5" x2="2" y2="11"/><line x1="14" y1="5" x2="14" y2="11"/><polygon points="5,6.5 2,8 5,9.5" fill="currentColor" stroke="none"/><polygon points="11,6.5 14,8 11,9.5" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'centerline', title: 'Centerline (CL)', group: 'Annotate', aliases: ['cl', 'centerline'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="2" y1="3" x2="14" y2="3" stroke-width="1.2" opacity="0.65"/><line x1="2" y1="13" x2="14" y2="13" stroke-width="1.2" opacity="0.65"/><line x1="1" y1="8" x2="15" y2="8" stroke-width="1.6" stroke-dasharray="5 2 1 2"/></svg>`
  },
  {
    id: 'centermark', title: 'Center Mark (CM)', group: 'Annotate', aliases: ['cm', 'centermark', 'center mark'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="8" cy="8" r="5.2" stroke-width="1.2" opacity="0.65"/><line x1="1" y1="8" x2="6.2" y2="8" stroke-width="1.4"/><line x1="9.8" y1="8" x2="15" y2="8" stroke-width="1.4"/><line x1="8" y1="1" x2="8" y2="6.2" stroke-width="1.4"/><line x1="8" y1="9.8" x2="8" y2="15" stroke-width="1.4"/><path d="M6.7 8 H9.3 M8 6.7 V9.3" stroke-width="1.4"/></svg>`
  },
  {
    id: 'dimlinear', title: 'Linear', group: 'Annotate', aliases: ['dimlinear'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="6" x2="13" y2="6"/><line x1="3" y1="3" x2="3" y2="9"/><line x1="13" y1="3" x2="13" y2="9"/><polygon points="5,5 3,6 5,7" fill="currentColor" stroke="none"/><polygon points="11,5 13,6 11,7" fill="currentColor" stroke="none"/></svg>`,
    subTools: [
      { id: 'dimlinear', title: 'Linear', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="3" y1="6" x2="13" y2="6"/><line x1="3" y1="3" x2="3" y2="9"/><line x1="13" y1="3" x2="13" y2="9"/><polygon points="5,5 3,6 5,7" fill="currentColor" stroke="none"/><polygon points="11,5 13,6 11,7" fill="currentColor" stroke="none"/></svg>` },
      { id: 'dimaligned', title: 'Aligned', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="13" x2="13" y2="3"/><line x1="1" y1="11" x2="5" y2="15"/><line x1="11" y1="1" x2="15" y2="5"/></svg>` },
      { id: 'dimangular', title: 'Angular', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13 A10 10 0 0 1 13 3"/><line x1="2" y1="14" x2="14" y2="14"/><line x1="2" y1="14" x2="10" y2="2"/></svg>` },
      { id: 'dimarc', title: 'Arc Length', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 10 A7 7 0 0 1 13 10"/><line x1="3" y1="8" x2="3" y2="12"/><line x1="13" y1="8" x2="13" y2="12"/></svg>` },
      { id: 'dimradius', title: 'Radius', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 14 A10 10 0 0 1 14 2"/><line x1="2" y1="14" x2="9" y2="7"/></svg>` },
      { id: 'dimdiameter', title: 'Diameter', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><line x1="3" y1="13" x2="13" y2="3"/></svg>` },
      { id: 'dimordinate', title: 'Ordinate', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="14" x2="14" y2="14"/><line x1="2" y1="14" x2="2" y2="2"/><line x1="6" y1="14" x2="6" y2="8"/><line x1="2" y1="10" x2="8" y2="10"/></svg>` },
      { id: 'dimjogged', title: 'Jogged', group: 'Annotate', aliases: ['jog', 'dimjog', 'dimjogged'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 8 L11 8 L12 6 L13 10 L14 8 L15 8"/><circle cx="5" cy="8" r="3" stroke-dasharray="2 2"/></svg>` },
    ]
  },
  {
    id: 'mleader', title: 'MLD (MLEADER)', group: 'Annotate', aliases: ['mld', 'mleader'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,13 8,5 13,5"/><polygon points="3,13 5,10.5 5.5,13.5" fill="currentColor" stroke="none"/></svg>`,
    subTools: [
      { id: 'mleader', title: 'Multileader', group: 'Annotate', aliases: ['mld', 'mleader'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,13 8,5 13,5"/><polygon points="3,13 5,10.5 5.5,13.5" fill="currentColor" stroke="none"/></svg>` },
      { id: 'qleader', title: 'Qleader', group: 'Annotate', aliases: ['le', 'qleader'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,13 8,5 13,5"/><polygon points="3,13 5,10.5 5.5,13.5" fill="currentColor" stroke="none"/></svg>` },
      { id: 'leader_add', title: 'Add Leader', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,12 7,6 12,6"/><polygon points="3,12 5,9.5 5.5,12.5" fill="currentColor" stroke="none"/><line x1="12" y1="3" x2="12" y2="9" stroke-width="1.4"/><line x1="9" y1="6" x2="15" y2="6" stroke-width="1.4"/></svg>` },
      { id: 'leader_remove', title: 'Remove Leader', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,12 7,6 12,6"/><polygon points="3,12 5,9.5 5.5,12.5" fill="currentColor" stroke="none"/><line x1="10" y1="3" x2="14" y2="7" stroke-width="1.4"/><line x1="14" y1="3" x2="10" y2="7" stroke-width="1.4"/></svg>` },
      { id: 'leader_align', title: 'Align', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,5 5,8 11,8"/><polygon points="2,5 3.5,4 3.5,6" fill="currentColor" stroke="none"/><polyline points="2,11 5,8 11,8"/><polygon points="2,11 3.5,10 3.5,12" fill="currentColor" stroke="none"/><line x1="11" y1="5" x2="11" y2="11" stroke-width="1.2"/></svg>` },
      { id: 'leader_collect', title: 'Collect', group: 'Annotate', aliases: [], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,4 6,7 12,7"/><polygon points="2,4 3.5,3 3.5,5" fill="currentColor" stroke="none"/><polyline points="2,8 6,7 12,7"/><polygon points="2,8 3.5,7 3.5,9" fill="currentColor" stroke="none"/><polyline points="2,12 6,7 12,7"/><polygon points="2,12 3.5,11 3.5,13" fill="currentColor" stroke="none"/><rect x="12" y="5" width="3" height="4" rx="0.5" stroke-width="1.2"/></svg>` }
    ]
  },
];

const MODIFY: ToolMeta[] = [
  {
    id: 'erase', title: 'Erase (E)', group: 'Modify', aliases: ['e', 'erase', 'del', 'delete'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,4 13,4"/><line x1="6" y1="2" x2="10" y2="2"/><path d="M4.5 4 L5 13 L11 13 L11.5 4"/><line x1="8" y1="6" x2="8" y2="11"/><line x1="6.5" y1="6" x2="6" y2="11"/><line x1="9.5" y1="6" x2="10" y2="11"/></svg>`
  },
  {
    id: 'move', title: 'Move (M) — Select entities first', group: 'Modify', aliases: ['m', 'move'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 L8 14 M2 8 L14 8"/><polygon points="8,2 6.5,5 9.5,5" fill="currentColor" stroke="none"/><polygon points="8,14 6.5,11 9.5,11" fill="currentColor" stroke="none"/><polygon points="2,8 5,6.5 5,9.5" fill="currentColor" stroke="none"/><polygon points="14,8 11,6.5 11,9.5" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'copy', title: 'Copy (CO / CP)', group: 'Modify', aliases: ['co', 'cp', 'copy', 'ctrl+c'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M5 5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v2"/></svg>`
  },
  {
    id: 'stretch', title: 'Stretch — Select entities first', group: 'Modify', aliases: ['stretch', 'str'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="4" width="5" height="5"/><line x1="9" y1="6.5" x2="14" y2="6.5"/><polygon points="14,6.5 11,5 11,8" fill="currentColor" stroke="none"/><line x1="6.5" y1="9" x2="6.5" y2="14"/><polygon points="6.5,14 5,11 8,11" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'rotate', title: 'Rotate (RO) — Select entities first', group: 'Modify', aliases: ['ro', 'rotate'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M13 8 A5 5 0 1 1 9.5 3.2"/><polyline points="9,1 10,3.5 12.5,3" stroke-linejoin="round"/></svg>`
  },
  {
    id: 'torient', title: 'Text Orient (TORIENT) — Select text first', group: 'Modify', aliases: ['torient'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><text x="2" y="12" font-size="10" font-family="sans-serif">T</text><path d="M10 2 A4 4 0 1 1 10 14" stroke-dasharray="2,2"/></svg>`
  },
  {
    id: 'mirror', title: 'Mirror (MI) — Select entities first', group: 'Modify', aliases: ['mi', 'mirror'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="2" x2="8" y2="14" stroke-dasharray="2 1.5"/><polyline points="2,5 5,3 5,8 2,6" opacity="0.7"/><polyline points="14,5 11,3 11,8 14,6"/></svg>`
  },
  {
    id: 'scale', title: 'Scale (SC) — Select entities first', group: 'Modify', aliases: ['sc', 'scale'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="6" height="6"/><rect x="2" y="2" width="12" height="12" stroke-dasharray="2 1.5"/></svg>`
  },
  {
    id: 'trim', title: 'Trim (TR)', group: 'Modify', aliases: ['tr', 'trim'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="8" y1="9" x2="8" y2="13" stroke-dasharray="2 1.5" opacity="0.4"/><line x1="6" y1="5" x2="10" y2="11"/></svg>`,
    subTools: [
      { id: 'trim', title: 'Trim', group: 'Modify', aliases: ['tr', 'trim'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="8" x2="14" y2="8"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="8" y1="9" x2="8" y2="13" stroke-dasharray="2 1.5" opacity="0.4"/><line x1="6" y1="5" x2="10" y2="11"/></svg>` },
      { id: 'extend', title: 'Extend', group: 'Modify', aliases: ['ex', 'extend'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="2" x2="12" y2="14"/><line x1="2" y1="8" x2="8" y2="8"/><line x1="8" y1="8" x2="12" y2="8" stroke-dasharray="2 1.5"/><polygon points="8,6.5 11,8 8,9.5" fill="currentColor" stroke="none"/></svg>` }
    ]
  },
  {
    id: 'fillet', title: 'Fillet (F)', group: 'Modify', aliases: ['f', 'fillet'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="14" x2="2" y2="5"/><path d="M2 5 Q2 2 5 2"/><line x1="5" y1="2" x2="14" y2="2"/></svg>`,
    subTools: [
      { id: 'fillet', title: 'Fillet', group: 'Modify', aliases: ['f', 'fillet'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="14" x2="2" y2="5"/><path d="M2 5 Q2 2 5 2"/><line x1="5" y1="2" x2="14" y2="2"/></svg>` },
      { id: 'chamfer', title: 'Chamfer', group: 'Modify', aliases: ['cha', 'chamfer'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="2" y1="14" x2="2" y2="6"/><line x1="2" y1="6" x2="6" y2="2"/><line x1="6" y1="2" x2="14" y2="2"/></svg>` },
      { id: 'blend_curves', title: 'Blend Curves', group: 'Modify', aliases: ['blend'], svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 14 C2 8, 8 2, 14 2"/></svg>` }
    ]
  },
  {
    id: 'offset', title: 'Offset (O)', group: 'Modify', aliases: ['o', 'offset'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12 Q3 4 8 4"/><path d="M5 14 Q5 2 11 2" opacity="0.5"/><line x1="10" y1="8" x2="14" y2="8"/><polygon points="14,8 11,6.5 11,9.5" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'join', title: 'Join (J)', group: 'Modify', aliases: ['j', 'join'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="14" y2="8"/><path d="M6 8 Q8 4 10 8" stroke-dasharray="2 1.5"/></svg>`
  },
  {
    id: 'matchprop', title: 'Match Properties (MA)', group: 'Modify', aliases: ['ma', 'matchprop'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M3 13 L5 8 L13 2 L14 3 L6 11 Z"/><line x1="6" y1="11" x2="5" y2="15"/><line x1="5" y1="15" x2="3" y2="13"/></svg>`
  },
  {
    id: 'draworder', title: 'Draw Order (DR)', group: 'Modify', aliases: ['dr', 'draworder'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="8" height="8" rx="0.5" stroke-dasharray="2 1.5"/><rect x="6" y="6" width="8" height="8" rx="0.5"/><path d="M12 2 L12 4 M14 4 L12 4" stroke-width="1.2"/></svg>`
  },
  {
    id: 'explode', title: 'Explode (X)', group: 'Modify', aliases: ['x', 'explode'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="2" x2="8" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="2" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="14" y2="8"/></svg>`
  },
  {
    id: 'select', title: 'Select (S)', group: 'Modify', aliases: ['s', 'select'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2 L3 12 L6.5 9.5 L8.5 14 L10 13.5 L8 8.5 L12 8.5 Z" fill="currentColor" opacity="0.15"/><path d="M3 2 L3 12 L6.5 9.5 L8.5 14 L10 13.5 L8 8.5 L12 8.5 Z"/></svg>`
  },
  {
    id: 'cursorsize', title: 'Cursor Size (CURSORSIZE)', group: 'System', aliases: ['cursorsize'],  hidden: true,
    svg: ``
  },
  {
    id: 'pickboxsize', title: 'Pickbox Size (PICKBOXSIZE)', group: 'System', aliases: ['pickboxsize', 'pickbox'], hidden: true,
    svg: ``
  },
  {
    id: 'pan', title: 'Pan (P)', group: 'Modify', aliases: ['p', 'pan'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="1" x2="8" y2="15"/><line x1="1" y1="8" x2="15" y2="8"/><polygon points="8,1 6,4 10,4" fill="currentColor" stroke="none"/><polygon points="8,15 6,12 10,12" fill="currentColor" stroke="none"/><polygon points="1,8 4,6 4,10" fill="currentColor" stroke="none"/><polygon points="15,8 12,6 12,10" fill="currentColor" stroke="none"/></svg>`
  },
];

const SYSTEM: ToolMeta[] = [
  {
    id: 'layers', title: 'Layers (LA)', group: 'System', aliases: ['la', 'layer', 'layers'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8 L8 4.5 L14 8 L8 11.5 Z"/><path d="M2 11 L8 14.5 L14 11" opacity="0.5"/><path d="M2 5 L8 1.5 L14 5" opacity="0.5"/></svg>`
  },
  {
    id: 'properties', title: 'Properties (PR)', group: 'System', aliases: ['pr', 'prop', 'properties'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><line x1="5" y1="5.5" x2="11" y2="5.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="10.5" x2="8" y2="10.5"/></svg>`
  },
  {
    id: 'library', title: 'Library (LIB)', group: 'System', aliases: ['lib', 'library'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h3v10H2z"/><path d="M7 3h3v10H7z"/><path d="M12 3l2.5 1-3 9-2.5-1z"/></svg>`
  },
  {
    id: 'settings', title: 'Settings (SET)', group: 'System', aliases: ['set', 'settings', 'options'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>`
  },
  {
    id: 'blocks', title: 'Blocks Palette (BLOCKS)', group: 'System', aliases: ['blocks', 'blockspalette'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="0.5"/><rect x="9" y="2" width="5" height="5" rx="0.5"/><rect x="2" y="9" width="5" height="5" rx="0.5"/><rect x="9" y="9" width="5" height="5" rx="0.5"/></svg>`
  },
  {
    id: 'viewports', title: 'Viewports (VP)', group: 'System', aliases: ['vp', 'viewport', 'viewports'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1"/><rect x="4" y="4" width="8" height="8" rx="0.5" stroke-dasharray="2 1.5"/></svg>`
  },
  {
    id: 'dimstyle', title: 'Dimension Style (DIMSTYLE)', group: 'System', aliases: ['dimstyle', 'dimsty', 'dst', 'd'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1"/><line x1="5" y1="5.5" x2="11" y2="5.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="10.5" x2="8" y2="10.5"/></svg>`
  },
  {
    id: 'find', title: 'Find and Replace (FIND)', group: 'System', aliases: ['find', 'replace', 'search'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4"/><line x1="10" y1="10" x2="14" y2="14"/></svg>`
  },

  // Separation of creation commands
  {
    id: 'create_block', title: 'Block (B)', group: 'System', aliases: ['b', 'block', 'bmake', 'blockmake'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="0.5"/><rect x="9" y="2" width="5" height="5" rx="0.5"/><rect x="2" y="9" width="5" height="5" rx="0.5"/><rect x="9" y="9" width="5" height="5" rx="0.5"/><line x1="11.5" y1="8" x2="11.5" y2="14"/><line x1="8.5" y1="11.5" x2="14.5" y2="11.5"/></svg>`
  },
  {
    id: 'insert_block', title: 'Insert Block (I)', group: 'System', aliases: ['i', 'insert', 'insertblock'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="0.5"/><rect x="9" y="2" width="5" height="5" rx="0.5"/><rect x="2" y="9" width="5" height="5" rx="0.5"/><polyline points="10,10 12,13 14,10"/></svg>`
  },
  {
    id: 'bedit', title: 'Block Edit (BEDIT)', group: 'System', aliases: ['bedit', 'blockedit'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="5" height="5" rx="0.5"/><rect x="9" y="2" width="5" height="5" rx="0.5"/><rect x="2" y="9" width="5" height="5" rx="0.5"/><path d="M10 10l4 4M12 10l2 2-4 4"/></svg>`
  },
  {
    id: 'bclose', title: 'Block Close (BCLOSE)', group: 'System', aliases: ['bclose', 'blockclose'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="1"/><line x1="6" y1="6" x2="10" y2="10"/><line x1="10" y1="6" x2="6" y2="10"/></svg>`
  },
  {
    id: 'mview', title: 'Make Viewport (MVIEW)', group: 'System', aliases: ['mview', 'mv', 'viewportcreate'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="1"/><rect x="4" y="4" width="8" height="8" rx="0.5" stroke-dasharray="2 1.5"/><line x1="8" y1="4" x2="8" y2="12"/><line x1="4" y1="8" x2="12" y2="8"/></svg>`
  },
  {
    id: 'layout', title: 'Layout Manager (LAYOUT)', group: 'System', aliases: ['layout', 'layoutmanager'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="1"/><line x1="2" y1="12" x2="14" y2="12"/><line x1="5" y1="12" x2="5" y2="14"/><line x1="11" y1="12" x2="11" y2="14"/></svg>`
  },
  {
    id: 'pagesetup', title: 'Page Setup (PAGESETUP)', group: 'System', aliases: ['pagesetup', 'ps'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="1" width="10" height="14" rx="1"/><line x1="5" y1="5" x2="11" y2="5"/><line x1="5" y1="7.5" x2="11" y2="7.5"/><line x1="5" y1="10" x2="9" y2="10"/></svg>`
  },
  {
    id: 'mspace', title: 'Model Space (MSPACE)', group: 'System', aliases: ['mspace', 'ms'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="1" width="14" height="14" rx="1" stroke-dasharray="3 1.5"/><circle cx="8" cy="8" r="3"/></svg>`
  },
  {
    id: 'pspace', title: 'Paper Space (PSPACE)', group: 'System', aliases: ['pspace'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="1" y="1" width="14" height="14" rx="1"/><rect x="4" y="4" width="8" height="8" stroke-dasharray="2 1.5"/></svg>`
  },
  {
    id: 'libadd', title: 'Add to Library (LIBADD)', group: 'System', aliases: ['libadd'], stub: true,
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h3v10H2z"/><path d="M7 3h3v10H7z"/><line x1="12" y1="6" x2="12" y2="12"/><line x1="9" y1="9" x2="15" y2="9"/></svg>`
  },
  {
    id: 'libinsert', title: 'Insert from Library (LIBINSERT)', group: 'System', aliases: ['libinsert'], stub: true,
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h3v10H2z"/><path d="M7 3h3v10H7z"/><polyline points="10,8 13,11 16,8"/><line x1="13" y1="4" x2="13" y2="11"/></svg>`
  },

  // ── Clipboard ─────────────────────────────────────────────────────────
  {
    id: 'copy', title: 'Copy (CO / CP)', group: 'Modify', aliases: ['co', 'cp', 'copy', 'ctrl+c'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M5 5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v2"/></svg>`
  },
  {
    id: 'copybase', title: 'Copy with Base Point (COPYBASE)', group: 'Modify', aliases: ['copybase', 'ctrl+shift+c'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M5 5V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v2"/><circle cx="5" cy="14" r="1" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'cutclip', title: 'Cut (CUTCLIP)', group: 'Modify', aliases: ['cutclip', 'cut', 'ctrl+x'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><line x1="6" y1="5" x2="14" y2="11"/><line x1="6" y1="11" x2="14" y2="5"/></svg>`
  },
  {
    id: 'pasteclip', title: 'Paste (PASTECLIP)', group: 'Modify', aliases: ['pasteclip', 'paste', 'ctrl+v'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="10" height="10" rx="1"/><path d="M6 2h4v3H6z"/></svg>`
  },
  {
    id: 'pasteorig', title: 'Paste Original (PASTEORIG)', group: 'Modify', aliases: ['pasteorig', 'ctrl+shift+v'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="10" height="10" rx="1"/><path d="M6 2h4v3H6z"/><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'pasteblock', title: 'Paste as Block (PASTEBLOCK)', group: 'Modify', aliases: ['pasteblock', 'ctrl+shift+v'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="10" height="10" rx="1"/><path d="M6 2h4v3H6z"/><rect x="6" y="8" width="4" height="4" rx="0.5"/></svg>`
  },

  // ── Print / Plot / Export / Publish ────────────────────────────────────
  {
    id: 'plot', title: 'Plot (PLOT)', group: 'Output', aliases: ['plot', 'print', 'ctrl+p'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6V2h8v4"/><rect x="2" y="6" width="12" height="6" rx="1"/><rect x="4" y="10" width="8" height="4"/><circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'export', title: 'Export (EXPORT)', group: 'Output', aliases: ['export', 'exp', 'ctrl+e', 'save as'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v8"/><polyline points="5,6 8,9 11,6"/><path d="M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2"/></svg>`
  },
  {
    id: 'publish', title: 'Publish (PUBLISH)', group: 'Output', aliases: ['publish'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="9" height="11" rx="1"/><path d="M5 6h3M5 8.5h3M5 11h2"/><path d="M11 6h3v8a1 1 0 0 1-1 1H6"/></svg>`
  },
  {
    id: 'exportpdf', title: 'Export PDF (PDF)', group: 'Output', aliases: ['pdf', 'exportpdf', 'topdf'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v3h3"/></svg>`
  },
  {
    id: 'exportpng', title: 'Export PNG (PNG)', group: 'Output', aliases: ['png', 'exportpng'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.2"/><polyline points="3,12 6,9 9,12"/><polyline points="8,11 11,8 14,11"/></svg>`
  },
  {
    id: 'exportjpg', title: 'Export JPG (JPG)', group: 'Output', aliases: ['jpg', 'jpeg', 'exportjpg'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.2"/><polyline points="3,12 6,9 9,12"/><polyline points="8,11 11,8 14,11"/></svg>`
  },
  {
    id: 'exportsvg', title: 'Export SVG (SVG)', group: 'Output', aliases: ['svg', 'exportsvg'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8 C4 3, 8 13, 14 8"/><circle cx="2" cy="8" r="1.2" fill="currentColor" stroke="none"/><circle cx="14" cy="8" r="1.2" fill="currentColor" stroke="none"/></svg>`
  },
  {
    id: 'exportdxf', title: 'Export DXF (DXFOUT)', group: 'Output', aliases: ['dxf', 'dxfout', 'exportdxf', 'saveas'],
    svg: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M5 9l2 3M7 9l-2 3M9 9v3M9 9h1.5M9 10.5h1"/></svg>`
  },
];

const SECTIONS: ToolSection[] = [
  { label: 'Draw', tools: DRAW },
  { label: 'Modify', tools: MODIFY },
  { label: 'Annotate', tools: ANNOTATE },
];

const ALL: ToolMeta[] = [];
const _seen = new Set<string>();
function _addTool(t: ToolMeta) {
  if (!_seen.has(t.id)) {
    _seen.add(t.id);
    ALL.push(t);
  }
  if (t.subTools) {
    t.subTools.forEach(_addTool);
  }
}
SECTIONS.flatMap((s) => s.tools).forEach(_addTool);
SYSTEM.forEach(_addTool);

@Injectable({ providedIn: 'root' })
export class ToolCatalogService {
  getGrouped(): ToolSection[] {
    return SECTIONS
      .map((section) => ({
        ...section,
        tools: section.tools
          .filter((tool) => !tool.hidden)
          .map((tool) => ({
            ...tool,
            subTools: tool.subTools?.filter((subTool) => !subTool.hidden),
          })),
      }))
      .filter((section) => section.tools.length > 0);
  }

  getAll(): ToolMeta[] {
    return ALL;
  }

  getById(id: string): ToolMeta | undefined {
    return ALL.find((t) => t.id === id);
  }

  /**
   * Rank-based fuzzy search over id/aliases/title.
   * Rank: exact-alias > id-prefix > title-prefix > alias-prefix > id-substring > title-substring.
   * De-duplicates by id, returns top 8, skips stubs.
   */
  search(query: string): ToolMeta[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    type Hit = { tool: ToolMeta; rank: number };
    const hits: Hit[] = [];

    for (const t of ALL) {
      if (t.stub) continue;
      const id = t.id.toLowerCase();
      const title = t.title.toLowerCase();
      const aliases = t.aliases.map((a) => a.toLowerCase());

      let rank = -1;
      if (aliases.includes(q)) rank = 0;
      else if (id.startsWith(q)) rank = 1;
      else if (title.startsWith(q)) rank = 2;
      else if (aliases.some((a) => a.startsWith(q))) rank = 3;
      else if (id.includes(q)) rank = 4;
      else if (title.includes(q)) rank = 5;

      if (rank >= 0) hits.push({ tool: t, rank });
    }

    hits.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.tool.id.localeCompare(b.tool.id);
    });

    const seen = new Set<string>();
    const out: ToolMeta[] = [];
    for (const h of hits) {
      if (seen.has(h.tool.id)) continue;
      seen.add(h.tool.id);
      out.push(h.tool);
      if (out.length >= 8) break;
    }
    return out;
  }
}
