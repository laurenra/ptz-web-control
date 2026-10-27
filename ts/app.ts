import { bindWebSocketControls } from "./websocket.js";

type Direction = "up" | "down" | "left" | "right" | "stop";
type SpeedName = "pan" | "tilt" | "zoom" | "focus";

interface CameraSettings {
  name: string;
  ip: string;
  port: number;
}

interface SpeedControl {
  input: HTMLInputElement;
  limit: number;
}

declare global {
  interface Window {
    sendViscaUdp?: (camera: CameraSettings, packet: number[]) => void | Promise<void>;
  }
}

const SPEED_LIMITS: Record<SpeedName, number> = {
  pan: 25,
  tilt: 25,
  zoom: 8,
  focus: 8,
};

const STORAGE_KEY = "ptz-camera-settings";
const VISCA_COMMAND_PAYLOAD_TYPE = 0x0100;
const VISCA_OVER_IP_HEADER_LENGTH = 8;
const directionBytes: Record<Direction, [number, number]> = {
  left: [0x01, 0x03],
  right: [0x02, 0x03],
  up: [0x03, 0x01],
  down: [0x03, 0x02],
  stop: [0x03, 0x03],
};

let sequenceNumber = 0;

const cameraNameInput = getInput("camera-name");
const cameraIpInput = getInput("camera-ip");
const cameraPortInput = getInput("camera-port");
const packetOutput = getOutput("packet-output");

const speedControls: Record<SpeedName, SpeedControl> = {
  pan: { input: getInput("pan-speed"), limit: SPEED_LIMITS.pan },
  tilt: { input: getInput("tilt-speed"), limit: SPEED_LIMITS.tilt },
  zoom: { input: getInput("zoom-speed"), limit: SPEED_LIMITS.zoom },
  focus: { input: getInput("focus-speed"), limit: SPEED_LIMITS.focus },
};

loadSettings();
applySpeedLimits();
bindSettingsPersistence();
bindSpeedValidation();
bindMotionControls();
bindPresetControls();
bindWebSocketControls();
showSpeedStatus();

function getInput(id: string): HTMLInputElement {
  const element = document.getElementById(id);

  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing input #${id}`);
  }

  return element;
}

function getOutput(id: string): HTMLOutputElement {
  const element = document.getElementById(id);

  if (!(element instanceof HTMLOutputElement)) {
    throw new Error(`Missing output #${id}`);
  }

  return element;
}

function applySpeedLimits(): void {
  Object.values(speedControls).forEach(({ input, limit }) => {
    input.min = "1";
    input.max = String(limit);
  });
}

function bindSettingsPersistence(): void {
  [cameraNameInput, cameraIpInput, cameraPortInput, ...Object.values(speedControls).map(({ input }) => input)]
    .forEach((input) => input.addEventListener("change", saveSettings));
}

function bindSpeedValidation(): void {
  Object.entries(speedControls).forEach(([name, control]) => {
    control.input.addEventListener("input", () => {
      validateSpeed(name as SpeedName);
      showSpeedStatus();
    });
  });
}

function bindMotionControls(): void {
  document.querySelectorAll<HTMLButtonElement>(".arrow-button").forEach((button) => {
    const direction = button.dataset.direction as Direction | undefined;

    if (!direction) {
      return;
    }

    if (direction === "stop") {
      button.addEventListener("click", () => sendPanTiltCommand("stop"));
      return;
    }

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("is-active");
      sendPanTiltCommand(direction);
    });

    button.addEventListener("pointerup", (event) => {
      event.preventDefault();
      button.classList.remove("is-active");
      sendPanTiltCommand("stop");
    });

    button.addEventListener("pointercancel", () => {
      button.classList.remove("is-active");
      sendPanTiltCommand("stop");
    });

    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      sendPanTiltCommand(direction);
      window.setTimeout(() => sendPanTiltCommand("stop"), 250);
    });
  });
}

function bindPresetControls(): void {
  document.querySelectorAll<HTMLButtonElement>(".preset-button").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = Number(button.dataset.preset);

      if (!Number.isInteger(preset) || preset < 1 || preset > 9) {
        showMessage("Invalid preset button.");
        return;
      }

      sendViscaPayload(`Recall preset ${preset}`, [0x81, 0x01, 0x04, 0x3f, 0x02, preset, 0xff]);
    });
  });
}

