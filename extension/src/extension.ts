import * as vscode from "vscode";
import { RobloxExplorerProvider, Node } from "./robloxExplorerProvider";
import { ExplorerViewProvider } from "./explorerViewProvider";
import { VerdeBackend } from "./backend";
import { PropertiesViewProvider } from "./propertiesViewProvider";
import { getClassNames, initClassNames } from "./robloxClasses";
import { SourcemapParser } from "./sourcemapParser";
import { isScriptClass } from "./utils";
import { InstanceHistory, HistoryEntry } from "./instanceHistory";

import * as fzy from "fzy.js";

let backend: VerdeBackend | null = null;
let sourcemapParser: SourcemapParser;
let propertiesViewProvider: PropertiesViewProvider;
let explorerViewProvider: ExplorerViewProvider;
let instanceHistory: InstanceHistory;
let cachedQuickPickItems: (vscode.QuickPickItem & { node: Node })[] = [];
let cachedSearchStrings: string[] = [];

export async function activate(context: vscode.ExtensionContext) {
	const outputChannel = vscode.window.createOutputChannel("Verde Backend");
	const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

	context.subscriptions.push(outputChannel);
	context.subscriptions.push(statusBarItem);

	const explorerProvider = new RobloxExplorerProvider();
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri || context.extensionUri;
	sourcemapParser = new SourcemapParser(workspaceRoot);
	instanceHistory = new InstanceHistory(10);

	const rebuildQuickPickCache = () => {
		const allNodes = explorerProvider.getAllNodes();
		cachedSearchStrings = [];
		cachedQuickPickItems = allNodes.map((node: Node) => {
			const path: string[] = [node.name];
			let current = node;
			while (current.parentId) {
				const parent = explorerProvider.getNodeById(current.parentId);
				if (!parent) { break; }
				path.unshift(parent.name);
				current = parent;
			}
			const pathString = path.join('.');
			cachedSearchStrings.push(pathString);
			return {
				label: node.name,
				description: node.className,
				detail: pathString,
				iconPath: vscode.Uri.joinPath(context.extensionUri, "assets", `${node.className}.png`),
				alwaysShow: true,
				node
			};
		});
	};

	backend = new VerdeBackend(outputChannel, statusBarItem, (snapshot) => {
		explorerProvider.setSnapshot(snapshot);
		instanceHistory.updateNodeReferences((id: string) => explorerProvider.getNodeById(id));
		rebuildQuickPickCache();
	}, (ops, addedRootIds) => {
		explorerProvider.applyDelta(ops, addedRootIds);
		instanceHistory.updateNodeReferences((id: string) => explorerProvider.getNodeById(id));
		rebuildQuickPickCache();
	}, () => {
		explorerProvider.setSnapshot({ nodes: [], rootIds: [] });
		instanceHistory.clear();
		cachedQuickPickItems = [];
		cachedSearchStrings = [];
	});

	const sourcemapPath = vscode.workspace.getConfiguration('verde').get('sourcemapPath', 'sourcemap.json');
	const watcher = vscode.workspace.createFileSystemWatcher(`**/${sourcemapPath}`);
	watcher.onDidChange(() => sourcemapParser.loadSourcemaps());
	watcher.onDidCreate(() => sourcemapParser.loadSourcemaps());
	watcher.onDidDelete(() => sourcemapParser.loadSourcemaps());
	context.subscriptions.push(watcher);

	const syncScriptDisabledState = (nodeId: string, propertiesData: any) => {
		const node = explorerProvider.getNodeById(nodeId);
		if (!node || !isScriptClass(node.className)) return;

		const properties = Array.isArray(propertiesData.properties) ? propertiesData.properties : [];
		const enabledProperty = properties.find((property: any) => property.name === "Enabled");
		if (typeof enabledProperty?.value === "boolean") {
			explorerProvider.setNodeDisabled(nodeId, !enabledProperty.value);
			return;
		}

		const disabledProperty = properties.find((property: any) => property.name === "Disabled");
		if (typeof disabledProperty?.value === "boolean") {
			explorerProvider.setNodeDisabled(nodeId, disabledProperty.value);
		}
	};

	propertiesViewProvider = new PropertiesViewProvider(backend, context.extensionUri, syncScriptDisabledState);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PropertiesViewProvider.viewType, propertiesViewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	explorerViewProvider = new ExplorerViewProvider(context.extensionUri, explorerProvider, backend);
	backend.setPropertyUpdateCallback(syncScriptDisabledState);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ExplorerViewProvider.viewType, explorerViewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		})
	);

	void initClassNames(context, () => explorerViewProvider.postClassNames());

	context.subscriptions.push(
		vscode.window.onDidChangeActiveColorTheme(() => {
			explorerViewProvider.refreshWebviewHtml();
			propertiesViewProvider.refreshWebviewHtml();
		})
	);

	explorerViewProvider.onSelectionChanged((selection) => {
		if (selection.length === 1) {
			const node = selection[0];
			propertiesViewProvider.show(node);

			const instancePath = getInstancePath(node);
			instanceHistory.add(node, instancePath);
		}
	});

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(async (editor) => {
			if (!editor || !editor.document) {
				return;
			}

			if (!vscode.workspace.getWorkspaceFolder(editor.document.uri)) {
				return;
			}

			if (!explorerViewProvider.isVisible()) {
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = sourcemapParser.findInstancePath(editor.document.uri);

				if (instancePath) {
					const node = explorerProvider.getNodeByInstancePath(instancePath);
					if (node) {
						explorerViewProvider.reveal(node);

						// force-refocus the text editor
						await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
					}
				}
			} catch (error) {
				console.debug('Failed to reveal script node in explorer:', error);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('verde.navigateToInstance', async (instanceId: string) => {
			if (!explorerViewProvider.isVisible()) {
				return;
			}

			const node = explorerProvider.getNodeById(instanceId);
			if (node) {
				explorerViewProvider.reveal(node);
			} else {
				vscode.window.showWarningMessage(`Instance ${instanceId} not found in explorer`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('verde.goToInstance', async () => {
			const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { node: Node }>();
			quickPick.placeholder = 'Type to search instances...';
			quickPick.matchOnDetail = true;

			let debounceTimer: NodeJS.Timeout | undefined;

			quickPick.onDidChangeValue(value => {
				if (debounceTimer) {
					clearTimeout(debounceTimer);
				}

				const query = value.trim().replace(/\s+/g, '.');
				if (!query) {
					quickPick.items = [];
					return;
				}

				quickPick.busy = true;
				debounceTimer = setTimeout(() => {
					const scored: { item: vscode.QuickPickItem & { node: Node }; score: number }[] = [];

					for (let i = 0; i < cachedSearchStrings.length; i++) {
						const str = cachedSearchStrings[i];
						if (fzy.hasMatch(query, str)) {
							scored.push({
								item: cachedQuickPickItems[i],
								score: fzy.score(query, str)
							});
						}
					}

					scored.sort((a, b) => b.score - a.score);

					quickPick.items = scored.slice(0, 50).map(r => r.item);
					quickPick.busy = false;
				}, 50);
			});

			quickPick.onDidAccept(async () => {
				const selected = quickPick.selectedItems[0];
				if (!selected) {
					quickPick.hide();
					return;
				}

				const node = selected.node;
				const isScript = isScriptClass(node.className);

				const instancePath = getInstancePath(node);
				instanceHistory.add(node, instancePath);

				try {
					explorerViewProvider.reveal(node);
				} catch (error) {
					console.debug('Failed to reveal node in explorer:', error);
				}

				if (isScript) {
					await vscode.commands.executeCommand('verde.openScript', node);
				}

				quickPick.hide();
			});

			quickPick.onDidHide(() => quickPick.dispose());
			quickPick.show();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.refreshExplorer", async () => {
			if (backend) {
				await backend.requestSnapshot();
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.collapseAll", () => {
			explorerViewProvider.collapseAll();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.showOutput", () => {
			outputChannel.show(true);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.stopServer", async () => {
			if (!backend) {
				return;
			}
			await backend.stop();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.startServer", async () => {
			if (!backend) {
				return;
			}
			try {
				await backend.start();
			} catch (error) {
				vscode.window.showErrorMessage(`verde backend failed to start: ${String(error)}`);
				outputChannel.show(true);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.renameInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let node: any = null;
			let newNameArg: string | undefined;
			if (args.length > 0 && args[0]) {
				node = args[0];
			}
			if (args.length > 1 && typeof args[1] === "string") {
				newNameArg = args[1];
			}
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) node = sel[0];
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected to rename");
				return;
			}

			// inline rename from webview passes newName; otherwise start inline rename in webview
			if (newNameArg !== undefined) {
				const newName = newNameArg.trim();
				if (!newName) return;
				const isScript = isScriptClass(node.className);
				let oldFileUri: vscode.Uri | null = null;
				if (isScript) {
					await sourcemapParser.loadSourcemaps();
					const oldInstancePath = getInstancePath(node);
					oldFileUri = sourcemapParser.findFilePath(oldInstancePath);
				}
				try {
					const result = await backend.sendOperation({
						type: "rename_instance",
						nodeId: node.id,
						newName
					});
					if (!result.success) {
						vscode.window.showErrorMessage(`Failed to rename instance: ${result.error}`);
					} else if (isScript) {
						await backend.waitForNextSnapshot();
						await sourcemapParser.loadSourcemaps();
						const updatedNode = explorerProvider.getNodeById(node.id);
						if (updatedNode) {
							if (oldFileUri) {
								const tabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
								const tabToClose = tabs.find(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === oldFileUri!.toString());
								if (tabToClose) await vscode.window.tabGroups.close(tabToClose);
							}
							const newInstancePath = getInstancePath(updatedNode);
							const newFileUri = sourcemapParser.findFilePath(newInstancePath);
							if (newFileUri) {
								const document = await vscode.workspace.openTextDocument(newFileUri);
								await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
							}
						}
					}
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to rename instance: ${String(error)}`);
				}
				return;
			}

			explorerViewProvider.startRename(node.id);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.duplicateInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let nodes: any[] = [];
			if (args.length > 0 && args[0]) {
				nodes = [args[0]];
			} else {
				nodes = [...explorerViewProvider.getSelection()];
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to duplicate");
				return;
			}

			try {
				let successCount = 0;
				let lastError = null;

				for (const node of nodes) {
					const result = await backend.sendOperation({
						type: "duplicate_instance",
						nodeId: node.id
					});

					if (result.success) {
						successCount++;
					} else {
						lastError = result.error;
					}
				}

				if (successCount < nodes.length) {
					vscode.window.showWarningMessage(
						`Duplicated ${successCount}/${nodes.length} instances. Last error: ${lastError}`
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to duplicate instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.deleteInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let nodes: any[] = [];
			if (args.length > 0 && args[0]) {
				nodes = [args[0]];
			} else {
				nodes = [...explorerViewProvider.getSelection()];
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to delete");
				return;
			}


			try {
				let successCount = 0;
				let lastError = null;
				const scriptFileUris: vscode.Uri[] = [];

				for (const node of nodes) {
					if (isScriptClass(node.className)) {
						const instancePath = getInstancePath(node);
						const fileUri = sourcemapParser.findFilePath(instancePath);
						if (fileUri) {
							scriptFileUris.push(fileUri);
						}
					}
				}

				for (const node of nodes) {
					const result = await backend.sendOperation({
						type: "delete_instance",
						nodeId: node.id
					});

					if (result.success) {
						successCount++;
					} else {
						lastError = result.error;
					}
				}

				if (successCount < nodes.length) {
					vscode.window.showWarningMessage(
						`Deleted ${successCount}/${nodes.length} instances. Last error: ${lastError}`
					);
				}

				for (const fileUri of scriptFileUris) {
					const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === fileUri.toString());
					if (document) {
						await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
					}
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to delete instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.copyInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let nodes: any[] = [];
			if (args.length > 0 && args[0]) {
				nodes = [args[0]];
			} else {
				nodes = [...explorerViewProvider.getSelection()];
			}

			if (nodes.length === 0) {
				vscode.window.showErrorMessage("No instances selected to copy");
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "copy_instance",
					nodeIds: nodes.map(node => node.id)
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to copy instances: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to copy instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.pasteInstance", async (...args) => {
			if (!backend) {
				return;
			}

			let targetNodeId: string | null = null;
			if (args.length > 0 && args[0]) {
				targetNodeId = args[0].id;
			} else {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					targetNodeId = sel[0].id;
				}
			}

			try {
				const result = await backend.sendOperation({
					type: "paste_instance",
					targetNodeId
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to paste instances: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to paste instances: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.addInstance", async (...args) => {
			if (!backend) {
				return;
			}

			if (!explorerViewProvider.isVisible()) {
				return;
			}

			let parentNode: any = null;
			if (args.length > 0 && args[0]) {
				parentNode = args[0];
			} else {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					parentNode = sel[0];
				}
			}

			if (!parentNode) {
				vscode.window.showErrorMessage("No parent selected to add instance to");
				return;
			}

			const quickPickItems = getClassNames().map(className => ({
				label: className,
				iconPath: vscode.Uri.joinPath(context.extensionUri, "assets", `${className}.png`)
			}));

			const selectedItem = await vscode.window.showQuickPick(
				quickPickItems,
				{
					placeHolder: `Select instance type to add to "${parentNode.name}"`,
					matchOnDescription: true
				}
			);

			const className = selectedItem?.label;

			if (!className) {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "create_instance",
					parentId: parentNode.id,
					className: className
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to create instance: ${result.error}`);
				} else {
					await backend.waitForNextSnapshot();

					if (result.data && typeof result.data === 'string') {
						const newNodeId = result.data;
						const newNode = explorerProvider.getNodeById(newNodeId);
						if (newNode) {
							explorerViewProvider.reveal(newNode);

							if (isScriptClass(newNode.className)) {
								waitForScriptInSourcemap(newNode, 2000).catch(error => {
									console.debug('Failed to wait for script in sourcemap:', error);
								});
							}
						}
					}
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create instance: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.togglePropertiesPanelMode", () => {
			vscode.commands.executeCommand("workbench.view.extension.verdeContainer");
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.openScript", async (node: Node) => {
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					node = sel[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No script selected");
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = getInstancePath(node);
				const fileUri = sourcemapParser.findFilePath(instancePath);

				if (fileUri) {
					const document = await vscode.workspace.openTextDocument(fileUri);
					await vscode.window.showTextDocument(document, {
						viewColumn: vscode.ViewColumn.One,
						preview: false
					});
				} else {
					vscode.window.showWarningMessage(`No sourcemap entry found for script: ${node.name}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to open script: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.copyRobloxPath", async (node: Node) => {
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					node = sel[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected");
				return;
			}

			try {
				const robloxPath = getInstancePath(node).join(".");
				await vscode.env.clipboard.writeText(robloxPath);
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to copy Roblox path: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.copyFilePath", async (node: Node) => {
			if (!node) {
				const sel = explorerViewProvider.getSelection();
				if (sel.length > 0) {
					node = sel[0];
				}
			}

			if (!node) {
				vscode.window.showErrorMessage("No instance selected");
				return;
			}

			if (!isScriptClass(node.className)) {
				vscode.window.showErrorMessage("Selected instance is not a script");
				return;
			}

			try {
				await sourcemapParser.loadSourcemaps();
				const instancePath = getInstancePath(node);
				const fileUri = sourcemapParser.findFilePath(instancePath);

				if (fileUri) {
					const filePath = vscode.workspace.asRelativePath(fileUri);
					await vscode.env.clipboard.writeText(filePath);
				} else {
					vscode.window.showErrorMessage(`No file path found for script: ${node.name}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to copy file path: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.undo", async () => {
			if (!backend) {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "undo"
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to undo: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to undo: ${String(error)}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("verde.redo", async () => {
			if (!backend) {
				return;
			}

			try {
				const result = await backend.sendOperation({
					type: "redo"
				});

				if (!result.success) {
					vscode.window.showErrorMessage(`Failed to redo: ${result.error}`);
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to redo: ${String(error)}`);
			}
		})
	);

	function getInstancePath(node: Node): string[] {
		const path: string[] = [node.name];
		let current = node;

		while (current.parentId) {
			const parent = explorerProvider.getNodeById(current.parentId);
			if (!parent) {
				break;
			}
			path.unshift(parent.name);
			current = parent;
		}

		return path;
	}

	async function waitForScriptInSourcemap(node: Node, timeoutMs: number = 2000): Promise<boolean> {
		const startTime = Date.now();

		while (Date.now() - startTime < timeoutMs) {
			await sourcemapParser.loadSourcemaps();
			const instancePath = getInstancePath(node);
			const fileUri = sourcemapParser.findFilePath(instancePath);

			if (fileUri) {
				try {
					await vscode.commands.executeCommand("verde.openScript", node);
					return true;
				} catch (error) {
					console.debug('Failed to open script document:', error);
					return false;
				}
			}

			await new Promise(resolve => setTimeout(resolve, 100));
		}

		return false;
	}

	const config = vscode.workspace.getConfiguration("verde");
	const autoStart = config.get<boolean>("autoStart", true);

	if (autoStart) {
		try {
			await backend.start();
		} catch (error) {
			vscode.window.showErrorMessage(`verde backend autostart failed: ${String(error)}`);
			outputChannel.show(true);
		}
	}
}

export async function deactivate() {
	if (backend) {
		await backend.stop();
		backend = null;
	}
}
