import { ExplorerDeltaOp } from "./backend";
import { InstanceSorter } from "./instanceSorter";

const DELTA_OP_ORDER: Record<string, number> = {
	remove_node: 0,
	update_node: 1,
	move_node: 2,
	add_subtree: 3,
};

export type Node = {
	id: string;
	name: string;
	className: string;
	parentId: string | null;
	children: string[];
	hasChildren?: boolean;
	childrenLoaded?: boolean;
	disabled?: boolean;
	runContext?: string;
};

export type Snapshot = {
	rootIds: string[];
	nodes: Node[];
};

export class RobloxExplorerProvider {
	private nodesById: Map<string, Node> = new Map();
	private rootIds: string[] = [];
	private sorter: InstanceSorter;
	private onChangeCallbacks: ((wasReset: boolean) => void)[] = [];
	private detachedIds: Set<string> = new Set();

	constructor() {
		this.sorter = new InstanceSorter();
	}

	private static childrenComplete(hasChildren: boolean | undefined, listIsComplete: boolean): boolean {
		return listIsComplete || hasChildren !== true;
	}

	private removeFromParent(node: Node): void {
		if (node.parentId !== null) {
			const oldParent = this.nodesById.get(node.parentId);
			if (oldParent) {
				const i = oldParent.children.indexOf(node.id);
				if (i >= 0) oldParent.children.splice(i, 1);
			}
		} else {
			const i = this.rootIds.indexOf(node.id);
			if (i >= 0) this.rootIds.splice(i, 1);
		}
	}

	private reconcileParentHasChildren(parentId: string | null, cleared: Set<string>): void {
		if (parentId === null) return;
		const parent = this.nodesById.get(parentId);
		if (parent && parent.hasChildren === true && parent.childrenLoaded && parent.children.length === 0) {
			parent.hasChildren = false;
			cleared.add(parentId);
		}
	}

	public onChange(callback: (wasReset: boolean) => void): () => void {
		this.onChangeCallbacks.push(callback);
		return () => {
			const i = this.onChangeCallbacks.indexOf(callback);
			if (i >= 0) this.onChangeCallbacks.splice(i, 1);
		};
	}

	private fireChange(wasReset: boolean = false): void {
		for (const cb of this.onChangeCallbacks) {
			cb(wasReset);
		}
	}

	public getNodeById(id: string): Node | undefined {
		return this.nodesById.get(id);
	}

	private deleteNodeAndDescendants(id: string): void {
		const node = this.nodesById.get(id);
		if (!node) return;
		for (const childId of node.children) {
			this.deleteNodeAndDescendants(childId);
		}
		this.nodesById.delete(id);
		this.detachedIds.delete(id);
	}

	public getAllNodes(): Node[] {
		if (this.detachedIds.size === 0) {
			return Array.from(this.nodesById.values());
		}
		const result: Node[] = [];
		const memo = new Map<string, boolean>();
		for (const node of this.nodesById.values()) {
			if (this.isReachable(node, memo)) {
				result.push(node);
			}
		}
		return result;
	}

	private isReachable(node: Node, memo?: Map<string, boolean>): boolean {
		const cached = memo?.get(node.id);
		if (cached !== undefined) {
			return cached;
		}
		const chain: string[] = [];
		const guard = new Set<string>();
		let current: Node | undefined = node;
		let reachable = false;
		while (current) {
			const hit = memo?.get(current.id);
			if (hit !== undefined) {
				reachable = hit;
				break;
			}
			chain.push(current.id);
			if (this.detachedIds.has(current.id)) {
				reachable = false;
				break;
			}
			if (current.parentId === null) {
				reachable = this.rootIds.includes(current.id);
				break;
			}
			if (guard.has(current.id)) {
				reachable = false;
				break;
			}
			guard.add(current.id);
			current = this.nodesById.get(current.parentId);
		}
		if (memo) {
			for (const id of chain) {
				memo.set(id, reachable);
			}
		}
		return reachable;
	}

