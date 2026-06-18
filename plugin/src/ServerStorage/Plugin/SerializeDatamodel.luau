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
	hasChildren: boolean?,
	disabled: boolean?,
	runContext: string?,
}

type Snapshot = {
	rootIds: { string },
	nodes: { Node },
}

local YIELD_EVERY = 5000
local MAX_DEPTH = 10000
local MAX_NODES = 50000
local MAX_SEARCH_RESULTS = 500

local SerializeDatamodel = {}

local function makeNode(instance: Instance, parentId: string?): Node
	local node: Node = {
		id = instance:GetDebugId(0),
		name = instance.Name,
		className = instance.ClassName,
		parentId = parentId,
		children = {},
	}

	if instance:IsA("BaseScript") then
		node.disabled = not instance.Enabled
		node.runContext = (instance :: BaseScript).RunContext.Name
	end

	return node
end

function SerializeDatamodel.serializeFull(maxNodes: number?): (Snapshot?, { [string]: Instance }?)
	local limit: number = maxNodes or MAX_NODES
	local nodes: { Node } = {}
	local instanceMap: { [string]: Instance } = {}
	local rootIds: { string } = {}
	local nodeCount = 0
	local exceeded = false

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

		if depth >= MAX_DEPTH then
			continue
		end

		if nodeCount >= limit then
			exceeded = true
			break
		end

		local parentId: string? = if parentNode then parentNode.id else nil
		local node = makeNode(instance, parentId)
		local id = node.id

		instanceMap[id] = instance
		nodes[#nodes + 1] = node
		nodeCount += 1

		if parentNode then
			parentNode.children[#parentNode.children + 1] = id
			parentNode.hasChildren = true
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

	if exceeded then
		return nil, nil
	end

	local snapshot: Snapshot = {
		rootIds = rootIds,
		nodes = nodes,
	}

	return snapshot, instanceMap
end

function SerializeDatamodel.serializeRoots(): (Snapshot, { [string]: Instance })
	local nodes: { Node } = {}
	local instanceMap: { [string]: Instance } = {}
	local rootIds: { string } = {}

	for _, serviceName in Services do
		local service = game:GetService(serviceName)
		local node = SerializeDatamodel.serializeShallow(service, nil)

		instanceMap[node.id] = service
		table.insert(nodes, node)
		table.insert(rootIds, node.id)
	end

	local snapshot: Snapshot = {
		rootIds = rootIds,
		nodes = nodes,
	}

	return snapshot, instanceMap
end

function SerializeDatamodel.serializeChildren(parent: Instance): ({ Node }, { [string]: Instance })
	local nodes: { Node } = {}
	local instanceMap: { [string]: Instance } = {}

	local parentId = parent:GetDebugId(0)

	for _, child in parent:GetChildren() do
		local node = SerializeDatamodel.serializeShallow(child, parentId)

		instanceMap[node.id] = child
		table.insert(nodes, node)
	end

	return nodes, instanceMap
end

function SerializeDatamodel.serializeShallow(instance: Instance, parentId: string?): Node
	local node = makeNode(instance, parentId)
	node.hasChildren = #instance:GetChildren() > 0
	return node
end

function SerializeDatamodel.serializeSearchResults(
	lowercaseQuery: string,
	candidates: { Instance }?
): ({ Node }, { [string]: Instance }, boolean, { Instance })
	local nodes: { Node } = {}
	local instanceMap: { [string]: Instance } = {}
	local visited: { [string]: true } = {}
	local matched: { Instance } = {}
	local truncated = false

	local function include(instance: Instance): boolean
		local id = instance:GetDebugId(0)
		if visited[id] then
			return true
		end

		if #nodes >= MAX_SEARCH_RESULTS then
			truncated = true
			return false
		end

		local parent = instance.Parent
		local parentId: string? = nil
		if parent and parent ~= game then
			if not include(parent) then
				return false
			end
			parentId = parent:GetDebugId(0)
		end

		visited[id] = true

		local node = makeNode(instance, parentId)
		node.hasChildren = #instance:GetChildren() > 0

		instanceMap[id] = instance
		table.insert(nodes, node)
		return true
	end

	local tokens: { string } = {}
	for token in string.gmatch(lowercaseQuery, "[^%s%.]+") do
		table.insert(tokens, token)
	end

	local lowerPathCache: { [string]: string } = {}
	local function lowerPath(instance: Instance): string
		local id = instance:GetDebugId(0)
		local cached = lowerPathCache[id]
		if cached ~= nil then
			return cached
		end
		local lowerName = string.lower(instance.Name)
		local parent = instance.Parent
		local path: string
		if parent and parent ~= game then
			path = lowerPath(parent) .. "." .. lowerName
		else
			path = lowerName
		end
		lowerPathCache[id] = path
		return path
	end

	local lowerClassNameCache: { [string]: string } = {}
	local function matches(instance: Instance): boolean
		if #tokens == 0 then
			return false
		end
		local path = lowerPath(instance)
		local className = instance.ClassName
		local lowerClassName = lowerClassNameCache[className]
		if lowerClassName == nil then
			lowerClassName = string.lower(className)
			lowerClassNameCache[className] = lowerClassName
		end
		for _, token in tokens do
			if string.find(path, token, 1, true) == nil
				and string.find(lowerClassName, token, 1, true) == nil
			then
				return false
			end
		end
		return true
	end

	local function consider(instance: Instance): boolean
		if #nodes >= MAX_SEARCH_RESULTS then
			truncated = true
			return false
		end
		if matches(instance) then
			table.insert(matched, instance)
			include(instance)
		end
		return true
	end

	if candidates then
		for _, instance in candidates do
			if not consider(instance) then
				break
			end
		end
	else
		for _, serviceName in Services do
			local service = game:GetService(serviceName)
			if not consider(service) then
				break
			end
			for _, descendant in service:GetDescendants() do
				if not consider(descendant) then
					break
				end
			end
			if truncated then
				break
			end
		end
	end

	return nodes, instanceMap, truncated, matched
end

return SerializeDatamodel
