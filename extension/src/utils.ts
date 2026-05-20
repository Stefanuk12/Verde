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
