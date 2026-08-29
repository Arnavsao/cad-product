export class ListHelper {
  // Matches: <optional indent> <marker> <at least one space>
  // Markers: bullet (•, -, *), number (123.), lower alpha (a., ab.), upper alpha (A., AB.)
  static readonly MARKER = /^(\s*)([•\-\*]|\d+\.|[a-z]+\.|[A-Z]+\.)(\s+)/;

  static incrementAlpha(str: string): string {
    let result = '';
    let carry = true;
    for (let i = str.length - 1; i >= 0; i--) {
      const code = str.charCodeAt(i);
      const isUpper = code >= 65 && code <= 90;
      const base = isUpper ? 65 : 97;
      
      if (carry) {
        if (code - base === 25) { // 'z' or 'Z'
          result = String.fromCharCode(base) + result;
          carry = true;
        } else {
          result = String.fromCharCode(code + 1) + result;
          carry = false;
        }
      } else {
        result = str[i] + result;
      }
    }
    if (carry) {
      const base = str.charCodeAt(0) >= 65 && str.charCodeAt(0) <= 90 ? 65 : 97;
      result = String.fromCharCode(base) + result;
    }
    return result;
  }

  static getNextPrefix(prefix: string): string {
    if (/^\d+\.$/.test(prefix)) {
      return `${parseInt(prefix, 10) + 1}.`;
    }
    if (/^[a-z]+\.$/.test(prefix)) {
      return `${this.incrementAlpha(prefix.slice(0, -1))}.`;
    }
    if (/^[A-Z]+\.$/.test(prefix)) {
      return `${this.incrementAlpha(prefix.slice(0, -1))}.`;
    }
    return prefix;
  }

  static onEnter(ta: HTMLTextAreaElement): boolean {
    const start = ta.selectionStart;
    const val = ta.value;
    
    let lineStart = val.lastIndexOf('\n', start - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    const lineStr = val.substring(lineStart, start);
    
    const match = lineStr.match(this.MARKER);
    if (match) {
      const [, indent, marker, space] = match;
      const fullMarker = indent + marker + space;
      
      // If line is ONLY the marker, exit list (clear marker)
      if (lineStr === fullMarker) {
        ta.value = val.substring(0, lineStart) + val.substring(start);
        ta.selectionStart = ta.selectionEnd = lineStart;
        return true;
      }
      
      // Auto-continue list
      const nextMarker = this.getNextPrefix(marker);
      const insertStr = '\n' + indent + nextMarker + space;
      ta.value = val.substring(0, start) + insertStr + val.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + insertStr.length;
      return true;
    }
    return false;
  }

  static onBackspace(ta: HTMLTextAreaElement): boolean {
    const start = ta.selectionStart;
    if (start !== ta.selectionEnd) return false;
    
    const val = ta.value;
    let lineStart = val.lastIndexOf('\n', start - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    const lineStr = val.substring(lineStart, start);
    
    const match = lineStr.match(this.MARKER);
    if (match) {
      const fullMarker = match[0];
      // Only delete marker if cursor is exactly at the end of it
      if (lineStr === fullMarker) {
        ta.value = val.substring(0, lineStart) + val.substring(start);
        ta.selectionStart = ta.selectionEnd = lineStart;
        return true;
      }
    }
    return false;
  }

  static toggleListType(ta: HTMLTextAreaElement, typeMarker: string): void {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    
    let lineStart = val.lastIndexOf('\n', start - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    
    const selectedLines = val.substring(lineStart, lineEnd).split('\n');
    
    let currentNum = 1;
    let currentLower = 'a';
    let currentUpper = 'A';
    
    const newLines = selectedLines.map(line => {
      let cleanLine = line;
      const match = line.match(this.MARKER);
      if (match) {
        cleanLine = line.substring(match[0].length);
      }
      
      if (!typeMarker) return cleanLine;
      
      let marker = typeMarker;
      if (typeMarker === '1. ') { marker = currentNum++ + '. '; }
      else if (typeMarker === 'a. ') { marker = currentLower + '. '; currentLower = this.incrementAlpha(currentLower); }
      else if (typeMarker === 'A. ') { marker = currentUpper + '. '; currentUpper = this.incrementAlpha(currentUpper); }
      
      return marker + cleanLine;
    });
    
    const replaceStr = newLines.join('\n');
    ta.value = val.substring(0, lineStart) + replaceStr + val.substring(lineEnd);
    
    const newPos = lineStart + replaceStr.length;
    ta.selectionStart = newPos;
    ta.selectionEnd = newPos;
  }

  static onTab(ta: HTMLTextAreaElement, shift: boolean): boolean {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    
    let lineStart = val.lastIndexOf('\n', start - 1);
    lineStart = lineStart === -1 ? 0 : lineStart + 1;
    let lineEnd = val.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = val.length;
    
    const selectedLines = val.substring(lineStart, lineEnd).split('\n');
    
    let changed = false;
    const newLines = selectedLines.map(line => {
      const match = line.match(this.MARKER);
      if (match) {
        changed = true;
        let [, indent, marker, space] = match;
        if (!shift) {
          indent += '    ';
        } else {
          indent = indent.replace(/^ {1,4}/, '');
        }
        return indent + marker + space + line.substring(match[0].length);
      }
      return line;
    });
    
    if (changed) {
      const replaceStr = newLines.join('\n');
      ta.value = val.substring(0, lineStart) + replaceStr + val.substring(lineEnd);
      ta.selectionStart = lineStart;
      ta.selectionEnd = lineStart + replaceStr.length;
      return true;
    }
    return false;
  }
}
