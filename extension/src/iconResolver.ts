import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const ICON_DIRECTORY_SETTING = "iconDirectory";
const ICON_DIRECTORY_CANDIDATE_SUFFIXES = [
    path.join("RobloxCustom", "instance", "16x", "200"),
    "",
];

function getConfiguredIconDirectory(): string | undefined {
    const configured = vscode.workspace
        .getConfiguration("verde")
        .get<string>(ICON_DIRECTORY_SETTING, "")
        .trim();
    return configured || undefined;
}

function getWorkspaceBasePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function resolveIconDirectoryPath(): string | undefined {
    const configured = getConfiguredIconDirectory();
    if (!configured) {
        return undefined;
    }

    if (path.isAbsolute(configured)) {
        return configured;
    }

    const workspaceBase = getWorkspaceBasePath();
    return workspaceBase ? path.resolve(workspaceBase, configured) : undefined;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

function directoryExists(fsPath: string): boolean {
    try {
        return fs.statSync(fsPath).isDirectory();
    } catch {
        return false;
    }
}

function resolveExistingIconDirectory(fsPath: string | undefined): string | undefined {
    if (!fsPath) {
        return undefined;
    }

    for (const suffix of ICON_DIRECTORY_CANDIDATE_SUFFIXES) {
        const candidate = suffix ? path.join(fsPath, suffix) : fsPath;
        if (directoryExists(candidate) && readPngBaseNames(candidate).size > 0) {
            return candidate;
        }
    }

    return undefined;
}

function readPngBaseNames(fsPath: string): Set<string> {
    const names = new Set<string>();
    try {
        for (const entry of fs.readdirSync(fsPath, { withFileTypes: true })) {
            if (entry.isFile() && entry.name.endsWith(".png")) {
                names.add(entry.name.slice(0, -".png".length));
            }
        }
    } catch {
        // Ignore unreadable directories and fall back to bundled icons.
    }
    return names;
}

export function getBundledIconsUri(extensionUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(extensionUri, "assets");
}

export function getCustomIconsUri(): vscode.Uri | undefined {
    const resolved = resolveExistingIconDirectory(resolveIconDirectoryPath());
    return resolved ? vscode.Uri.file(resolved) : undefined;
}

export function getCustomIconClassNames(): Set<string> {
    const resolved = resolveExistingIconDirectory(resolveIconDirectoryPath());
    if (!resolved) {
        return new Set<string>();
    }
    return readPngBaseNames(resolved);
}

export async function resolveIconUri(
    extensionUri: vscode.Uri,
    iconName: string,
): Promise<vscode.Uri> {
    const customIconsUri = getCustomIconsUri();
    if (customIconsUri) {
        const customIconUri = vscode.Uri.joinPath(customIconsUri, `${iconName}.png`);
        if (await fileExists(customIconUri)) {
            return customIconUri;
        }
    }

    return vscode.Uri.joinPath(getBundledIconsUri(extensionUri), `${iconName}.png`);
}

export async function getAvailableIconClassNames(
    extensionUri: vscode.Uri,
): Promise<Set<string>> {
    const names = new Set<string>();
    const sources = [getBundledIconsUri(extensionUri), getCustomIconsUri()].filter(
        (uri): uri is vscode.Uri => uri !== undefined,
    );

    for (const source of sources) {
        try {
            const entries = await vscode.workspace.fs.readDirectory(source);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith(".png")) {
                    names.add(name.slice(0, -".png".length));
                }
            }
        } catch {
            // Ignore missing or unreadable custom icon directories and fall back to bundled icons.
        }
    }

    return names;
}
