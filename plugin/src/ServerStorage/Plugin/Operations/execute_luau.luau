local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local InstanceMap = require(script.Parent.Parent.Shared.InstanceMap)

type Payload = {
	code: string,
	description: string?,
	nodeId: string?,
	extensionId: string?,
}

return function(payload: Payload): (any, string?)
	if type(payload.code) ~= "string" or payload.code == "" then
		return false, "execute_luau: missing code"
	end

	local extensionId = payload.extensionId or "extension"
	local description = payload.description or `Verde: {extensionId}`

	local selection: Instance? = nil
	if payload.nodeId then
		selection = InstanceMap[payload.nodeId]
		if not selection then
			return false, `execute_luau: instance not found: {payload.nodeId}`
		end
	end

	local wrapped = `return function(ctx){payload.code}\nend`
	local loader, loadError = loadstring(wrapped, `=verde: {extensionId}`)
	if not loader then
		return false, `execute_luau: compile failed: {tostring(loadError)}`
	end

	local topOk, fnOrErr = pcall(loader)
	if not topOk then
		return false, `execute_luau: top-level error: {tostring(fnOrErr)}`
	end
	if type(fnOrErr) ~= "function" then
		return false, "execute_luau: wrapper did not return a function"
	end
	local userFn = fnOrErr

	local ctx = {
		selection = selection,
		extensionId = extensionId,
	}

	local recording = ChangeHistoryService:TryBeginRecording(`ExecuteLuau: {extensionId}`, description)
	if not recording then
		return false, "execute_luau: could not begin recording (concurrent call?)"
	end

	local userResult: any
	local runOk, runErr = pcall(function()
		userResult = userFn(ctx)
	end)

	if not runOk then
		ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Cancel)
		return false, `execute_luau: script error: {tostring(runErr)}`
	end

	ChangeHistoryService:FinishRecording(recording, Enum.FinishRecordingOperation.Commit)

	if userResult == nil or userResult == false then
		return true
	end

	local encodeOk, encodeErr = pcall(function()
		HttpService:JSONEncode(userResult)
	end)
	if not encodeOk then
		return false, `execute_luau: return value not JSON-serializable: {tostring(encodeErr)}`
	end

	return userResult
end
