import * as vscode from "vscode";
import * as https from "https";
import { getAvailableIconClassNames } from "./iconResolver";

const COMMON_CLASS_NAMES = [
    "Part",
    "Model",
    "Folder",
    "Script",
    "LocalScript",
    "ModuleScript",
    "StringValue",
    "NumberValue",
    "BoolValue",
    "Vector3Value",
    "CFrameValue",
    "Color3Value",
];

const FALLBACK_CLASS_NAMES = [
    "Part",
    "Model",
    "Folder",
    "Script",
    "LocalScript",
    "ModuleScript",
    "StringValue",
    "NumberValue",
    "BoolValue",
    "Vector3Value",
    "CFrameValue",
    "Color3Value",
    "Accessory",
    "Actor",
    "AdGui",
    "AdPortal",
    "AirController",
    "AlignOrientation",
    "AlignPosition",
    "AngularVelocity",
    "Animation",
    "AnimationConstraint",
    "AnimationController",
    "Animator",
    "ArcHandles",
    "Atmosphere",
    "Attachment",
    "AudioAnalyzer",
    "AudioChannelMixer",
    "AudioDeviceInput",
    "AudioDeviceOutput",
    "AudioDistortion",
    "AudioEcho",
    "AudioEmitter",
    "AudioEqualizer",
    "AudioFader",
    "AudioFilter",
    "AudioFlanger",
    "AudioGate",
    "AudioLimiter",
    "AudioListener",
    "AudioPitchShifter",
    "AudioPlayer",
    "AudioRecorder",
    "AudioReverb",
    "AudioSpeechToText",
    "AudioTextToSpeech",
    "AudioTremolo",
    "Backpack",
    "BallSocketConstraint",
    "BasePlate",
    "Beam",
    "BillboardGui",
    "BindableEvent",
    "BindableFunction",
    "BlockMesh",
    "BloomEffect",
    "BlurEffect",
    "BodyAngularVelocity",
    "BodyColors",
    "BodyForce",
    "BodyGyro",
    "BodyPosition",
    "BodyVelocity",
    "Bone",
    "BoxHandleAdornment",
    "BrickColorValue",
    "Camera",
    "CanvasGroup",
    "CharacterMesh",
    "Chat",
    "ChorusSoundEffect",
    "ClickDetector",
    "ClientReplicator",
    "Clouds",
    "ColorCorrectionEffect",
    "CompressorSoundEffect",
    "ConeHandleAdornment",
    "Configuration",
    "CornerWedgePart",
    "CylinderHandleAdornment",
    "CylinderMesh",
    "CylindricalConstraint",
    "Decal",
    "DepthOfFieldEffect",
    "Dialog",
    "DialogChoice",
    "DistortionSoundEffect",
    "DoubleConstrainedValue",
    "DragDetector",
    "EchoSoundEffect",
    "EditableImage",
    "EditableMesh",
    "EqualizerSoundEffect",
    "Explosion",
    "FaceControls",
    "FileMesh",
    "Fire",
    "Flag",
    "FlagStand",
    "FlangeSoundEffect",
    "ForceField",
    "Frame",
    "GameSettings",
    "Glue",
    "GroundController",
    "Handles",
    "HapticEffect",
    "HapticService",
    "HeightmapImporterService",
    "Highlight",
    "HingeConstraint",
    "Hint",
    "Hole",
    "HopperBin",
    "Humanoid",
    "HumanoidDescription",
    "IKControl",
    "ImageButton",
    "ImageHandleAdornment",
    "ImageLabel",
    "InputAction",
    "InputBinding",
    "InputContext",
    "IntConstrainedValue",
    "IntersectOperation",
    "IntValue",
    "Keyframe",
    "KeyframeMarker",
    "KeyframeSequence",
    "LinearVelocity",
    "LineForce",
    "LineHandleAdornment",
    "ManualGlue",
    "ManualWeld",
    "MaterialService",
    "MaterialVariant",
    "MeshPart",
    "Message",
    "Motor",
    "Motor6D",
    "MotorFeature",
    "Mouse",
    "NoCollisionConstraint",
    "ObjectValue",
    "Pants",
    "ParticleEmitter",
    "PathfindingLink",
    "PathfindingModifier",
    "PathfindingService",
    "PitchShiftSoundEffect",
    "Plane",
    "PlaneConstraint",
    "Player",
    "PlayerGui",
    "PlayerScripts",
    "Players",
    "PointLight",
    "Pose",
    "PrismaticConstraint",
    "ProximityPrompt",
    "RayValue",
    "RemoteEvent",
    "RemoteFunction",
    "ReverbSoundEffect",
    "RigidConstraint",
    "RodConstraint",
    "RoofPart",
    "RopeConstraint",
    "RotateP",
    "RotateV",
    "ScreenGui",
    "ScrollingFrame",
    "Seat",
    "SelectionBox",
    "SelectionSphere",
    "ServerReplicator",
    "ServerScriptService",
    "ServerStorage",
    "Shirt",
    "ShirtGraphic",
    "SkateboardController",
    "SkateboardPlatform",
    "Sky",
    "Smoke",
    "Sound",
    "SoundGroup",
    "SoundService",
    "Sparkles",
    "SpawnLocation",
    "Speaker",
    "SpecialMesh",
    "SphereHandleAdornment",
    "SpotLight",
    "SpringConstraint",
    "StarterCharacterScripts",
    "StarterGui",
    "StarterPack",
    "StarterPlayer",
    "StarterPlayerScripts",
    "SteppingMotor",
    "StyleDerive",
    "StyleLink",
    "StyleRule",
    "StyleSheet",
    "SunRaysEffect",
    "SurfaceAppearance",
    "SurfaceGui",
    "SurfaceLight",
    "SurfaceSelection",
    "Suspension",
    "SwimController",
    "Team",
    "Teams",
    "TeleportService",
    "Terrain",
    "TextBox",
    "TextButton",
    "TextLabel",
    "TextService",
    "Texture",
    "Tool",
    "Torque",
    "TorsionSpringConstraint",
    "Trail",
    "TremoloSoundEffect",
    "TrussPart",
    "Tween",
    "TweenService",
    "UIAspectRatioConstraint",
    "UICorner",
    "UIDragDetector",
    "UIFlexItem",
    "UIGradient",
    "UIGridLayout",
    "UIListLayout",
    "UIPadding",
    "UIPageLayout",
    "UIScale",
    "UISizeConstraint",
    "UIStroke",
    "UITableLayout",
    "UITextSizeConstraint",
    "UnionOperation",
    "UniversalConstraint",
    "UnreliableRemoteEvent",
    "UserInputService",
    "VectorForce",
    "VehicleController",
    "VehicleSeat",
    "VelocityMotor",
    "VideoFrame",
    "ViewportFrame",
    "VirtualUser",
    "VoiceChannel",
    "VoiceChatService",
    "WedgePart",
    "Weld",
    "WeldConstraint",
    "Wheel",
    "Wire",
    "WireframeHandleAdornment",
    "WorldModel",
    "WrapDeformer",
    "WrapLayer",
    "WrapTarget",
];

