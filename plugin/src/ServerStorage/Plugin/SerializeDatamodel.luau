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

local MAX_DEPTH = 10000
local MAX_NODES = math.huge

local SerializeDatamodel = {}

function SerializeDatamodel.serializeFull(): (Snapshot, { [string]: Instance })
	local nodes: { Node } = {}
	local instanceMap: { [string]: Instance } = {}
	local rootIds: { string } = {}
	local nodeCount = 0

	local function processInstance(instance: Instance, parentId: string, depth: number)
		if depth >= MAX_DEPTH then
			return
		end

		if nodeCount >= MAX_NODES then
			return
		end

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

		table.insert(nodes, node)
		nodeCount += 1

		for _, child in instance:GetChildren() do
			local childId = processInstance(child, id, depth + 1)

			if childId then
				table.insert(node.children, childId)
			end
		end

		return id
	end

	for _, serviceName in Services do
		local service = game:GetService(serviceName)
		local serviceId = processInstance(service, nil, 0)

		if serviceId then
			table.insert(rootIds, serviceId)
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
