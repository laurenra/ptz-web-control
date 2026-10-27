const WS_URL_TEST = "ws://127.0.0.1:8080/ws/test";
const TEST_MESSAGE = "Greetings, Earthlings.";
export function bindWebSocketControls() {
    const openButton = document.getElementById("open-discovery-socket");
    const findButton = document.getElementById("find-cameras");
    const testButton = document.getElementById("test-socket");
    const status = document.getElementById("discovery-status");
    const responses = document.getElementById("server-responses");
    if (!(openButton instanceof HTMLButtonElement) || !(findButton instanceof HTMLButtonElement) || !(testButton instanceof HTMLButtonElement) || !status || !responses) {
        throw new Error("Missing WebSocket controls.");
    }
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
        openButton.disabled = true;
        testButton.disabled = true;
        status.textContent = `Connecting to ${WS_URL_TEST}…`;
        let socket;
        try {
            // ws is Node-only; browser clients use the native WebSocket API.
            socket = new WebSocket(WS_URL_TEST);
        }
        catch (error) {
            openButton.disabled = false;
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
            failureMessage = "WebSocket connection failed. Check that the server is running at " + WS_URL_TEST + ".";
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
            testButton.disabled = true;
            const closeDetails = `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
            status.textContent = `${failureMessage ?? "Socket closed."} (${closeDetails}) Select Open Socket to reconnect.`;
        });
    });
}