function sendPanTiltCommand(direction: Direction): void {
  const panSpeed = readSpeedValue("pan");
  const tiltSpeed = readSpeedValue("tilt");

  if (panSpeed === null || tiltSpeed === null) {
    return;
  }

  const [panDirection, tiltDirection] = directionBytes[direction];
  const payload = [0x81, 0x01, 0x06, 0x01, panSpeed, tiltSpeed, panDirection, tiltDirection, 0xff];
  sendViscaPayload(`Move ${direction}`, payload);
}

function sendViscaPayload(label: string, payload: number[]): void {
  const camera = readCameraSettings();

  if (!camera) {
    return;
  }

  const packet = buildViscaOverIpPacket(payload);
  showMessage(formatPacketStatus(label, camera, packet));

  if (!window.sendViscaUdp) {
    return;
  }

  Promise.resolve(window.sendViscaUdp(camera, packet)).catch((error: unknown) => {
    showMessage(`Send failed: ${error instanceof Error ? error.message : String(error)}`);
  });
}

function buildViscaOverIpPacket(payload: number[]): number[] {
  const sequence = sequenceNumber;
  sequenceNumber = (sequenceNumber + 1) >>> 0;

  return [
    (VISCA_COMMAND_PAYLOAD_TYPE >> 8) & 0xff,
    VISCA_COMMAND_PAYLOAD_TYPE & 0xff,
    (payload.length >> 8) & 0xff,
    payload.length & 0xff,
    (sequence >> 24) & 0xff,
    (sequence >> 16) & 0xff,
    (sequence >> 8) & 0xff,
    sequence & 0xff,
    ...payload,
  ];
}

function readCameraSettings(): CameraSettings | null {
  const name = cameraNameInput.value.trim() || "Camera";
  const ip = cameraIpInput.value.trim();
  const port = Number(cameraPortInput.value);

  if (!ip) {
    showMessage("Enter a camera IP address.");
    cameraIpInput.focus();
    return null;
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    showMessage("Enter a valid port from 1 to 65535.");
    cameraPortInput.focus();
    return null;
  }

  return { name, ip, port };
}

function readSpeedValue(name: SpeedName): number | null {
  if (!validateSpeed(name, true)) {
    speedControls[name].input.focus();
    return null;
  }

  return Number(speedControls[name].input.value) - 1;
}

function validateSpeed(name: SpeedName, report = false): boolean {
  const { input, limit } = speedControls[name];
  const value = Number(input.value);
  const valid = Number.isInteger(value) && value >= 1 && value <= limit;

  input.setCustomValidity(valid ? "" : `Enter a ${name} speed from 1 to ${limit}.`);

  if (!valid && report) {
    input.reportValidity();
  }

  return valid;
}

function showSpeedStatus(): void {
  const values = (Object.keys(speedControls) as SpeedName[]).map((name) => {
    const speed = readRawSpeedValue(name);
    return `${name}=${speed === null ? "--" : formatByte(speed - 1)}`;
  });

  showMessage(`Speeds ${values.join(" ")}`);
}

function readRawSpeedValue(name: SpeedName): number | null {
  const { input, limit } = speedControls[name];
  const value = Number(input.value);

  if (!Number.isInteger(value) || value < 1 || value > limit) {
    return null;
  }

  return value;
}

function formatBytes(bytes: number[]): string {
  return bytes.map(formatByte).join(" ");
}

function formatPacketStatus(label: string, camera: CameraSettings, packet: number[]): string {
  const header = packet.slice(0, VISCA_OVER_IP_HEADER_LENGTH);
  const command = packet.slice(VISCA_OVER_IP_HEADER_LENGTH);

  return `${label}: ${formatBytes(header)}\n${formatBytes(command)} -> ${camera.ip}:${camera.port}`;
}

function formatByte(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function showMessage(message: string): void {
  packetOutput.value = message;
}

function saveSettings(): void {
  const data = {
    name: cameraNameInput.value,
    ip: cameraIpInput.value,
    port: cameraPortInput.value,
    speeds: Object.fromEntries(
      Object.entries(speedControls).map(([name, { input }]) => [name, input.value]),
    ),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadSettings(): void {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return;
  }

  try {
    const data = JSON.parse(raw) as {
      name?: string;
      ip?: string;
      port?: string;
      speeds?: Partial<Record<SpeedName, string>>;
    };

    cameraNameInput.value = data.name ?? cameraNameInput.value;
    cameraIpInput.value = data.ip ?? cameraIpInput.value;
    cameraPortInput.value = data.port ?? cameraPortInput.value;

    Object.entries(data.speeds ?? {}).forEach(([name, value]) => {
      if (name in speedControls && value !== undefined) {
        speedControls[name as SpeedName].input.value = value;
      }
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}
