import * as vscode from "vscode";
import { Node } from "./robloxExplorerProvider";
import { isScriptClass } from "./utils";
import { ExecuteLuauOptions, ExecuteLuauResult } from "./luauExecutionService";

export interface VerdeContextMenuItem {
  id: string;
  label: string;
  command: string;
  group?: string;
  order?: number;
  when?: (node: Node) => boolean;
}

export interface SerializedContextMenuItem {
  id: string;
  label: string;
  command: string;
  group: string;
  order: number;
}

const DEFAULT_GROUP = "9_extension";
const DEFAULT_ORDER = 100;

const BUILT_IN_ITEMS: VerdeContextMenuItem[] = [
  {
    id: "verde.rename",
    label: "Rename",
    command: "verde.renameInstance",
    group: "1_modify",
    order: 10,
  },
  {
    id: "verde.duplicate",
    label: "Duplicate",
    command: "verde.duplicateInstance",
    group: "1_modify",
    order: 20,
  },
  {
    id: "verde.delete",
    label: "Delete",
    command: "verde.deleteInstance",
    group: "1_modify",
    order: 30,
  },
  {
    id: "verde.addChild",
    label: "Add Child...",
    command: "verde.addInstance",
    group: "1_modify",
    order: 40,
  },
  {
    id: "verde.copy",
    label: "Copy",
    command: "verde.copyInstance",
    group: "2_clipboard",
    order: 10,
  },
  {
    id: "verde.paste",
    label: "Paste",
    command: "verde.pasteInstance",
    group: "2_clipboard",
    order: 20,
  },
  {
    id: "verde.copyPath",
    label: "Copy Roblox Path",
    command: "verde.copyRobloxPath",
    group: "3_path",
    order: 10,
  },
  {
    id: "verde.copyFilePath",
    label: "Copy File Path",
    command: "verde.copyFilePath",
    group: "3_path",
    order: 20,
    when: (n) => isScriptClass(n.className),
  },
  {
    id: "verde.openScript",
    label: "Open Script",
    command: "verde.openScript",
    group: "4_script",
    order: 10,
    when: (n) => isScriptClass(n.className),
  },
];

const BUILT_IN_IDS: ReadonlySet<string> = new Set(
  BUILT_IN_ITEMS.map((it) => it.id),
);

export class ContextMenuRegistry {
  private items: Map<string, VerdeContextMenuItem> = new Map();

  public register(item: VerdeContextMenuItem): vscode.Disposable {
    if (!item.id || !item.label || !item.command) {
      throw new Error(
        "Verde context menu item requires id, label, and command.",
      );
    }
    if (BUILT_IN_IDS.has(item.id)) {
      throw new Error(
        `Verde context menu item id "${item.id}" collides with a built-in item.`,
      );
    }
    if (this.items.has(item.id)) {
      throw new Error(
        `Verde context menu item id "${item.id}" is already registered.`,
      );
    }
    this.items.set(item.id, item);
    return new vscode.Disposable(() => {
      this.items.delete(item.id);
    });
  }

  public itemsFor(node: Node): SerializedContextMenuItem[] {
    const all = [...BUILT_IN_ITEMS, ...this.items.values()];
    return all
      .filter((it) => !it.when || safeWhen(it, node))
      .map((it) => ({
        id: it.id,
        label: it.label,
        command: it.command,
        group: it.group ?? DEFAULT_GROUP,
        order: it.order ?? DEFAULT_ORDER,
      }))
      .sort((a, b) => {
        if (a.group !== b.group) {
          return a.group < b.group ? -1 : 1;
        }
        if (a.order !== b.order) {
          return a.order - b.order;
        }
        return a.label < b.label ? -1 : 1;
      });
  }
}

function safeWhen(item: VerdeContextMenuItem, node: Node): boolean {
  try {
    return !!item.when!(node);
  } catch (err) {
    console.error(`Verde context menu item "${item.id}" when() threw:`, err);
    return false;
  }
}

export interface VerdeApi {
  registerContextMenuItem(item: VerdeContextMenuItem): vscode.Disposable;
  executeLuau(options: ExecuteLuauOptions): Promise<ExecuteLuauResult>;
}
