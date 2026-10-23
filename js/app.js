"use strict";
const SPEED_LIMITS = {
    pan: 25,
    tilt: 25,
    zoom: 8,
    focus: 8,
};
const STORAGE_KEY = "ptz-camera-settings";
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
const directionBytes = {
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
const speedControls = {
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
function getInput(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLInputElement)) {
        throw new Error(`Missing input #${id}`);
    }
    return element;
}
function getOutput(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLOutputElement)) {
        throw new Error(`Missing output #${id}`);
    }
    return element;
}
function applySpeedLimits() {
    Object.values(speedControls).forEach(({ input, limit }) => {
        input.min = "1";
        input.max = String(limit);
    });
}
function bindSettingsPersistence() {
    [cameraNameInput, cameraIpInput, cameraPortInput, ...Object.values(speedControls).map(({ input }) => input)]
        .forEach((input) => input.addEventListener("change", saveSettings));
}
function bindSpeedValidation() {
    Object.entries(speedControls).forEach(([name, control]) => {
        control.input.addEventListener("input", () => {
            validateSpeed(name);
            showSpeedStatus();
        });
    });
}
function bindMotionControls() {
    document.querySelectorAll(".arrow-button").forEach((button) => {
        const direction = button.dataset.direction;
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
function bindPresetControls() {
    document.querySelectorAll(".preset-button").forEach((button) => {
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
function bindDiscoveryControls() {
    const button = document.getElementById("find-cameras");
    const status = document.getElementById("discovery-status");
    const responses = document.getElementById("server-responses");
    if (!(button instanceof HTMLButtonElement) || !status || !responses) {
        throw new Error("Missing discovery controls.");
    }
    let discoverySocket = null;
    const sendProbe = (socket) => {
        try {
            socket.send(DISCOVERY_PROBE);
            status.textContent = "Discovery probe sent. Waiting for responses…";
        }
        catch (error) {
            status.textContent = `Discovery failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    };
    button.addEventListener("click", () => {
        if (discoverySocket?.readyState === WebSocket.OPEN) {
            sendProbe(discoverySocket);
            return;
        }
        if (discoverySocket?.readyState === WebSocket.CONNECTING) {
            return;
        }
        button.disabled = true;
        status.textContent = "Connecting to discovery server…";
        let socket;
        try {
            // socket = new WebSocket(DISCOVERY_URL);
            socket = new WebSocket('ws://127.0.0.1:8080/ws/discovery');
        }
        catch (error) {
            button.disabled = false;
            status.textContent = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
            return;
        }
        discoverySocket = socket;
        socket.binaryType = "arraybuffer";
        let failed = false;
        const connectionTimeout = window.setTimeout(() => {
            if (discoverySocket === socket && socket.readyState === WebSocket.CONNECTING) {
                failed = true;
                status.textContent = "Connection timed out. Check that the discovery server is running and try again.";
                button.disabled = false;
                socket.close();
            }
        }, 10000);
        socket.addEventListener("open", () => {
            window.clearTimeout(connectionTimeout);
            if (discoverySocket !== socket) {
                return;
            }
            button.disabled = false;
            sendProbe(socket);
        });
        socket.addEventListener("message", (event) => {
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
            failed = true;
            button.disabled = false;
            status.textContent = "Connection failed. Check the discovery server at 127.0.0.1:8080 and try again.";
            socket.close();
        });
        socket.addEventListener("close", () => {
            window.clearTimeout(connectionTimeout);
            if (discoverySocket !== socket) {
                return;
            }
            discoverySocket = null;
            button.disabled = false;
            if (!failed) {
                status.textContent = "Discovery connection closed. Select Find Cameras to reconnect.";
            }
        });
    });
}
function sendPanTiltCommand(direction) {
    const panSpeed = readSpeedValue("pan");
    const tiltSpeed = readSpeedValue("tilt");
    if (panSpeed === null || tiltSpeed === null) {
        return;
    }
    const [panDirection, tiltDirection] = directionBytes[direction];
    const payload = [0x81, 0x01, 0x06, 0x01, panSpeed, tiltSpeed, panDirection, tiltDirection, 0xff];
    sendViscaPayload(`Move ${direction}`, payload);
}
function sendViscaPayload(label, payload) {
    const camera = readCameraSettings();
    if (!camera) {
        return;
    }
    const packet = buildViscaOverIpPacket(payload);
    showMessage(formatPacketStatus(label, camera, packet));
    if (!window.sendViscaUdp) {
        return;
    }
    Promise.resolve(window.sendViscaUdp(camera, packet)).catch((error) => {
        showMessage(`Send failed: ${error instanceof Error ? error.message : String(error)}`);
    });
}
function buildViscaOverIpPacket(payload) {
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
function readCameraSettings() {
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
function readSpeedValue(name) {
    if (!validateSpeed(name, true)) {
        speedControls[name].input.focus();
        return null;
    }
    return Number(speedControls[name].input.value) - 1;
}
function validateSpeed(name, report = false) {
    const { input, limit } = speedControls[name];
    const value = Number(input.value);
    const valid = Number.isInteger(value) && value >= 1 && value <= limit;
    input.setCustomValidity(valid ? "" : `Enter a ${name} speed from 1 to ${limit}.`);
    if (!valid && report) {
        input.reportValidity();
    }
    return valid;
}
function showSpeedStatus() {
    const values = Object.keys(speedControls).map((name) => {
        const speed = readRawSpeedValue(name);
        return `${name}=${speed === null ? "--" : formatByte(speed - 1)}`;
    });
    showMessage(`Speeds ${values.join(" ")}`);
}
function readRawSpeedValue(name) {
    const { input, limit } = speedControls[name];
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > limit) {
        return null;
    }
    return value;
}
function formatBytes(bytes) {
    return bytes.map(formatByte).join(" ");
}
function formatPacketStatus(label, camera, packet) {
    const header = packet.slice(0, VISCA_OVER_IP_HEADER_LENGTH);
    const command = packet.slice(VISCA_OVER_IP_HEADER_LENGTH);
    return `${label}: ${formatBytes(header)}\n${formatBytes(command)} -> ${camera.ip}:${camera.port}`;
}
function formatByte(value) {
    return value.toString(16).padStart(2, "0").toUpperCase();
}
function showMessage(message) {
    packetOutput.value = message;
}
function saveSettings() {
    const data = {
        name: cameraNameInput.value,
        ip: cameraIpInput.value,
        port: cameraPortInput.value,
        speeds: Object.fromEntries(Object.entries(speedControls).map(([name, { input }]) => [name, input.value])),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadSettings() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return;
    }
    try {
        const data = JSON.parse(raw);
        cameraNameInput.value = data.name ?? cameraNameInput.value;
        cameraIpInput.value = data.ip ?? cameraIpInput.value;
        cameraPortInput.value = data.port ?? cameraPortInput.value;
        Object.entries(data.speeds ?? {}).forEach(([name, value]) => {
            if (name in speedControls && value !== undefined) {
                speedControls[name].input.value = value;
            }
        });
    }
    catch {
        localStorage.removeItem(STORAGE_KEY);
    }
}