const API_DUMP_URL =
    "https://raw.githubusercontent.com/MaximumADHD/Roblox-Client-Tracker/roblox/API-Dump.json";
const CACHE_KEY = "verde.robloxClassNames";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ClassNameCache = { classes: string[]; fetchedAt: number };

let currentClassNames: string[] = FALLBACK_CLASS_NAMES;

export function getClassNames(): string[] {
    return currentClassNames;
}

// The curated FALLBACK list is a known-good floor. A class from the API dump is
// only added on top of it if it ships an icon in assets/ — a missing icon means
// it isn't something Studio offers in its insert menu (ReflectionMetadata,
// internal types, etc.), even if Instance.new technically allows it.
function buildList(creatable: string[], iconClassNames: Set<string>): string[] {
    const favorites = new Set(COMMON_CLASS_NAMES);
    const curated = new Set(FALLBACK_CLASS_NAMES);
    const rest = creatable
        .filter(
            (name) =>
                !favorites.has(name) && (curated.has(name) || iconClassNames.has(name)),
        )
        .sort((a, b) => a.localeCompare(b));
    return [...COMMON_CLASS_NAMES, ...rest];
}

async function getIconClassNames(context: vscode.ExtensionContext): Promise<Set<string>> {
    return getAvailableIconClassNames(context.extensionUri);
}

function fetchCreatableClasses(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        https
            .get(API_DUMP_URL, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const chunks: Buffer[] = [];
                res.on("data", (chunk: Buffer) => chunks.push(chunk));
                res.on("end", () => {
                    try {
                        const dump = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        const classes: string[] = (dump.Classes ?? [])
                            .filter((c: any) => !(c.Tags ?? []).includes("NotCreatable"))
                            .map((c: any) => c.Name as string);
                        resolve(classes);
                    } catch (err) {
                        reject(err);
                    }
                });
            })
            .on("error", reject);
    });
}

export async function initClassNames(
    context: vscode.ExtensionContext,
    onUpdated: () => void,
): Promise<void> {
    let iconClassNames: Set<string>;
    try {
        iconClassNames = await getIconClassNames(context);
    } catch (err) {
        console.debug("Verde: failed to read class icons, using fallback list:", err);
        return;
    }

    const cached = context.globalState.get<ClassNameCache>(CACHE_KEY);
    if (cached?.classes?.length) {
        currentClassNames = buildList(cached.classes, iconClassNames);
        if (Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
            return;
        }
    }

    try {
        const classes = await fetchCreatableClasses();
        if (classes.length === 0) {
            return;
        }
        const next = buildList(classes, iconClassNames);
        const changed =
            next.length !== currentClassNames.length ||
            next.some((name, i) => name !== currentClassNames[i]);
        currentClassNames = next;
        const cacheEntry: ClassNameCache = { classes, fetchedAt: Date.now() };
        await context.globalState.update(CACHE_KEY, cacheEntry);
        if (changed) {
            onUpdated();
        }
    } catch (err) {
        console.debug("Verde: failed to fetch Roblox class list, using fallback:", err);
    }
}