	public markSubtreeUnloaded(ids: string[]): string[] {
		const descendants: string[] = [];
		const markDescendants = (id: string) => {
			const node = this.nodesById.get(id);
			if (!node) return;
			for (const childId of node.children) {
				const child = this.nodesById.get(childId);
				if (!child) continue;
				child.childrenLoaded = false;
				descendants.push(childId);
				markDescendants(childId);
			}
		};
		for (const id of ids) {
			const node = this.nodesById.get(id);
			if (node) node.childrenLoaded = false;
			markDescendants(id);
		}
		this.fireChange();
		return descendants;
	}

	public setNodeDisabled(id: string, disabled: boolean): void {
		const node = this.nodesById.get(id);
		if (!node || node.disabled === disabled) return;
		node.disabled = disabled;
		this.fireChange();
	}

	public getRootIds(): string[] {
		return this.rootIds;
	}

	public getSortedChildren(parentId: string | null): Node[] {
		let nodes: Node[];
		if (parentId === null) {
			nodes = this.rootIds
				.map((rootId) => this.nodesById.get(rootId))
				.filter((node): node is Node => node !== undefined);
		} else {
			const parent = this.nodesById.get(parentId);
			if (!parent) return [];
			nodes = parent.children
				.map((childId) => this.nodesById.get(childId))
				.filter((node): node is Node => node !== undefined);
		}
		return this.sorter.sortNodes(nodes) as Node[];
	}

	public getNodeByInstancePath(instancePath: string[]): Node | undefined {
		if (instancePath.length === 0) {
			return undefined;
		}

		let candidates: Node[] = this.rootIds
			.map((rootId) => this.nodesById.get(rootId))
			.filter((node): node is Node => node !== undefined);

		for (let i = 0; i < instancePath.length; i++) {
			const pathSegment = instancePath[i];
			let found: Node | undefined;

			for (const candidate of candidates) {
				if (candidate.name === pathSegment) {
					found = candidate;
					break;
				}
			}

			if (!found) {
				return undefined;
			}

			if (i === instancePath.length - 1) {
				return found;
			}

			candidates = found.children
				.map((childId) => this.nodesById.get(childId))
				.filter((node): node is Node => node !== undefined);
		}

		return undefined;
	}

	public setSnapshot(snapshot: Snapshot, isFull: boolean = false): void {
		const nextNodesById = new Map<string, Node>();

		for (const node of snapshot.nodes) {
			node.childrenLoaded = RobloxExplorerProvider.childrenComplete(node.hasChildren, isFull);
			nextNodesById.set(node.id, node);
		}

		this.nodesById = nextNodesById;
		this.rootIds = snapshot.rootIds;
		this.detachedIds.clear();

		this.fireChange(true);
	}

	private refreshNodeFields(node: Node, incoming: Node): boolean {
		let changed = false;
		if (incoming.name !== node.name) { node.name = incoming.name; changed = true; }
		if (incoming.className !== node.className) { node.className = incoming.className; changed = true; }
		if (incoming.disabled !== undefined && incoming.disabled !== node.disabled) {
			node.disabled = incoming.disabled;
			changed = true;
		}
		if (incoming.runContext !== undefined && incoming.runContext !== node.runContext) {
			node.runContext = incoming.runContext;
			changed = true;
		}
		return changed;
	}

