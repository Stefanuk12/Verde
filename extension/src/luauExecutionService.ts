import * as vscode from "vscode";
import { VerdeBackend } from "./backend";

export interface ExecuteLuauOptions {
	extensionId: string;
	code: string;
	description?: string;
	nodeId?: string;
}

export interface ExecuteLuauResult {
	success: boolean;
	data?: unknown;
	error?: string;
}

type Consent = "always" | "session" | "denied";

const CONSENT_KEY_PREFIX = "verde.luauConsent.";

export class LuauExecutionService {
	private sessionConsent: Set<string> = new Set();
	private pendingPrompts: Map<string, Promise<Consent>> = new Map();

	constructor(
		private readonly backend: VerdeBackend,
		private readonly globalState: vscode.Memento,
	) {}

	public async execute(options: ExecuteLuauOptions): Promise<ExecuteLuauResult> {
		if (!options.extensionId || !options.code) {
			return { success: false, error: "executeLuau requires extensionId and code" };
		}

		const enabled = vscode.workspace
			.getConfiguration("verde")
			.get<boolean>("allowExtensionScripting", false);
		if (!enabled) {
			return {
				success: false,
				error: "Luau execution is disabled. Enable 'verde.allowExtensionScripting' in settings.",
			};
		}

		const consent = await this.ensureConsent(options.extensionId, options.description);
		if (consent === "denied") {
			return { success: false, error: "User denied Luau execution for this extension." };
		}

		const result = await this.backend.sendOperation({
			type: "execute_luau",
			code: options.code,
			description: options.description,
			nodeId: options.nodeId,
			extensionId: options.extensionId,
		});

		if (result.success) {
			return { success: true, data: result.data };
		}
		return { success: false, error: result.error };
	}

	private ensureConsent(extensionId: string, description?: string): Promise<Consent> {
		const stored = this.globalState.get<Consent>(CONSENT_KEY_PREFIX + extensionId);
		if (stored === "always") {
			return Promise.resolve("always");
		}
		if (this.sessionConsent.has(extensionId)) {
			return Promise.resolve("session");
		}

		const inFlight = this.pendingPrompts.get(extensionId);
		if (inFlight) {
			return inFlight;
		}

		const promise = (async (): Promise<Consent> => {
			try {
				const detail = description ? `\n\nAction: ${description}` : "";
				const choice = await vscode.window.showWarningMessage(
					`Extension "${extensionId}" wants to execute Luau code in Roblox Studio.${detail}`,
					{ modal: true },
					"Allow Once",
					"Always Allow",
				);

				if (choice === "Always Allow") {
					await this.globalState.update(CONSENT_KEY_PREFIX + extensionId, "always");
					return "always";
				}
				if (choice === "Allow Once") {
					this.sessionConsent.add(extensionId);
					return "session";
				}
				return "denied";
			} finally {
				this.pendingPrompts.delete(extensionId);
			}
		})();

		this.pendingPrompts.set(extensionId, promise);
		return promise;
	}
}
