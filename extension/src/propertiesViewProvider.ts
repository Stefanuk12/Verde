import * as vscode from "vscode";
import { VerdeBackend } from "./backend";
import { getPropertiesHtml, PropertiesHtmlOptions } from "./propertiesHtml";

import { Node } from "./robloxExplorerProvider";

export class PropertiesViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'verde.properties';

	private webviewView: vscode.WebviewView | undefined;
	private separatePanel: vscode.WebviewPanel | undefined;
	private backend: VerdeBackend;
	private currentNodeId: string | null = null;
	private currentNodeName: string | null = null;
	private currentNodeClassName: string | null = null;
	private isUsingSeparatePanel: boolean = false;
	private soundPollingInterval: NodeJS.Timeout | null = null;

	constructor(
		backend: VerdeBackend,
		private readonly extensionUri: vscode.Uri,
		private readonly onPropertiesLoaded?: (nodeId: string, properties: any) => void,
	) {
		this.backend = backend;
		this.backend.setPropertyUpdateCallback((nodeId: string, properties: any) => {
			if (nodeId === this.currentNodeId) {
				this.updateProperties(properties);
			}
		});
	}

	private normalizeTypesForWebview(propertiesData: any): any {
		if (!propertiesData) {
			return propertiesData;
		}

		const properties = Array.isArray(propertiesData.properties) ? propertiesData.properties : [];
		for (const prop of properties) {
			if (prop && prop.type === 'boolean') {
				prop.type = 'boolean';
			}
		}

		const attributes = Array.isArray(propertiesData.attributes) ? propertiesData.attributes : [];
		for (const attr of attributes) {
			if (attr && attr.type === 'boolean') {
				attr.type = 'boolean';
			}
		}

		return propertiesData;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this.webviewView = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, "assets"),
				vscode.Uri.joinPath(this.extensionUri, "resources")
			]
		};

		webviewView.webview.onDidReceiveMessage(async (message) => {
			await this.handleMessage(message);
		});

		webviewView.onDidDispose(() => {
			this.webviewView = undefined;
		});

		webviewView.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });
		if (this.currentNodeId) {
			setTimeout(() => this.loadProperties(), 100);
		}
	}

	public refreshWebviewHtml(): void {
		if (this.webviewView) {
			this.webviewView.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });
			if (this.currentNodeId) {
				setTimeout(() => this.loadProperties(), 100);
			}
		}
		if (this.separatePanel) {
			this.separatePanel.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });
			this.loadPropertiesForPanel(this.separatePanel.webview);
		}
	}

	public show(node: Node): void {
		if (this.currentNodeId && this.currentNodeId !== node.id) {
			this.backend.sendOperation({ type: "deselect_instance" }).catch(() => {
				// ignore errors
			});
		}
		this.currentNodeId = node.id;
		this.currentNodeName = node.name;
		this.currentNodeClassName = node.className;
		if (this.isUsingSeparatePanel && this.separatePanel) {
			this.separatePanel.title = `Properties - ${this.currentNodeClassName} - ${this.currentNodeName}`;
			this.loadPropertiesForPanel(this.separatePanel.webview);
		} else if (this.webviewView) {
			this.webviewView.show?.(true);
			setTimeout(() => {
				this.loadProperties();
			}, 100);
		}
	}

	private async loadProperties(): Promise<void> {
		if (!this.currentNodeId || !this.webviewView) {
			return;
		}

		try {
			const propertiesData = this.normalizeTypesForWebview(await this.backend.getProperties(this.currentNodeId));
			this.onPropertiesLoaded?.(this.currentNodeId, propertiesData);

			this.webviewView.webview.postMessage({
				type: "updateProperties",
				properties: propertiesData,
				nodeName: this.currentNodeName,
				nodeClassName: this.currentNodeClassName,
			});
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
		}
	}


	private updateProperties(properties: any): void {
		if (this.currentNodeId) {
			this.onPropertiesLoaded?.(this.currentNodeId, properties);
		}

		if (this.isUsingSeparatePanel && this.separatePanel) {
			const normalized = this.normalizeTypesForWebview(properties);
			this.separatePanel.webview.postMessage({
				type: "updateProperties",
				properties: normalized,
				nodeName: this.currentNodeName,
				nodeClassName: this.currentNodeClassName,
			});
		} else if (this.webviewView) {
			const normalized = this.normalizeTypesForWebview(properties);
			this.webviewView.webview.postMessage({
				type: "updateProperties",
				properties: normalized,
				nodeName: this.currentNodeName,
				nodeClassName: this.currentNodeClassName,
			});
		}
	}

	private startSoundPolling(): void {
		this.stopSoundPolling();

		this.soundPollingInterval = setInterval(async () => {
			try {
				const playbackInfo = await this.backend.getSoundPlaybackInfo();
				this.sendToWebview({
					type: "soundPlaybackUpdate",
					...playbackInfo,
				});

				if (!playbackInfo.playing) {
					this.stopSoundPolling();
				}
			} catch {
				this.stopSoundPolling();
			}
		}, 100);
	}

	private stopSoundPolling(): void {
		if (this.soundPollingInterval) {
			clearInterval(this.soundPollingInterval);
			this.soundPollingInterval = null;
		}
	}

	private sendToWebview(message: any): void {
		if (this.isUsingSeparatePanel && this.separatePanel) {
			this.separatePanel.webview.postMessage(message);
		} else if (this.webviewView) {
			this.webviewView.webview.postMessage(message);
		}
	}

	private async handleMessage(message: any): Promise<void> {
		if (message.type === "navigateToInstance") {
			vscode.commands.executeCommand("verde.navigateToInstance", message.instanceId);
			return;
		}

		if (message.type === "togglePanelMode") {
			this.togglePanelMode();
			return;
		}

		if (!this.currentNodeId) {
			return;
		}

		try {
			switch (message.type) {
				case "setProperty":
					await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
					if (message.propertyName === "Enabled" || message.propertyName === "Disabled") {
						this.onPropertiesLoaded?.(this.currentNodeId, {
							properties: [{ name: message.propertyName, value: message.propertyValue }],
						});
					}
					break;

				case "addTag":
					await this.backend.addTag(this.currentNodeId, message.tagName);
					break;

				case "removeTag":
					await this.backend.removeTag(this.currentNodeId, message.tagName);
					break;

				case "addAttribute":
					await this.backend.addAttribute(this.currentNodeId, message.attributeName, message.attributeType);
					break;

				case "setAttribute":
					await this.backend.setAttribute(this.currentNodeId, message.attributeName, message.attributeValue);
					break;

				case "removeAttribute":
					await this.backend.removeAttribute(this.currentNodeId, message.attributeName);
					break;

				case "renameAttribute":
					await this.backend.renameAttribute(this.currentNodeId, message.oldName, message.newName);
					break;

				case "playSound":
					await this.backend.playSound(this.currentNodeId);
					this.startSoundPolling();
					break;

				case "stopSound":
					await this.backend.stopSound(this.currentNodeId);
					this.stopSoundPolling();
					break;

				case "setSoundTimePosition":
					await this.backend.setSoundTimePosition(this.currentNodeId, message.timePosition);
					break;

				case "undo":
					await this.backend.undo();
					break;

				case "redo":
					await this.backend.redo();
					break;

				default:
					return;
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to update: ${error}`);
		}
	}

	private togglePanelMode(): void {
		if (this.isUsingSeparatePanel) {
			if (this.separatePanel) {
				this.separatePanel.dispose();
				this.separatePanel = undefined;
			}
			this.isUsingSeparatePanel = false;
			if (this.webviewView) {
				this.webviewView.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });
				this.webviewView.show();
				setTimeout(() => {
					this.loadProperties();
				}, 100);
			}
		} else {
			this.createSeparatePanel();
		}
	}

	private createSeparatePanel(): void {
		if (this.webviewView) {
			this.webviewView.webview.html = '';
		}

		const panel = vscode.window.createWebviewPanel(
			"verde.properties.panel",
			`Properties - ${this.currentNodeClassName || "Unknown"} - ${this.currentNodeName || "No Selection"}`,
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.extensionUri, "assets"),
					vscode.Uri.joinPath(this.extensionUri, "resources")
				],
				retainContextWhenHidden: true,
			}
		);

		this.separatePanel = panel;
		this.isUsingSeparatePanel = true;

		panel.webview.html = getPropertiesHtml(this.extensionUri, { showToggleButton: true });

		panel.webview.onDidReceiveMessage(async (message) => {
			if (message.type === "navigateToInstance") {
				vscode.commands.executeCommand("verde.navigateToInstance", message.instanceId);
				return;
			}

			if (message.type === "togglePanelMode") {
				this.togglePanelMode();
				return;
			}

			if (!this.currentNodeId) {
				return;
			}

			try {
				switch (message.type) {
					case "setProperty":
						await this.backend.setProperty(this.currentNodeId, message.propertyName, message.propertyValue);
						break;

					case "addTag":
						await this.backend.addTag(this.currentNodeId, message.tagName);
						break;

					case "removeTag":
						await this.backend.removeTag(this.currentNodeId, message.tagName);
						break;

					case "addAttribute":
						await this.backend.addAttribute(this.currentNodeId, message.attributeName, message.attributeType);
						break;

					case "setAttribute":
						await this.backend.setAttribute(this.currentNodeId, message.attributeName, message.attributeValue);
						break;

					case "removeAttribute":
						await this.backend.removeAttribute(this.currentNodeId, message.attributeName);
						break;

					case "renameAttribute":
						await this.backend.renameAttribute(this.currentNodeId, message.oldName, message.newName);
						break;

					case "playSound":
						await this.backend.playSound(this.currentNodeId);
						this.startSoundPolling();
						break;

					case "stopSound":
						await this.backend.stopSound(this.currentNodeId);
						this.stopSoundPolling();
						break;

					case "setSoundTimePosition":
						await this.backend.setSoundTimePosition(this.currentNodeId, message.timePosition);
						break;

					case "undo":
						await this.backend.undo();
						break;

					case "redo":
						await this.backend.redo();
						break;

					default:
						return;
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to update: ${error}`);
			}
		});

		panel.onDidDispose(() => {
			this.separatePanel = undefined;
			this.isUsingSeparatePanel = false;
			if (this.webviewView) {
				this.webviewView.show();
				setTimeout(() => {
					this.loadProperties();
				}, 100);
			}
		});

		if (this.currentNodeId) {
			this.loadPropertiesForPanel(panel.webview);
		}

		panel.reveal();
	}


	private async loadPropertiesForPanel(webview: vscode.Webview): Promise<void> {
		if (!this.currentNodeId) {
			return;
		}

		try {
			const propertiesData = this.normalizeTypesForWebview(await this.backend.getProperties(this.currentNodeId));
			webview.postMessage({
				type: "updateProperties",
				properties: propertiesData,
				nodeName: this.currentNodeName,
				nodeClassName: this.currentNodeClassName,
			});
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to load properties: ${error}`);
		}
	}
}
