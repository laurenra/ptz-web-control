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

interface Window {
  sendViscaUdp?: (camera: CameraSettings, packet: number[]) => void | Promise<void>;
}

const SPEED_LIMITS: Record<SpeedName, number> = {
  pan: 25,
  tilt: 25,
  zoom: 8,
  focus: 8,
};

const STORAGE_KEY = "ptz-camera-settings";
const TEST_URL = "ws://127.0.0.1:8080/ws/test";
const VISCA_URL = "ws://127.0.0.1:8080/ws";
const DISCOVERY_URL = "ws://127.0.0.1:8080/ws/discovery";
const DISCOVERY_PROBE = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://w3.org"
               xmlns:wsa="http://xmlsoap.org"
               xmlns:wsd="http://xmlsoap.org"
               xmlns:dn="http://onvif.org">
   <soap:Header>
      <wsa:MessageID>uuid:c2b1860d-3294-4c4b-8d48-000000000000</wsa:MessageID>
      <wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>
      <wsa:Action>http://xmlsoap.org/Probe</wsa:Action>
   </soap:Header>
   <soap:Body>
      <wsd:Probe>
         <wsd:Types>dn:NetworkVideoTransmitter</wsd:Types>
      </wsd:Probe>
   </soap:Body>
</soap:Envelope>`;
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
bindDiscoveryControls();
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

function bindDiscoveryControls(): void {
  const openButton = document.getElementById("open-discovery-socket");
  const findButton = document.getElementById("find-cameras");
  const testButton = document.getElementById("test-socket");
  const status = document.getElementById("discovery-status");
  const responses = document.getElementById("server-responses");

  if (!(openButton instanceof HTMLButtonElement) || !(findButton instanceof HTMLButtonElement) || !(testButton instanceof HTMLButtonElement) || !status || !responses) {
    throw new Error("Missing discovery controls.");
  }

  let discoverySocket: WebSocket | null = null;
  findButton.disabled = true;
  testButton.disabled = true;

  testButton.addEventListener("click", () => {
    const socket = discoverySocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      testButton.disabled = true;
      status.textContent = "Socket is not open. Select Open Socket to connect.";
      return;
    }

    try {
      socket.send("Test message");
      status.textContent = "Test message sent. Waiting for responses…";
    } catch (error: unknown) {
      status.textContent = `Socket test failed: ${error instanceof Error ? error.message : String(error)}`;
      if (socket.readyState !== WebSocket.OPEN) {
        testButton.disabled = true;
        findButton.disabled = true;
        openButton.disabled = false;
      }
    }
  });

  findButton.addEventListener("click", () => {
    const socket = discoverySocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      findButton.disabled = true;
      testButton.disabled = true;
      status.textContent = "Socket is not open. Select Open Socket to connect.";
      return;
    }
    socket.binaryType = "arraybuffer";
    console.log("Connected to socket. Set binaryType to arraybuffer.");

    try {
      socket.send(DISCOVERY_PROBE);
      status.textContent = "Discovery probe sent. Waiting for responses…";
    } catch (error: unknown) {
      status.textContent = `Discovery failed: ${error instanceof Error ? error.message : String(error)}`;
      if (socket.readyState !== WebSocket.OPEN) {
        findButton.disabled = true;
        testButton.disabled = true;
        openButton.disabled = false;
      }
    }
  });

  openButton.addEventListener("click", () => {
    if (discoverySocket?.readyState === WebSocket.OPEN || discoverySocket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    openButton.disabled = true;
    findButton.disabled = true;
    testButton.disabled = true;
    status.textContent = "Connecting to discovery server…";

    let socket: WebSocket;
    try {
      // socket = new WebSocket(DISCOVERY_URL);
      // socket = new WebSocket(VISCA_URL);
      socket = new WebSocket(TEST_URL);
    } catch (error: unknown) {
      openButton.disabled = false;
      status.textContent = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }

    socket.binaryType = "arraybuffer";
    discoverySocket = socket;
    let failureMessage: string | null = null;
    const connectionTimeout = window.setTimeout(() => {
      if (discoverySocket === socket && socket.readyState === WebSocket.CONNECTING) {
        failureMessage = "Connection timed out.";
        status.textContent = `${failureMessage} Select Open Socket to try again.`;
        openButton.disabled = false;
        findButton.disabled = true;
        testButton.disabled = true;
        socket.close();
      }
    }, 10000);

    socket.addEventListener("open", () => {
      window.clearTimeout(connectionTimeout);
      if (discoverySocket !== socket) {
        return;
      }
      openButton.disabled = true;
      findButton.disabled = false;
      testButton.disabled = false;
      status.textContent = "Socket open. Select Find Cameras to send a discovery probe or Test Socket to send a test message.";
    });

    socket.addEventListener("message", (event: MessageEvent) => {
      if (discoverySocket !== socket) {
        return;
      }
      const response = document.createElement("pre");
      response.className = "server-response";
      response.textContent = event.data instanceof ArrayBuffer
        ? new TextDecoder().decode(event.data)
        : String(event.data);
      responses.querySelector(".response-placeholder")?.remove();
      responses.append(response);
      responses.scrollTop = responses.scrollHeight;
      status.textContent = "Response received. Listening for more responses…";
    });

    socket.addEventListener("error", () => {
      window.clearTimeout(connectionTimeout);
      if (discoverySocket !== socket) {
        return;
      }
      failureMessage ??= "WebSocket connection failed. Check the browser console for handshake details.";
      openButton.disabled = false;
      findButton.disabled = true;
      testButton.disabled = true;
      status.textContent = failureMessage;
      socket.close();
      console.error("WebSocket connection failed.");
    });

    socket.addEventListener("close", (event: CloseEvent) => {
      window.clearTimeout(connectionTimeout);
      if (discoverySocket !== socket) {
        return;
      }
      discoverySocket = null;
      openButton.disabled = false;
      findButton.disabled = true;
      testButton.disabled = true;
      const closeDetails = `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
      status.textContent = `${failureMessage ?? "Socket closed."} (${closeDetails}) Select Open Socket to reconnect.`;
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