	public mergeSearchResults(nodes: Node[]): { added: Node[]; needsRebuild: boolean } {
		if (nodes.length === 0) return { added: [], needsRebuild: false };

		const addedIds: string[] = [];
		const linkIds: string[] = [];
		const cleared = new Set<string>();
		let needsRebuild = false;
		for (const n of nodes) {
			const existing = this.nodesById.get(n.id);
			if (existing) {
				if (this.refreshNodeFields(existing, n)) needsRebuild = true;

				const wasDetached = this.detachedIds.has(n.id);
				if (wasDetached || n.parentId !== existing.parentId) {
					if (!wasDetached) {
						const oldParentId = existing.parentId;
						this.removeFromParent(existing);
						this.reconcileParentHasChildren(oldParentId, cleared);
						needsRebuild = true;
					}
					existing.parentId = n.parentId;
					this.detachedIds.add(n.id);
					linkIds.push(n.id);
				}

				if (n.hasChildren === true) {
					if (existing.hasChildren !== true) {
						existing.hasChildren = true;
						existing.childrenLoaded = false;
						needsRebuild = true;
					}
				} else if (existing.hasChildren === true || existing.children.length > 0) {
					for (const childId of [...existing.children]) {
						this.deleteNodeAndDescendants(childId);
					}
					existing.children = [];
					existing.hasChildren = false;
					existing.childrenLoaded = true;
					needsRebuild = true;
				}
				continue;
			}
			this.nodesById.set(n.id, {
				...n,
				children: [...(n.children ?? [])],
				childrenLoaded: RobloxExplorerProvider.childrenComplete(n.hasChildren, false),
			});
			addedIds.push(n.id);
			linkIds.push(n.id);
		}

		for (const id of linkIds) {
			const node = this.nodesById.get(id);
			if (!node) continue;
			if (node.parentId !== null) {
				const parent = this.nodesById.get(node.parentId);
				if (parent && !parent.children.includes(node.id)) {
					parent.children.push(node.id);
					if (parent.hasChildren !== true) parent.hasChildren = true;
					if (parent.childrenLoaded !== true) parent.childrenLoaded = false;
				}
				if (parent && !this.detachedIds.has(parent.id)) {
					this.detachedIds.delete(id);
				}
			} else if (!this.rootIds.includes(node.id)) {
				this.rootIds.push(node.id);
				this.detachedIds.delete(id);
			}
		}

		this.fireChange();

		const added = addedIds
			.map(id => this.nodesById.get(id))
			.filter((n): n is Node => n !== undefined);
		return { added, needsRebuild };
	}

