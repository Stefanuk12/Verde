import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const ICON_DIRECTORY_SETTING = "iconDirectory";
const ICON_DIRECTORY_CANDIDATE_SUFFIXES = [
    path.join("RobloxCustom", "instance", "16x", "200"),
    "",
];

type CustomIconCache = {
    resolvedDirectoryPath?: string;
    iconsUri?: vscode.Uri;
    iconClassNames: Set<string>;
};

let customIconCacheKey: string | undefined;
let customIconCache: CustomIconCache | undefined;

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

function getCustomIconCacheKey(): string | undefined {
    const resolvedDirectoryPath = resolveIconDirectoryPath();
    return resolvedDirectoryPath ? path.normalize(resolvedDirectoryPath) : undefined;
}

function getCustomIconCache(): CustomIconCache {
    const cacheKey = getCustomIconCacheKey();
    if (customIconCache && customIconCacheKey === cacheKey) {
        return customIconCache;
    }

    const resolvedDirectoryPath = resolveExistingIconDirectory(cacheKey);
    const iconClassNames = resolvedDirectoryPath
        ? readPngBaseNames(resolvedDirectoryPath)
        : new Set<string>();

    customIconCacheKey = cacheKey;
    customIconCache = {
        resolvedDirectoryPath,
        iconsUri: resolvedDirectoryPath ? vscode.Uri.file(resolvedDirectoryPath) : undefined,
        iconClassNames,
    };

    return customIconCache;
}

export function invalidateCustomIconCache(): void {
    customIconCacheKey = undefined;
    customIconCache = undefined;
}

export function getCustomIconsUri(): vscode.Uri | undefined {
    return getCustomIconCache().iconsUri;
}

export function getCustomIconClassNames(): Set<string> {
    return new Set(getCustomIconCache().iconClassNames);
}

export async function resolveIconUri(
    extensionUri: vscode.Uri,
    iconName: string,
): Promise<vscode.Uri> {
    const customIconCache = getCustomIconCache();
    if (customIconCache.iconsUri && customIconCache.iconClassNames.has(iconName)) {
        return vscode.Uri.joinPath(customIconCache.iconsUri, `${iconName}.png`);
    }

    return vscode.Uri.joinPath(getBundledIconsUri(extensionUri), `${iconName}.png`);
}

export async function getAvailableIconClassNames(
    extensionUri: vscode.Uri,
): Promise<Set<string>> {
    const names = new Set<string>();
    const customIconCache = getCustomIconCache();
    const sources = [getBundledIconsUri(extensionUri)].filter(
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

    for (const name of customIconCache.iconClassNames) {
        names.add(name);
    }

    return names;
}
