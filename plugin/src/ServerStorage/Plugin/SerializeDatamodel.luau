--[[
	SerializeDatamodel.luau
	Serialize the datamodel to a snapshot representation.

	Dvitash 1/4/2026
--]]

local Services = require(script.Parent.Shared.Services)

type Node = {
	id: string,
	name: string,
	className: string,
	parentId: string?,
	children: { string },
	disabled: boolean?,
	runContext: string?,
}

type Snapshot = {
	rootIds: { string },
	nodes: { Node },
}

local YIELD_EVERY = 5000
local MAX_DEPTH = 10000
local MAX_NODES = math.huge

local SerializeDatamodel = {}

function SerializeDatamodel.serializeFull(): (Snapshot, { [string]: Instance })
	local nodes: { Node } = {}
	local instanceMap: { [string]: Instance } = {}
	local rootIds: { string } = {}
	local nodeCount = 0

	local function makeNode(instance: Instance, parentId: string?): (Node, string)
		local id = instance:GetDebugId(0)
		local node: Node = {
			id = id,
			name = instance.Name,
			className = instance.ClassName,
			parentId = parentId,
			children = {},
		}
		if instance:IsA("BaseScript") then
			node.disabled = not instance.Enabled
			node.runContext = (instance :: BaseScript).RunContext.Name
		end
		instanceMap[id] = instance
		nodes[#nodes + 1] = node
		nodeCount += 1
		return node, id
	end

	local stack: { { any } } = {}

	for _, serviceName in Services do
		local service = game:GetService(serviceName)
		stack[#stack + 1] = { service, nil, 0 }
	end

	while #stack > 0 do
		local frame = stack[#stack]
		stack[#stack] = nil

		local instance: Instance = frame[1]
		local parentNode: Node? = frame[2]
		local depth: number = frame[3]

		if depth >= MAX_DEPTH or nodeCount >= MAX_NODES then
			continue
		end

		local parentId: string? = if parentNode then parentNode.id else nil
		local node, id = makeNode(instance, parentId)

		if parentNode then
			parentNode.children[#parentNode.children + 1] = id
		else
			rootIds[#rootIds + 1] = id
		end

		local children = instance:GetChildren()
		for i = #children, 1, -1 do
			stack[#stack + 1] = { children[i], node, depth + 1 }
		end

		if nodeCount % YIELD_EVERY == 0 then
			task.wait()
		end
	end

	local snapshot: Snapshot = {
		rootIds = rootIds,
		nodes = nodes,
	}

	return snapshot, instanceMap
end

function SerializeDatamodel.serializeSubtree(instance: Instance): (string, { Node })
	local nodes: { Node } = {}
	local nodeCount = 0

	local function processInstance(inner: Instance, parentId: string?, depth: number): string?
		if depth >= MAX_DEPTH or nodeCount >= MAX_NODES then
			return nil
		end

		local id = inner:GetDebugId(0)
		local node: Node = {
			id = id,
			name = inner.Name,
			className = inner.ClassName,
			parentId = parentId,
			children = {},
		}

		if inner:IsA("BaseScript") then
			node.disabled = not inner.Enabled
			node.runContext = (inner :: BaseScript).RunContext.Name
		end

		table.insert(nodes, node)
		nodeCount += 1

		for _, child in inner:GetChildren() do
			local childId = processInstance(child, id, depth + 1)
			if childId then
				table.insert(node.children, childId)
			end
		end

		return id
	end

	local rootId = processInstance(instance, nil, 0)
	return rootId :: string, nodes
end

return SerializeDatamodel
