import * as vscode from "vscode";
import { Node } from "./robloxExplorerProvider";

export interface VerdeContextMenuItem {
	id: string;
	label: string;
	command: string;
	group?: string;
	order?: number;
	when?: (node: Node) => boolean;
}

export interface ExecuteLuauOptions {
	extension: vscode.Extension<unknown>;
	code: string;
	description?: string;
	nodeId?: string;
}

export type ExecuteLuauResult =
	| { success: true; data?: unknown }
	| { success: false; error: string };

export interface VerdeApi {
	registerContextMenuItem(item: VerdeContextMenuItem): vscode.Disposable;
	executeLuau(options: ExecuteLuauOptions): Promise<ExecuteLuauResult>;
}
