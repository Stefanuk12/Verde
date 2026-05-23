import * as vscode from "vscode";
import { VerdeBackend } from "./backend";
import { ExecuteLuauOptions, ExecuteLuauResult } from "./api";

export { ExecuteLuauOptions, ExecuteLuauResult };

type PersistedConsent = "always";
type Consent = PersistedConsent | "session" | "denied";

const CONSENT_KEY_PREFIX = "verde.luauConsent.";
const MAX_DESCRIPTION_LEN = 280;
const MAX_DISPLAY_NAME_LEN = 80;
const MAX_CODE_LEN = 1024 * 1024;
const MAX_NODE_ID_LEN = 256;

// Remove characters which can spoof the consent modal.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export class LuauExecutionService {
	private sessionConsent: Set<string> = new Set();
	private sessionDenied: Set<string> = new Set();
	private pendingPrompts: Map<string, Promise<Consent>> = new Map();

	constructor(
		private readonly backend: VerdeBackend,
		private readonly globalState: vscode.Memento,
	) {}

	public async execute(options: ExecuteLuauOptions): Promise<ExecuteLuauResult> {
		if (!options.extension || typeof options.extension.id !== "string") {
			return { success: false, error: "executeLuau requires a vscode.Extension reference (pass context.extension)" };
		}
		if (typeof options.code !== "string" || options.code.length === 0) {
			return { success: false, error: "executeLuau requires code" };
		}
		if (options.code.length > MAX_CODE_LEN) {
			return {
				success: false,
				error: `executeLuau: code exceeds maximum length (${MAX_CODE_LEN} bytes).`,
			};
		}
		if (options.nodeId !== undefined) {
			if (typeof options.nodeId !== "string" || options.nodeId.length === 0) {
				return { success: false, error: "executeLuau: nodeId must be a non-empty string when provided." };
			}
			if (options.nodeId.length > MAX_NODE_ID_LEN) {
				return { success: false, error: "executeLuau: nodeId is too long." };
			}
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

		if (!vscode.workspace.isTrusted) {
			return {
				success: false,
				error: "Luau execution is disabled in untrusted workspaces. Mark this workspace as trusted to continue.",
			};
		}

		const extensionId = options.extension.id;

		const registered = vscode.extensions.getExtension(extensionId);
		if (!registered || registered !== options.extension) {
			return {
				success: false,
				error: "executeLuau: extension reference does not match the registered extension for this id (pass your own context.extension)",
			};
		}

		if (!this.backend.hasConnectedClient()) {
			return {
				success: false,
				error: "Roblox Studio is not connected to Verde.",
			};
		}

		if (this.backend.connectedClientCount() > 1) {
			return {
				success: false,
				error: "executeLuau: multiple Roblox Studio sessions are connected to Verde. Disconnect all but one and retry.",
			};
		}

		const displayName = readDisplayName(options.extension);
		const safeDescription = sanitizeText(options.description, MAX_DESCRIPTION_LEN);

		const consent = await this.ensureConsent(extensionId, displayName, safeDescription);
		if (consent === "denied") {
			return { success: false, error: "User denied Luau execution for this extension." };
		}

		if (!this.backend.hasConnectedClient()) {
			return { success: false, error: "Roblox Studio disconnected before execution could begin." };
		}
		if (this.backend.connectedClientCount() > 1) {
			return {
				success: false,
				error: "executeLuau: a second Roblox Studio session connected during the consent prompt. Disconnect all but one and retry.",
			};
		}

		const result = await this.backend.sendOperation<{ value?: unknown }>({
			type: "execute_luau",
			code: options.code,
			description: safeDescription,
			nodeId: options.nodeId,
			extensionId,
		});

		if (result.success) {
			return { success: true, data: result.data?.value };
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
		this.sessionDenied.delete(extensionId);
	}

	public async revokeAllConsents(): Promise<void> {
		const ids = this.listConsentedExtensions();
		await Promise.all(ids.map((id) => this.globalState.update(CONSENT_KEY_PREFIX + id, undefined)));
		this.sessionConsent.clear();
		this.sessionDenied.clear();
	}

	private ensureConsent(
		extensionId: string,
		displayName: string,
		safeDescription: string | undefined,
	): Promise<Consent> {
		const stored = this.globalState.get<PersistedConsent>(CONSENT_KEY_PREFIX + extensionId);
		if (stored === "always") {
			return Promise.resolve("always");
		}
		if (this.sessionConsent.has(extensionId)) {
			return Promise.resolve("session");
		}
		if (this.sessionDenied.has(extensionId)) {
			return Promise.resolve("denied");
		}

		const inFlight = this.pendingPrompts.get(extensionId);
		if (inFlight) {
			return inFlight;
		}

		const promise = (async (): Promise<Consent> => {
			try {
				const safeId = sanitizeText(extensionId, MAX_DISPLAY_NAME_LEN) ?? extensionId;
				const displayLine = displayName === safeId ? "" : ` (${displayName})`;
				const detail = safeDescription ? `\n\nAction: ${safeDescription}` : "";
				const choice = await vscode.window.showWarningMessage(
					`Allow "${safeId}"${displayLine} to run arbitrary Luau in Roblox Studio?\n\n` +
						`This grants full Studio plugin access. Consent is per-extension, not per-call; ` +
						`revoke via "Verde: Revoke Luau Execution Consent".${detail}`,
					{ modal: true },
					"Allow for Session",
					"Always Allow",
				);

				if (choice === "Always Allow") {
					const current = this.globalState.get<PersistedConsent>(CONSENT_KEY_PREFIX + extensionId);
					if (current !== "always") {
						await this.globalState.update(CONSENT_KEY_PREFIX + extensionId, "always");
					}
					return "always";
				}
				if (choice === "Allow for Session") {
					this.sessionConsent.add(extensionId);
					return "session";
				}
				this.sessionDenied.add(extensionId);
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
