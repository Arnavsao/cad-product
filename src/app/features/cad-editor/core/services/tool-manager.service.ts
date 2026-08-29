import { Injectable, Injector, signal } from '@angular/core';
import { ITool } from '../models/tool.interface';

/**
 * Port of setTool() from 20-tool-manager.js.
 *
 * Tool classes are plain TS classes (no @Injectable). They are instantiated here
 * with the shared Injector so they can resolve any services they need.
 * Tool registration is dynamic — features register their tools on bootstrap.
 */
export type ToolFactory = (injector: Injector) => ITool;
export type AsyncToolFactory = (injector: Injector) => Promise<ITool>;

@Injectable({ providedIn: 'root' })
export class ToolManagerService {
  private factories = new Map<string, ToolFactory>();
  private asyncFactories = new Map<string, AsyncToolFactory>();

  readonly activeToolName = signal<string>('select');
  activeTool: ITool | null = null;

  /**
   * Most recently activated non-{select,pan} tool — the target of AutoCAD-
   * style "repeat last command" triggered by Enter / Space at idle, or by
   * Space inside an empty command bar. Owned here (not in the component)
   * so both the global shortcut handler AND the command-line component can
   * call `repeatLast()` through one path.
   */
  lastNonSelectTool: string | null = null;

  constructor(private injector: Injector) {}

  /** Register a tool factory. Call from feature modules / canvas init. */
  register(name: string, factory: ToolFactory): void {
    this.factories.set(name, factory);
  }

  /** Register an async tool factory for lazy loading. */
  registerAsync(name: string, factory: AsyncToolFactory): void {
    this.asyncFactories.set(name, factory);
  }

  /** Activate a tool by name. Falls back to 'select' if missing. */
  async setTool(name: string): Promise<ITool | null> {
    const prevTool = this.activeTool;
    this.activeTool = null;
    try {
      prevTool?.deactivate?.();
    } catch (err) {
      console.error('Error in tool deactivate:', err);
    }

    const asyncFactory = this.asyncFactories.get(name);
    if (asyncFactory) {
      this.activeToolName.set(name);
      try {
        const tool = await asyncFactory(this.injector);
        if (this.activeToolName() !== name) return null;
        
        this.activeTool = tool;
        if (name && name !== 'select' && name !== 'pan') {
          this.lastNonSelectTool = name;
        }
        try {
          this.activeTool.activate?.();
        } catch (err) {
          console.error('Error in async tool activate:', err);
        }
        return this.activeTool;
      } catch (err) {
        console.error(`Failed to load async tool ${name}:`, err);
        if (this.activeToolName() === name) this.setTool('select');
        return null;
      }
    }

    const factory = this.factories.get(name) ?? this.factories.get('select');
    if (!factory) {
      console.warn(`ToolManager: tool "${name}" not registered and no 'select' fallback available.`);
      this.activeTool = null;
      this.activeToolName.set(name);
      return null;
    }

    this.activeTool = factory(this.injector);
    this.activeToolName.set(name);
    if (name && name !== 'select' && name !== 'pan') {
      this.lastNonSelectTool = name;
    }
    try {
      this.activeTool.activate?.();
    } catch (err) {
      console.error('Error in tool activate:', err);
    }
    return this.activeTool;
  }

  /**
   * Re-activate the last non-{select,pan} tool. Returns true when a tool was
   * actually switched, false when nothing to repeat (no prior tool, or it's
   * already active). Caller uses the return to decide whether to
   * preventDefault / fall through.
   */
  repeatLast(): boolean {
    const target = this.lastNonSelectTool;
    if (!target) return false;
    if (this.activeToolName() === target) return false;
    this.setTool(target);
    return true;
  }

  /** True if `name` matches the active tool — for button highlighting. */
  /**
   * Toggle between Select and the most recently used non-{select,pan} tool.
   * Enter / Space use this for AutoCAD-style command cycling.
   */
  toggleLastOrSelect(): boolean {
    const active = this.activeToolName();
    if (active && active !== 'select' && active !== 'pan') {
      this.setTool('select');
      return true;
    }

    return this.repeatLast();
  }

  isActive(name: string): boolean {
    return this.activeToolName() === name;
  }
}
