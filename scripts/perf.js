const io = require('socket.io-client');
const admin = io('http://localhost:8123', { forceNew: true });
admin.on('connect', () => admin.emit('join', { nickname: 'admin', password: '3927' }));
admin.on('lobbyUpdate', () => {
  if (admin._a) return; admin._a = true;
  for (let i = 0; i < 40; i++) admin.emit('addBot');
  setTimeout(() => admin.emit('startTournament'), 800);
});
let updates = 0, bytes = 0;
admin.on('dashboardUpdate', (p) => { updates++; bytes += JSON.stringify(p).length; });
admin.on('tournamentEnded', () => { console.log(`updates=${updates} totalKB=${(bytes/1024).toFixed(1)} avgBytes=${Math.round(bytes/Math.max(updates,1))}`); process.exit(0); });
setTimeout(() => { console.log(`updates=${updates} totalKB=${(bytes/1024).toFixed(1)} avgBytes=${Math.round(bytes/Math.max(updates,1))}`); process.exit(0); }, 45000);
