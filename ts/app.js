var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var SPEED_LIMITS = {
    pan: 25,
    tilt: 25,
    zoom: 8,
    focus: 8,
};
var STORAGE_KEY = "ptz-camera-settings";
var DISCOVERY_URL = "ws://127.0.0.1:8080/ws/discovery";
var DISCOVERY_PROBE = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<soap:Envelope xmlns:soap=\"http://w3.org\"\n               xmlns:wsa=\"http://xmlsoap.org\"\n               xmlns:wsd=\"http://xmlsoap.org\"\n               xmlns:dn=\"http://onvif.org\">\n   <soap:Header>\n      <wsa:MessageID>uuid:c2b1860d-3294-4c4b-8d48-000000000000</wsa:MessageID>\n      <wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>\n      <wsa:Action>http://xmlsoap.org/Probe</wsa:Action>\n   </soap:Header>\n   <soap:Body>\n      <wsd:Probe>\n         <wsd:Types>dn:NetworkVideoTransmitter</wsd:Types>\n      </wsd:Probe>\n   </soap:Body>\n</soap:Envelope>";
var VISCA_COMMAND_PAYLOAD_TYPE = 0x0100;
var VISCA_OVER_IP_HEADER_LENGTH = 8;
var directionBytes = {
    left: [0x01, 0x03],
    right: [0x02, 0x03],
    up: [0x03, 0x01],
    down: [0x03, 0x02],
    stop: [0x03, 0x03],
};
var sequenceNumber = 0;
var cameraNameInput = getInput("camera-name");
var cameraIpInput = getInput("camera-ip");
var cameraPortInput = getInput("camera-port");
var packetOutput = getOutput("packet-output");
var speedControls = {
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
    var element = document.getElementById(id);
    if (!(element instanceof HTMLInputElement)) {
        throw new Error("Missing input #".concat(id));
    }
    return element;
}
function getOutput(id) {
    var element = document.getElementById(id);
    if (!(element instanceof HTMLOutputElement)) {
        throw new Error("Missing output #".concat(id));
    }
    return element;
}
function applySpeedLimits() {
    Object.values(speedControls).forEach(function (_a) {
        var input = _a.input, limit = _a.limit;
        input.min = "1";
        input.max = String(limit);
    });
}
function bindSettingsPersistence() {
    __spreadArray([cameraNameInput, cameraIpInput, cameraPortInput], Object.values(speedControls).map(function (_a) {
        var input = _a.input;
        return input;
    }), true).forEach(function (input) { return input.addEventListener("change", saveSettings); });
}
function bindSpeedValidation() {
    Object.entries(speedControls).forEach(function (_a) {
        var name = _a[0], control = _a[1];
        control.input.addEventListener("input", function () {
            validateSpeed(name);
            showSpeedStatus();
        });
    });
}
function bindMotionControls() {
    document.querySelectorAll(".arrow-button").forEach(function (button) {
        var direction = button.dataset.direction;
        if (!direction) {
            return;
        }
        if (direction === "stop") {
            button.addEventListener("click", function () { return sendPanTiltCommand("stop"); });
            return;
        }
        button.addEventListener("pointerdown", function (event) {
            event.preventDefault();
            button.setPointerCapture(event.pointerId);
            button.classList.add("is-active");
            sendPanTiltCommand(direction);
        });
        button.addEventListener("pointerup", function (event) {
            event.preventDefault();
            button.classList.remove("is-active");
            sendPanTiltCommand("stop");
        });
        button.addEventListener("pointercancel", function () {
            button.classList.remove("is-active");
            sendPanTiltCommand("stop");
        });
        button.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            sendPanTiltCommand(direction);
            window.setTimeout(function () { return sendPanTiltCommand("stop"); }, 250);
        });
    });
}
function bindPresetControls() {
    document.querySelectorAll(".preset-button").forEach(function (button) {
        button.addEventListener("click", function () {
            var preset = Number(button.dataset.preset);
            if (!Number.isInteger(preset) || preset < 1 || preset > 9) {
                showMessage("Invalid preset button.");
                return;
            }
            sendViscaPayload("Recall preset ".concat(preset), [0x81, 0x01, 0x04, 0x3f, 0x02, preset, 0xff]);
        });
    });
}
function bindDiscoveryControls() {
    var button = document.getElementById("find-cameras");
    var status = document.getElementById("discovery-status");
    var responses = document.getElementById("server-responses");
    if (!(button instanceof HTMLButtonElement) || !status || !responses) {
        throw new Error("Missing discovery controls.");
    }
    var discoverySocket = null;
    var sendProbe = function (socket) {
        try {
            socket.send(DISCOVERY_PROBE);
            status.textContent = "Discovery probe sent. Waiting for responses…";
        }
        catch (error) {
            status.textContent = "Discovery failed: ".concat(error instanceof Error ? error.message : String(error));
        }
    };
    button.addEventListener("click", function () {
        if ((discoverySocket === null || discoverySocket === void 0 ? void 0 : discoverySocket.readyState) === WebSocket.OPEN) {
            sendProbe(discoverySocket);
            return;
        }
        if ((discoverySocket === null || discoverySocket === void 0 ? void 0 : discoverySocket.readyState) === WebSocket.CONNECTING) {
            return;
        }
        button.disabled = true;
        status.textContent = "Connecting to discovery server…";
        var socket;
        try {
            // socket = new WebSocket(DISCOVERY_URL);
            socket = new WebSocket('ws://127.0.0.1:8080/ws/discovery');
        }
        catch (error) {
            button.disabled = false;
            status.textContent = "Connection failed: ".concat(error instanceof Error ? error.message : String(error));
            return;
        }
        discoverySocket = socket;
        socket.binaryType = "arraybuffer";
        var failed = false;
        var connectionTimeout = window.setTimeout(function () {
            if (discoverySocket === socket && socket.readyState === WebSocket.CONNECTING) {
                failed = true;
                status.textContent = "Connection timed out. Check that the discovery server is running and try again.";
                button.disabled = false;
                socket.close();
            }
        }, 10000);
        socket.addEventListener("open", function () {
            window.clearTimeout(connectionTimeout);
            if (discoverySocket !== socket) {
                return;
            }
            button.disabled = false;
            sendProbe(socket);
        });
        socket.addEventListener("message", function (event) {
            var _a;
            if (discoverySocket !== socket) {
                return;
            }
            var response = document.createElement("pre");
            response.className = "server-response";
            response.textContent = event.data instanceof ArrayBuffer
                ? new TextDecoder().decode(event.data)
                : String(event.data);
            (_a = responses.querySelector(".response-placeholder")) === null || _a === void 0 ? void 0 : _a.remove();
            responses.append(response);
            responses.scrollTop = responses.scrollHeight;
            status.textContent = "Response received. Listening for more responses…";
        });
        socket.addEventListener("error", function () {
            window.clearTimeout(connectionTimeout);
            if (discoverySocket !== socket) {
                return;
            }
            failed = true;
            button.disabled = false;
            status.textContent = "Connection failed. Check the discovery server at 127.0.0.1:8080 and try again.";
            socket.close();
        });
        socket.addEventListener("close", function () {
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
    var panSpeed = readSpeedValue("pan");
    var tiltSpeed = readSpeedValue("tilt");
    if (panSpeed === null || tiltSpeed === null) {
        return;
    }
    var _a = directionBytes[direction], panDirection = _a[0], tiltDirection = _a[1];
    var payload = [0x81, 0x01, 0x06, 0x01, panSpeed, tiltSpeed, panDirection, tiltDirection, 0xff];
    sendViscaPayload("Move ".concat(direction), payload);
}
function sendViscaPayload(label, payload) {
    var camera = readCameraSettings();
    if (!camera) {
        return;
    }
    var packet = buildViscaOverIpPacket(payload);
    showMessage(formatPacketStatus(label, camera, packet));
    if (!window.sendViscaUdp) {
        return;
    }
    Promise.resolve(window.sendViscaUdp(camera, packet)).catch(function (error) {
        showMessage("Send failed: ".concat(error instanceof Error ? error.message : String(error)));
    });
}
function buildViscaOverIpPacket(payload) {
    var sequence = sequenceNumber;
    sequenceNumber = (sequenceNumber + 1) >>> 0;
    return __spreadArray([
        (VISCA_COMMAND_PAYLOAD_TYPE >> 8) & 0xff,
        VISCA_COMMAND_PAYLOAD_TYPE & 0xff,
        (payload.length >> 8) & 0xff,
        payload.length & 0xff,
        (sequence >> 24) & 0xff,
        (sequence >> 16) & 0xff,
        (sequence >> 8) & 0xff,
        sequence & 0xff
    ], payload, true);
}
function readCameraSettings() {
    var name = cameraNameInput.value.trim() || "Camera";
    var ip = cameraIpInput.value.trim();
    var port = Number(cameraPortInput.value);
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
    return { name: name, ip: ip, port: port };
}
function readSpeedValue(name) {
    if (!validateSpeed(name, true)) {
        speedControls[name].input.focus();
        return null;
    }
    return Number(speedControls[name].input.value) - 1;
}
function validateSpeed(name, report) {
    if (report === void 0) { report = false; }
    var _a = speedControls[name], input = _a.input, limit = _a.limit;
    var value = Number(input.value);
    var valid = Number.isInteger(value) && value >= 1 && value <= limit;
    input.setCustomValidity(valid ? "" : "Enter a ".concat(name, " speed from 1 to ").concat(limit, "."));
    if (!valid && report) {
        input.reportValidity();
    }
    return valid;
}
function showSpeedStatus() {
    var values = Object.keys(speedControls).map(function (name) {
        var speed = readRawSpeedValue(name);
        return "".concat(name, "=").concat(speed === null ? "--" : formatByte(speed - 1));
    });
    showMessage("Speeds ".concat(values.join(" ")));
}
function readRawSpeedValue(name) {
    var _a = speedControls[name], input = _a.input, limit = _a.limit;
    var value = Number(input.value);
    if (!Number.isInteger(value) || value < 1 || value > limit) {
        return null;
    }
    return value;
}
function formatBytes(bytes) {
    return bytes.map(formatByte).join(" ");
}
function formatPacketStatus(label, camera, packet) {
    var header = packet.slice(0, VISCA_OVER_IP_HEADER_LENGTH);
    var command = packet.slice(VISCA_OVER_IP_HEADER_LENGTH);
    return "".concat(label, ": ").concat(formatBytes(header), "\n").concat(formatBytes(command), " -> ").concat(camera.ip, ":").concat(camera.port);
}
function formatByte(value) {
    return value.toString(16).padStart(2, "0").toUpperCase();
}
function showMessage(message) {
    packetOutput.value = message;
}
function saveSettings() {
    var data = {
        name: cameraNameInput.value,
        ip: cameraIpInput.value,
        port: cameraPortInput.value,
        speeds: Object.fromEntries(Object.entries(speedControls).map(function (_a) {
            var name = _a[0], input = _a[1].input;
            return [name, input.value];
        })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
function loadSettings() {
    var _a, _b, _c, _d;
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        return;
    }
    try {
        var data = JSON.parse(raw);
        cameraNameInput.value = (_a = data.name) !== null && _a !== void 0 ? _a : cameraNameInput.value;
        cameraIpInput.value = (_b = data.ip) !== null && _b !== void 0 ? _b : cameraIpInput.value;
        cameraPortInput.value = (_c = data.port) !== null && _c !== void 0 ? _c : cameraPortInput.value;
        Object.entries((_d = data.speeds) !== null && _d !== void 0 ? _d : {}).forEach(function (_a) {
            var name = _a[0], value = _a[1];
            if (name in speedControls && value !== undefined) {
                speedControls[name].input.value = value;
            }
        });
    }
    catch (_e) {
        localStorage.removeItem(STORAGE_KEY);
    }
}
