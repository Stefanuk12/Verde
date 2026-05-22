import * as vscode from "vscode";
import { VerdeBackend } from "./backend";

export interface ExecuteLuauOptions {
	extension: vscode.Extension<unknown>;
	code: string;
	description?: string;
	nodeId?: string;
}

export type ExecuteLuauResult =
	| { success: true; data?: unknown }
	| { success: false; error: string };

type Consent = "always" | "session" | "denied";

const CONSENT_KEY_PREFIX = "verde.luauConsent.";
const MAX_DESCRIPTION_LEN = 280;
const MAX_DISPLAY_NAME_LEN = 80;

// Remove characters which can spoof the consent modal.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export class LuauExecutionService {
	private sessionConsent: Set<string> = new Set();
	private pendingPrompts: Map<string, Promise<Consent>> = new Map();

	constructor(
		private readonly backend: VerdeBackend,
		private readonly globalState: vscode.Memento,
	) {}

	public async execute(options: ExecuteLuauOptions): Promise<ExecuteLuauResult> {
		if (!options.extension || typeof options.extension.id !== "string") {
			return { success: false, error: "executeLuau requires a vscode.Extension reference (pass context.extension)" };
		}
		if (!options.code) {
			return { success: false, error: "executeLuau requires code" };
		}

		const extensionId = options.extension.id;
		const displayName = readDisplayName(options.extension);
		const safeDescription = sanitizeText(options.description, MAX_DESCRIPTION_LEN);

		const enabled = vscode.workspace
			.getConfiguration("verde")
			.get<boolean>("allowExtensionScripting", false);
		if (!enabled) {
			return {
				success: false,
				error: "Luau execution is disabled. Enable 'verde.allowExtensionScripting' in settings.",
			};
		}

		const consent = await this.ensureConsent(extensionId, displayName, safeDescription);
		if (consent === "denied") {
			return { success: false, error: "User denied Luau execution for this extension." };
		}

		const result = await this.backend.sendOperation({
			type: "execute_luau",
			code: options.code,
			description: safeDescription,
			nodeId: options.nodeId,
			extensionId,
		});

		if (result.success) {
			const wrapper = result.data as { value?: unknown } | undefined;
			return { success: true, data: wrapper?.value };
		}
		return { success: false, error: result.error };
	}

	public listConsentedExtensions(): string[] {
		return this.globalState
			.keys()
			.filter((k) => k.startsWith(CONSENT_KEY_PREFIX))
			.map((k) => k.slice(CONSENT_KEY_PREFIX.length))
			.sort();
	}

	public async revokeConsent(extensionId: string): Promise<void> {
		await this.globalState.update(CONSENT_KEY_PREFIX + extensionId, undefined);
		this.sessionConsent.delete(extensionId);
	}

	public async revokeAllConsents(): Promise<void> {
		const ids = this.listConsentedExtensions();
		await Promise.all(ids.map((id) => this.globalState.update(CONSENT_KEY_PREFIX + id, undefined)));
		this.sessionConsent.clear();
	}

	private ensureConsent(
		extensionId: string,
		displayName: string,
		safeDescription: string | undefined,
	): Promise<Consent> {
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
				const detail = safeDescription ? `\n\nAction: ${safeDescription}` : "";
				const choice = await vscode.window.showWarningMessage(
					`Extension "${extensionId}" wants to run Luau inside Roblox Studio via Verde.\n\n` +
						`Marketplace display name: ${displayName}\n\n` +
						`This grants the extension full Studio plugin access - file system, HTTP, ` +
						`and the ability to modify your place. Only allow extensions you trust.${detail}`,
					{ modal: true },
					"Allow for Session",
					"Always Allow",
				);

				if (choice === "Always Allow") {
					const current = this.globalState.get<Consent>(CONSENT_KEY_PREFIX + extensionId);
					if (current !== "always") {
						await this.globalState.update(CONSENT_KEY_PREFIX + extensionId, "always");
					}
					return "always";
				}
				if (choice === "Allow for Session") {
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

function readDisplayName(extension: vscode.Extension<unknown>): string {
	const pkg = extension.packageJSON as { displayName?: unknown; name?: unknown } | undefined;
	const raw =
		(pkg && typeof pkg.displayName === "string" && pkg.displayName) ||
		(pkg && typeof pkg.name === "string" && pkg.name) ||
		extension.id;
	return sanitizeText(raw, MAX_DISPLAY_NAME_LEN) ?? extension.id;
}

function sanitizeText(raw: string | undefined, maxLen: number): string | undefined {
	if (!raw) {
		return undefined;
	}
	const stripped = raw.replace(UNSAFE_CHARS, "");
	const collapsed = stripped.replace(/\s+/g, " ").trim();
	if (collapsed.length === 0) {
		return undefined;
	}
	if (collapsed.length <= maxLen) {
		return collapsed;
	}
	return collapsed.slice(0, maxLen - 1) + "…";
}
