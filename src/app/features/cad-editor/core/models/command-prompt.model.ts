/** A single keyboard-accessible option shown in a command prompt chip. */
export interface ICommandOption {
  /** Single letter the user types to invoke this option, e.g. 'U', 'C', 'R'. */
  key: string;
  /** Full display label starting with the key letter, e.g. 'Undo', 'Close', 'Radius'. */
  label: string;
  /** Optional one-line tooltip hint. */
  hint?: string;
}

/** One workflow phase of a command. */
export interface ICommandPhase {
  /** Stable ID the tool returns via getPhase(), e.g. 'first', 'next', 'select'. */
  id: string;
  /** Instruction text shown after the command name. */
  message: string;
  /** Options available in this phase, rendered as clickable chips. */
  options?: ICommandOption[];
}

/** Complete definition for one command/tool stored in the registry. */
export interface ICommandDef {
  /** Uppercase display name, e.g. 'LINE', 'MOVE', 'FILLET'. */
  command: string;
  /** Ordered workflow phases. */
  phases: ICommandPhase[];
}

/** Live state pushed to the Command Bar each frame. */
export interface ICommandPromptState {
  /** Uppercase command name, empty when idle. */
  command: string;
  /** Current instruction text. */
  message: string;
  /** Options available in the current phase. */
  options: ICommandOption[];
}
