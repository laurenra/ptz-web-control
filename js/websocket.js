const STORAGE_KEY = "ptz-websocket-settings";
const TEST_MESSAGE = "Greetings, Earthlings.";
export function bindWebSocketControls() {
    const hostInput = document.getElementById("websocket-host");
    const portInput = document.getElementById("websocket-port");
    const openButton = document.getElementById("open-discovery-socket");
    const findButton = document.getElementById("find-cameras");
    const testButton = document.getElementById("test-socket");
    const status = document.getElementById("discovery-status");
    const responses = document.getElementById("server-responses");
    if (!(hostInput instanceof HTMLInputElement) || !(portInput instanceof HTMLInputElement) || !(openButton instanceof HTMLButtonElement) || !(findButton instanceof HTMLButtonElement) || !(testButton instanceof HTMLButtonElement) || !status || !responses) {
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
        if (activeSocket?.readyState === WebSocket.OPEN || activeSocket?.readyState === WebSocket.CONNECTING) {
            return;
        }
        if (!portInput.reportValidity())
            return;
        const host = hostInput.value.trim();
        let socketUrl;
        try {
            const url = new URL(`ws://${host}:${portInput.valueAsNumber}/ws/test`);
            if (!host || /[\s/\\@?#]/.test(host) || url.username || url.password) {
                throw new Error("Invalid server address");
            }
            socketUrl = url.href;
        }
        catch {
            hostInput.setCustomValidity("Enter a server IP address or hostname, such as 127.0.0.1 or localhost.");
            hostInput.reportValidity();
            return;
        }
        hostInput.setCustomValidity("");
        saveSettings();
        openButton.disabled = true;
        testButton.disabled = true;
        hostInput.disabled = true;
        portInput.disabled = true;
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
            status.textContent = "Socket open. Select Test Socket to send a message.";
        });
        socket.addEventListener("message", (event) => {
            if (activeSocket !== socket) {
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
}
//# sourceMappingURL=websocket.js.map