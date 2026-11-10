# ptz-web-control
Web interface for PTZ camera control.

## Use
Run `npm start` to serve the app locally, or serve the production `dist/` folder
after running `npm run build`. JavaScript modules require an HTTP server.

The four tabs separate the controls:

- **Camera Control** — Select a camera, use the motion and preset controls, adjust
  speeds, and view the generated packet.
- **Camera Settings** — Blank for now, reserved for exposure, white balance, OSD,
  pan/tilt speed lock, image modes, and color adjustments.
- **Cameras Setup** — Give each of eight cameras a custom name, IP address, and
  port. Entries and the selected camera are saved in this browser. Existing
  single-camera settings are carried over to Camera 1.
- **General Setup** — Configure the WebSocket connection and view server replies.

In **General Setup**, enter the WebSocket server IP or hostname and port (defaults:
`127.0.0.1` and `8080`). These settings are saved in your browser. With the server
running, select **Open Socket**, then **Test Socket** to send `Greetings, Earthlings.`
to its `/ws/test` endpoint. Connection status
and server responses appear in the General Setup tab. Find Cameras remains disabled
until camera discovery is implemented. The browser uses its native `WebSocket`
API; the Node `ws` package is only suitable for server-side code.

## Build
Install dependencies once with `npm install`, then use one of these commands:

- `npm run build` — Compiles `ts/app.ts` and its imports into `js/` using `tsconfig.json`,
  then builds the production site in `dist/` with Webpack.
- `npm run build:ts` — Compiles `ts/app.ts` and its imports into `js/` using
  `tsconfig.json`.
- `npm run watch:ts` — Watches for TypeScript changes and automatically
  recompiles whenever you save. Keep this command running while editing.

Edit the files in `ts/`; compilation overwrites the corresponding files in `js/`.
WebSocket controls live in `ts/websocket.ts`, imported by `ts/app.ts`.

## Run
Don't just load the index.html file in a browser when testing locally. You will
get a CORS "cross-origin" error. Launch it with a node server.

```bash
npm start
```
This will start a local server at `http://localhost:8080/` or the
next available port, like 8081, if 8080 is already in use (by the
websocket server running on Go). The server will automatically reload
if you change any of the source files.

To set a custom port, use the `PORT` environment variable.
Like `PORT=8081 npm start`. Or add the port in the devServer
config in `webpack.config.js` like this:
```js
devServer: {
  port: 8081,
  liveReload: true,
  hot: true,
  open: true,
  static: ['./'],
}
```

## Run (Exact Instructions)

Run the Go server from /ptz-udp-server directory.

```aiignore
go run . --origin http://localhost:8081
```
This tells the Go running on port 8080 to send data to the Node server running on port 8081.

Run a node server from /ptz-web-control directory (on port 8081). Node will try to find the
next available port. Because 8080 will already be in use, it will use 8081 instead. You can
alse specify a port with the PORT environment variable (see above).

```aiignore
npm start
```

### To Do:
- [ ] There may be a problem with hex commands. The packet display shows 09
instead of 0A.
