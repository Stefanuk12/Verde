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
};

export type Snapshot = {
	rootIds: string[];
	nodes: Node[];
};

export class RobloxExplorerProvider {
	private nodesById: Map<string, Node> = new Map();
	private rootIds: string[] = [];
	private sorter: InstanceSorter;
	private onChangeCallbacks: (() => void)[] = [];

	constructor() {
		this.sorter = new InstanceSorter();
	}

	public onChange(callback: () => void): void {
		this.onChangeCallbacks.push(callback);
	}

	private fireChange(): void {
		for (const cb of this.onChangeCallbacks) {
			cb();
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
	}

	public getAllNodes(): Node[] {
		return Array.from(this.nodesById.values());
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

	public setSnapshot(snapshot: Snapshot): void {
		const nextNodesById = new Map<string, Node>();

		for (const node of snapshot.nodes) {
			nextNodesById.set(node.id, node);
		}

		this.nodesById = nextNodesById;
		this.rootIds = snapshot.rootIds;

		this.fireChange();
	}

	public applyDelta(ops: ExplorerDeltaOp[], addedRootIds?: string[]): void {
		if (this.nodesById.size === 0) {
			return;
		}

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
					} else {
						const i = this.rootIds.indexOf(op.id);
						if (i >= 0) this.rootIds.splice(i, 1);
					}
					this.deleteNodeAndDescendants(op.id);
					break;
				}
				case "update_node": {
					const node = this.nodesById.get(op.id);
					if (node && op.name !== undefined) node.name = op.name;
					break;
				}
				case "move_node": {
					const node = this.nodesById.get(op.id);
					if (!node) break;
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
					node.parentId = op.newParentId;
					if (op.newParentId !== null) {
						const newParent = this.nodesById.get(op.newParentId);
						if (newParent) newParent.children.push(op.id);
					} else {
						this.rootIds.push(op.id);
					}
					break;
				}
				case "add_subtree": {
					for (const n of op.nodes) {
						this.nodesById.set(n.id, { ...n, children: [...(n.children ?? [])] });
					}
					const rootNode = this.nodesById.get(op.rootId);
					if (rootNode) rootNode.parentId = op.parentId;
					if (op.parentId !== null) {
						const parent = this.nodesById.get(op.parentId);
						if (parent && !parent.children.includes(op.rootId)) {
							parent.children.push(op.rootId);
						}
					} else if (!this.rootIds.includes(op.rootId)) {
						this.rootIds.push(op.rootId);
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
	}
}