	public applyDelta(ops: ExplorerDeltaOp[], addedRootIds?: string[]): { added: Node[]; needsRebuild: boolean; hasChildrenCleared: string[] } {
		if (this.nodesById.size === 0) {
			return { added: [], needsRebuild: false, hasChildrenCleared: [] };
		}

		const addedIds: string[] = [];
		let needsRebuild = false;
		const hasChildrenCleared = new Set<string>();

		const sorted = [...ops].sort((a, b) => {
			const t = (a.timestamp ?? 0) - (b.timestamp ?? 0);
			if (t !== 0) return t;
			return (DELTA_OP_ORDER[a.type] ?? 99) - (DELTA_OP_ORDER[b.type] ?? 99);
		});

		for (const op of sorted) {
			switch (op.type) {
				case "remove_node": {
					const node = this.nodesById.get(op.id);
					if (node?.parentId) {
						const parent = this.nodesById.get(node.parentId);
						if (parent) {
							const i = parent.children.indexOf(op.id);
							if (i >= 0) parent.children.splice(i, 1);
						}
						this.reconcileParentHasChildren(node.parentId, hasChildrenCleared);
					} else {
						const i = this.rootIds.indexOf(op.id);
						if (i >= 0) this.rootIds.splice(i, 1);
					}
					this.deleteNodeAndDescendants(op.id);
					needsRebuild = true;
					break;
				}
				case "update_node": {
					const node = this.nodesById.get(op.id);
					if (!node) break;
					if (op.name !== undefined && op.name !== node.name) {
						node.name = op.name;
						needsRebuild = true;
					}
					if (op.disabled !== undefined) node.disabled = op.disabled;
					if (op.runContext !== undefined) node.runContext = op.runContext;
					if (op.hasChildren !== undefined) {
						if (op.hasChildren) {
							node.hasChildren = true;
							if (node.children.length === 0) node.childrenLoaded = false;
						} else if (node.children.length === 0) {
							if (node.hasChildren === true) hasChildrenCleared.add(op.id);
							node.hasChildren = false;
							node.childrenLoaded = true;
						}
					}
					break;
				}
				case "move_node": {
					const node = this.nodesById.get(op.id);
					if (!node) break;
					needsRebuild = true;
					const newParentId = op.newParentId ?? null;
					const oldParentId = node.parentId;
					if (node.parentId) {
						const oldParent = this.nodesById.get(node.parentId);
						if (oldParent) {
							const i = oldParent.children.indexOf(op.id);
							if (i >= 0) oldParent.children.splice(i, 1);
						}
					} else {
						const i = this.rootIds.indexOf(op.id);
						if (i >= 0) this.rootIds.splice(i, 1);
					}
					this.reconcileParentHasChildren(oldParentId, hasChildrenCleared);
					if (newParentId !== null) {
						const newParent = this.nodesById.get(newParentId);
						if (!newParent) {
							node.parentId = newParentId;
							this.detachedIds.add(op.id);
							break;
						}
						node.parentId = newParentId;
						if (!newParent.children.includes(op.id)) newParent.children.push(op.id);
						if (newParent.hasChildren !== true) newParent.hasChildren = true;
						if (this.detachedIds.has(newParentId)) {
							this.detachedIds.add(op.id);
						} else {
							this.detachedIds.delete(op.id);
						}
					} else {
						node.parentId = null;
						if (!this.rootIds.includes(op.id)) this.rootIds.push(op.id);
						this.detachedIds.delete(op.id);
					}
					break;
				}
				case "add_subtree": {
					for (const n of op.nodes) {
						const existing = this.nodesById.get(n.id);
						if (existing === undefined) {
							addedIds.push(n.id);
						} else {
							needsRebuild = true;
						}
						const incomingChildren = [...(n.children ?? [])];
						const keepExisting = existing !== undefined && incomingChildren.length === 0 && existing.children.length > 0 && existing.childrenLoaded === true && n.hasChildren === true;
						this.nodesById.set(n.id, {
							...n,
							children: keepExisting ? existing.children : incomingChildren,
							childrenLoaded: keepExisting ? existing.childrenLoaded : RobloxExplorerProvider.childrenComplete(n.hasChildren, false),
						});
					}
					const siblingIds: string[] = [];
					const seen = new Set<string>();
					const addSibling = (id: string) => {
						if (seen.has(id)) return;
						seen.add(id);
						siblingIds.push(id);
					};
					addSibling(op.rootId);
					for (const n of op.nodes) {
						if (n.parentId === op.parentId) addSibling(n.id);
					}
					for (const id of siblingIds) {
						const stored = this.nodesById.get(id);
						if (stored) stored.parentId = op.parentId;
						this.detachedIds.delete(id);
					}
					if (op.parentId !== null) {
						const parent = this.nodesById.get(op.parentId);
						if (parent) {
							const existingChildren = new Set(parent.children);
							for (const id of siblingIds) {
								if (!existingChildren.has(id)) parent.children.push(id);
							}
							if (siblingIds.length > 0 && parent.hasChildren !== true) {
								parent.hasChildren = true;
							}
							parent.childrenLoaded = true;
						}
					} else {
						for (const id of siblingIds) {
							if (!this.rootIds.includes(id)) this.rootIds.push(id);
						}
					}
					break;
				}
			}
		}

		if (addedRootIds?.length) {
			for (const id of addedRootIds) {
				if (!this.rootIds.includes(id)) this.rootIds.push(id);
			}
		}

		this.fireChange();

		const added = needsRebuild
			? []
			: addedIds
				.map(id => this.nodesById.get(id))
				.filter((n): n is Node => n !== undefined);
		const stillCleared = Array.from(hasChildrenCleared).filter(id => {
			const node = this.nodesById.get(id);
			return node !== undefined && node.hasChildren !== true;
		});
		return { added, needsRebuild, hasChildrenCleared: stillCleared };
	}
}
