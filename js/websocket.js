import { bindCameraConnection } from "./listeners.js";
const STORAGE_KEY = "ptz-websocket-settings";
const TEST_MESSAGE = "Greetings, Earthlings.";
export function bindWebSocketControls(readCamera) {
    const hostInput = document.getElementById("websocket-host");
    const portInput = document.getElementById("websocket-port");
    const openButton = document.getElementById("open-discovery-socket");
    const findButton = document.getElementById("find-cameras");
    const testButton = document.getElementById("test-socket");
    const listenersButton = document.getElementById("show-listeners");
    const cameraStatus = document.getElementById("camera-connection-status");
    const status = document.getElementById("discovery-status");
    const responses = document.getElementById("server-responses");
    if (!(hostInput instanceof HTMLInputElement) || !(portInput instanceof HTMLInputElement) || !(openButton instanceof HTMLButtonElement) || !(findButton instanceof HTMLButtonElement) || !(testButton instanceof HTMLButtonElement) || !(listenersButton instanceof HTMLButtonElement) || !cameraStatus || !status || !responses) {
        throw new Error("Missing WebSocket controls.");
    }
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
        if (typeof saved?.host === "string")
            hostInput.value = saved.host;
        if (typeof saved?.port === "string")
            portInput.value = saved.port;
    }
    catch {
        // Keep the defaults if saved settings are unavailable or invalid.
    }
    const saveSettings = () => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ host: hostInput.value.trim(), port: portInput.value }));
        }
        catch {
            // Connections still work when browser storage is unavailable.
        }
    };
    [hostInput, portInput].forEach((input) => {
        input.addEventListener("input", () => input.setCustomValidity(""));
        input.addEventListener("change", saveSettings);
    });
    let activeSocket = null;
    const appendResponse = (message) => {
        const response = document.createElement("pre");
        response.className = "server-response";
        response.textContent = message;
        responses.querySelector(".response-placeholder")?.remove();
        responses.append(response);
        responses.scrollTop = responses.scrollHeight;
    };
    const getServerUrl = (report = false) => {
        if (!portInput.checkValidity()) {
            if (report)
                portInput.reportValidity();
            return null;
        }
        const host = hostInput.value.trim();
        try {
            const protocol = window.location.protocol === "https:" ? "https:" : "http:";
            const url = new URL(`${protocol}//${host}:${portInput.valueAsNumber}`);
            if (!host || /[\s/\\@?#]/.test(host) || url.username || url.password || url.port === "0") {
                throw new Error("Invalid server address");
            }
            hostInput.setCustomValidity("");
            return url;
        }
        catch {
            hostInput.setCustomValidity("Enter a server IP address or hostname, such as 127.0.0.1 or localhost.");
            if (report)
                hostInput.reportValidity();
            return null;
        }
    };
    const cameraConnection = bindCameraConnection(() => getServerUrl(), (message) => { cameraStatus.textContent = message; }, appendResponse, (ready) => {
        document.querySelectorAll(".arrow-button, .preset-button").forEach((button) => {
            button.disabled = !ready;
        });
    });
    const connectSelectedCamera = () => cameraConnection.connect(readCamera(false));
    document.getElementById("active-camera")?.addEventListener("change", () => cameraConnection.connect(readCamera(false), true));
    document.getElementById("camera-list")?.addEventListener("change", connectSelectedCamera);
    [hostInput, portInput].forEach((input) => input.addEventListener("change", () => {
        const previousSocket = activeSocket;
        activeSocket = null;
        previousSocket?.close();
        openButton.disabled = false;
        testButton.disabled = true;
        status.textContent = "Server settings changed. Select Open Socket to connect.";
        connectSelectedCamera();
    }));
    listenersButton.addEventListener("click", async () => {
        const server = getServerUrl(true);
        if (!server)
            return;
        saveSettings();
        listenersButton.disabled = true;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 10000);
        try {
            const response = await fetch(new URL("/api/listeners", server), { method: "GET", cache: "no-store", signal: controller.signal });
            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${(await response.text()).trim()}`);
            }
            const routes = await response.json();
            if (!Array.isArray(routes))
                throw new Error("Expected a JSON array of listener routes.");
            appendResponse(JSON.stringify(routes, null, 2));
        }
        catch (error) {
            appendResponse(`Show Listeners failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            window.clearTimeout(timeout);
            listenersButton.disabled = false;
        }
    });
    // Camera discovery needs its own endpoint and protocol; this socket is for testing.
    findButton.disabled = true;
    testButton.disabled = true;
    testButton.addEventListener("click", () => {
        const socket = activeSocket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            testButton.disabled = true;
            status.textContent = "Socket is not open. Select Open Socket to connect.";
            return;
        }
        try {
            socket.send(TEST_MESSAGE);
            status.textContent = "Socket open. Test message sent. Waiting for a response…";
        }
        catch (error) {
            status.textContent = `Socket test failed: ${error instanceof Error ? error.message : String(error)}`;
        }
    });
    openButton.addEventListener("click", () => {
        if (!getServerUrl(true))
            return;
        connectSelectedCamera();
        if (activeSocket?.readyState === WebSocket.OPEN || activeSocket?.readyState === WebSocket.CONNECTING) {
            return;
        }
        const url = new URL("/ws/test", getServerUrl());
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        const socketUrl = url.href;
        saveSettings();
        openButton.disabled = true;
        testButton.disabled = true;
        status.textContent = `Connecting to ${socketUrl}…`;
        let socket;
        try {
            // ws is Node-only; browser clients use the native WebSocket API.
            socket = new WebSocket(socketUrl);
        }
        catch (error) {
            openButton.disabled = false;
            hostInput.disabled = false;
            portInput.disabled = false;
            status.textContent = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
            return;
        }
        socket.binaryType = "arraybuffer";
        activeSocket = socket;
        let failureMessage = null;
        const connectionTimeout = window.setTimeout(() => {
            if (activeSocket !== socket || socket.readyState !== WebSocket.CONNECTING) {
                return;
            }
            activeSocket = null;
            openButton.disabled = false;
            hostInput.disabled = false;
            portInput.disabled = false;
            testButton.disabled = true;
            status.textContent = "Connection timed out. Select Open Socket to try again.";
            socket.close();
        }, 10000);
        socket.addEventListener("open", () => {
            window.clearTimeout(connectionTimeout);
            if (activeSocket !== socket) {
                return;
            }
            testButton.disabled = false;
            openButton.disabled = false;
            status.textContent = "Socket open. Select Test Socket to send a message.";
        });
        socket.addEventListener("message", (event) => {
            if (activeSocket !== socket) {
                return;
            }
            appendResponse(event.data instanceof ArrayBuffer
                ? new TextDecoder().decode(event.data)
                : String(event.data));
            status.textContent = "Socket open. Response received. Listening for more responses…";
        });
        socket.addEventListener("error", () => {
            window.clearTimeout(connectionTimeout);
            if (activeSocket !== socket) {
                return;
            }
            failureMessage = "WebSocket connection failed. Check that the server is running at " + socketUrl + ".";
            status.textContent = failureMessage;
            testButton.disabled = true;
            socket.close();
        });
        socket.addEventListener("close", (event) => {
            window.clearTimeout(connectionTimeout);
            if (activeSocket !== socket) {
                return;
            }
            activeSocket = null;
            openButton.disabled = false;
            hostInput.disabled = false;
            portInput.disabled = false;
            testButton.disabled = true;
            const closeDetails = `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
            status.textContent = `${failureMessage ?? "Socket closed."} (${closeDetails}) Select Open Socket to reconnect.`;
        });
    });
    connectSelectedCamera();
    return cameraConnection.send;
}
//# sourceMappingURL=websocket.js.map