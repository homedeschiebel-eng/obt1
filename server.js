// PARLER OBERSTUFEN-TURNIER – Start auf dem Laptop (offline, ohne Internet)
// Start:  node server.js        (im Ordner der Website)
// Diese Datei startet den eigentlichen Server (app-server.js) und startet ihn nach einem
// automatischen Update neu. Sie selbst muss nie geändert werden.
const { spawn } = require('child_process');
const path = require('path');

let restarted = false;
function run() {
  const env = Object.assign({}, process.env, restarted ? { PT_RESTART: '1' } : {});
  const child = spawn(process.execPath, [path.join(__dirname, 'app-server.js')].concat(process.argv.slice(2)), { stdio: 'inherit', env });
  child.on('exit', (code) => {
    if (code === 75) { restarted = true; console.log('\n  Update wird installiert – Server startet neu …\n'); setTimeout(run, 400); return; }
    process.exit(code || 0);
  });
  const stop = () => { child.kill(); };
  process.removeAllListeners('SIGINT'); process.removeAllListeners('SIGTERM');
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
run();
