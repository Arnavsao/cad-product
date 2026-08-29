export interface IAttDef {
  tag: string;
  prompt: string;
  defaultValue: string;
  x: number;
  y: number;
  height: number;
  rotation: number;
  invisible: boolean;
  constant: boolean;
  verify: boolean;
  preset: boolean;
}

export interface IAttrib {
  tag: string;
  value: string;
  x: number;
  y: number;
  height: number;
  rotation: number;
  invisible: boolean;
}

export function attDefFromDxf(ent: any): IAttDef {
  const flags = ent.flags ?? ent.attributeFlags ?? 0;
  return {
    tag: ent.tag ?? ent.name ?? '',
    prompt: ent.prompt ?? ent.text ?? '',
    defaultValue: ent.text ?? ent.defaultValue ?? '',
    x: ent.startPoint?.x ?? ent.position?.x ?? 0,
    y: ent.startPoint?.y ?? ent.position?.y ?? 0,
    height: ent.textHeight ?? ent.height ?? 2.5,
    rotation: ent.rotation ?? 0,
    invisible: !!(flags & 1),
    constant: !!(flags & 2),
    verify: !!(flags & 4),
    preset: !!(flags & 8),
  };
}

export function attribFromDxf(ent: any): IAttrib {
  const flags = ent.flags ?? ent.attributeFlags ?? 0;
  return {
    tag: ent.tag ?? ent.name ?? '',
    value: ent.text ?? ent.value ?? '',
    x: ent.startPoint?.x ?? ent.position?.x ?? 0,
    y: ent.startPoint?.y ?? ent.position?.y ?? 0,
    height: ent.textHeight ?? ent.height ?? 2.5,
    rotation: ent.rotation ?? 0,
    invisible: !!(flags & 1),
  };
}

export function attDefToDxf(att: IAttDef, layer = '0'): string {
  const flags = (att.invisible ? 1 : 0) | (att.constant ? 2 : 0) | (att.verify ? 4 : 0) | (att.preset ? 8 : 0);
  return `0\nATTDEF\n8\n${layer}\n10\n${att.x}\n20\n${att.y}\n30\n0.0\n40\n${att.height}\n1\n${att.defaultValue}\n2\n${att.tag}\n3\n${att.prompt}\n50\n${att.rotation}\n70\n${flags}\n`;
}

export function attribToDxf(att: IAttrib, layer = '0'): string {
  const flags = att.invisible ? 1 : 0;
  return `0\nATTRIB\n8\n${layer}\n10\n${att.x}\n20\n${att.y}\n30\n0.0\n40\n${att.height}\n1\n${att.value}\n2\n${att.tag}\n50\n${att.rotation}\n70\n${flags}\n`;
}
