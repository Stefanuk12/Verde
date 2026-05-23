// Public type surface for third-party extensions that depend on `Dvitash.verde`.
//
// Consumers obtain the API like this:
//
//   import type { VerdeApi } from "Dvitash.verde";
//
//   const verde = vscode.extensions.getExtension<VerdeApi>("Dvitash.verde");
//   const api   = await verde?.activate();
//
// Add `"extensionDependencies": ["Dvitash.verde"]` to your extension's package.json so Verde activates before yours.

import * as vscode from "vscode";

export interface VerdeNode {
	id: string;
	name: string;
	className: string;
	parentId: string | null;
	children: string[];
	disabled?: boolean;
	runContext?: string;
}

export interface VerdeContextMenuItem {
	id: string;
	label: string;
	command: string;
	/** Sort bucket; must match /^([5-9]|[1-9][0-9]+)_/ (e.g. "5_mygame"). */
	group?: string;
	order?: number;
	when?: (node: VerdeNode) => boolean;
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
