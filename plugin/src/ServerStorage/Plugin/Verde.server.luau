--[[
	Verde - Roblox Studio Plugin
	Companion plugin for the Verde VSCode extension.

	Dvitash 1/4/2026
--]]

local RunService = game:GetService("RunService")

if RunService:IsRunning() then
	return
end

local StateController = require(script.Parent.States.StateController)
local SharedFolder = require(script.Parent.Shared)
local PluginButtonFactory = SharedFolder.PluginButton
local ButtonInstance = SharedFolder.ButtonInstance
local SoundPlayer = SharedFolder.SoundPlayer

SoundPlayer.Init(plugin)

local connectButton = PluginButtonFactory(plugin)
ButtonInstance.button = connectButton

local clickConnection = connectButton.Click:Connect(function()
	local currentStateName = StateController.GetState()

	if not currentStateName or currentStateName == "Connected" or currentStateName == "Connecting" then
		StateController.SwitchState("Disconnected")
	else
		StateController.SwitchState("Connecting")
	end
end)

plugin.Unloading:Connect(function()
	StateController.SwitchState("Disconnected")
	StateController.Cleanup()
	clickConnection:Disconnect()
	SoundPlayer.cleanup()
end)

StateController.SwitchState("Connecting")
