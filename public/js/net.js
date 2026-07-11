// Capa de red: envoltura fina sobre Socket.IO
export class Net {
  constructor() {
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.id = null;
    this.socket.on('connect', () => { this.id = this.socket.id; });
  }
  get connected() { return this.socket.connected; }
  on(ev, fn) { this.socket.on(ev, fn); return this; }
  off(ev, fn) { this.socket.off(ev, fn); return this; }
  emit(ev, data, cb) { this.socket.emit(ev, data, cb); }

  createRoom(name, skin, isPublic) {
    return new Promise(res => this.socket.emit('createRoom', { name, skin, isPublic }, res));
  }
  joinRoom(code, name, skin) {
    return new Promise(res => this.socket.emit('joinRoom', { code, name, skin }, res));
  }
  quickMatch(name, skin) {
    return new Promise(res => this.socket.emit('quickMatch', { name, skin }, res));
  }
}
