export function isScriptClass(className: string): boolean {
    return className === "Script" || className === "LocalScript" || className === "ModuleScript";
}

export function scriptIconClass(className: string, runContext?: string): string {
    if (className === "Script" || className === "LocalScript") {
        if (runContext === "Server") return "Script";
        if (runContext === "Client") return "LocalScript";
    }
    return className;
}

type PathNode = { id: string; name: string; parentId: string | null };

export function buildDottedPath(
    node: PathNode,
    getNodeById: (id: string) => PathNode | undefined,
    cache: Map<string, string>,
    lowercase: boolean = false,
): string {
    const cached = cache.get(node.id);
    if (cached !== undefined) return cached;
    const segment = lowercase ? node.name.toLowerCase() : node.name;
    const parent = node.parentId ? getNodeById(node.parentId) : undefined;
    const path = parent
        ? buildDottedPath(parent, getNodeById, cache, lowercase) + "." + segment
        : segment;
    cache.set(node.id, path);
    return path;
}
